import * as vscode from 'vscode';
import type { StateStore } from './store';
import type {
  Session,
  Agent,
  DelegationEvent,
  FileEvent,
  DashboardState,
  ExtensionMessage,
  HookPayload
} from './types';

/**
 * State Manager
 * Holds the full state in memory and broadcasts updates to the webview panel
 */

export class StateManager {
  private static readonly STALE_ACTIVE_MS = 60 * 60 * 1000;
  private store: StateStore;
  private panel: vscode.WebviewPanel | undefined;

  constructor(store: StateStore) {
    this.store = store;
  }

  setPanel(panel: vscode.WebviewPanel): void {
    this.panel = panel;
  }

  /**
   * Broadcast a message to the webview panel
   */
  private broadcast(message: ExtensionMessage): void {
    if (this.panel) {
      console.log('[AgentObservatory] Broadcasting to webview:', message.type);
      this.panel.webview.postMessage(message);
    } else {
      console.log('[AgentObservatory] No panel to broadcast to');
    }
  }

  /**
   * Get a snapshot of the current dashboard state
   * Used for INITIAL_STATE when webview connects
   */
  getSnapshot(): DashboardState {
    const storeState = this.store.getState();
    return {
      sessions: storeState.sessions,
      agents: storeState.agents,
      delegations: storeState.delegations,
      fileEvents: storeState.fileEvents,
      selectedSessionId: null,
      connectionStatus: 'connected',
      isMuted: false
    };
  }

  refreshPanel(): void {
    this.broadcast({ type: 'INITIAL_STATE', payload: this.getSnapshot() });
  }

  markStaleSessionsIdle(): void {
    const now = Date.now();
    const { sessions } = this.store.getState();

    for (const session of Object.values(sessions)) {
      if (!['claude-code', 'codex'].includes(session.tool) || session.status !== 'active') {
        continue;
      }

      const lastActivityAt = session.lastActivityAt ?? session.startedAt ?? 0;
      if (lastActivityAt > 0 && now - lastActivityAt > StateManager.STALE_ACTIVE_MS) {
        this.store.updateSession(session.id, { status: 'idle' });
        this.broadcast({
          type: 'SESSION_UPDATED',
          payload: { id: session.id, status: 'idle' }
        });
      }
    }
  }

  /**
   * Apply a hook payload event to the state
   */
  applyEvent(payload: HookPayload): void {
    switch (payload.hook_event_name) {
      case 'SessionStart':
        this.handleSessionStart(payload);
        break;

      case 'SubagentStart':
        this.handleSubagentStart(payload);
        break;

      case 'SubagentStop':
        this.handleSubagentStop(payload);
        break;

      case 'Stop':
        this.handleStop(payload);
        break;

      case 'SessionEnd':
        this.handleSessionEnd(payload);
        break;

      case 'Notification':
        this.handleNotification(payload);
        break;

      case 'PreToolUse':
        this.handlePreToolUse(payload);
        break;

      case 'PostToolUse':
        this.handlePostToolUse(payload);
        break;
    }
  }

  private handleSessionStart(payload: any): void {
    const session: Session = {
      id: payload.session_id,
      tool: 'claude-code',
      cwd: payload.cwd,
      projectName: this.getProjectName(payload.cwd),
      status: 'active',
      startedAt: Date.now(),
      model: payload.model,
      source: payload.source,
      lastActivityAt: Date.now()
    };

    this.store.updateSessions({ [session.id]: session });
    this.broadcast({ type: 'SESSION_CREATED', payload: session });
  }

  private handleSubagentStart(payload: any): void {
    const agent: Agent = {
      id: payload.agent_id,
      sessionId: payload.session_id,
      parentAgentId: null, // Main agent for now - we'll link properly
      agentType: payload.agent_type,
      status: 'active',
      startedAt: Date.now()
    };

    this.store.updateAgents({ [agent.id]: agent });
    this.broadcast({ type: 'SUBAGENT_CREATED', payload: agent });
  }

  private handleSubagentStop(payload: any): void {
    this.store.updateAgent(payload.agent_id, {
      status: 'completed',
      completedAt: Date.now(),
      lastMessage: payload.last_assistant_message
    });
    this.broadcast({
      type: 'SUBAGENT_COMPLETED',
      payload: { id: payload.agent_id, parentId: payload.session_id }
    });
  }

  private handleStop(payload: any): void {
    this.store.updateSession(payload.session_id, {
      status: 'idle',
      lastActivityAt: Date.now()
    });
    this.broadcast({
      type: 'SESSION_UPDATED',
      payload: { id: payload.session_id, status: 'idle', lastActivityAt: Date.now() }
    });
  }

  private handleSessionEnd(payload: any): void {
    this.store.updateSession(payload.session_id, {
      status: 'completed',
      completedAt: Date.now()
    });
    this.broadcast({
      type: 'SESSION_COMPLETED',
      payload: { id: payload.session_id }
    });
  }

  private handleNotification(payload: any): void {
    this.broadcast({
      type: 'NOTIFICATION',
      payload: { sessionId: payload.session_id, message: payload.message }
    });
  }

  private handlePreToolUse(payload: any): void {
    const toolName = payload.tool_name;

    // Update current task for agent
    const currentTask = `${toolName}: ${this.getBriefToolDescription(payload.tool_input)}`;
    this.broadcast({
      type: 'CURRENT_TASK',
      payload: {
        sessionId: payload.session_id,
        agentId: payload.session_id, // Main agent for PreToolUse
        task: currentTask
      }
    });

    // Track file activity for Read/Write/Edit tools
    if (['Read', 'Write', 'Edit', 'Bash'].includes(toolName)) {
      const fileEvent: FileEvent = {
        sessionId: payload.session_id,
        agentId: payload.session_id,
        filePath: payload.tool_input.file_path || payload.tool_input.path || payload.tool_input.command || 'unknown',
        operation: this.getOperationFromToolName(toolName),
        createdAt: Date.now()
      };
      this.store.addFileEvent(fileEvent);
      this.broadcast({ type: 'FILE_ACTIVITY', payload: fileEvent });
    }

    // Track delegation start for Task tool
    if (toolName === 'Task') {
      const delegation: DelegationEvent = {
        id: `${payload.session_id}_${Date.now()}`,
        sessionId: payload.session_id,
        fromAgentId: payload.session_id,
        toAgentId: 'pending', // Will be linked on SubagentStart
        prompt: payload.tool_input.description || payload.tool_input.task_description || 'No description',
        status: 'pending',
        createdAt: Date.now()
      };
      this.store.updateDelegations({ [delegation.id]: delegation });
      this.broadcast({ type: 'DELEGATION_STARTED', payload: delegation });
    }

    // Update session last activity
    this.store.updateSession(payload.session_id, {
      status: 'active',
      lastActivityAt: Date.now()
    });
  }

  private handlePostToolUse(payload: any): void {
    const toolName = payload.tool_name;

    // Track delegation completion for Task tool
    if (toolName === 'Task') {
      const delegations = this.store.getState().delegations;
      const delegationId = Object.keys(delegations).find(id =>
        delegations[id].sessionId === payload.session_id &&
        delegations[id].status === 'pending'
      );

      if (delegationId) {
        const toolResponse = payload.tool_response;
        const result = typeof toolResponse === 'string' ? toolResponse : JSON.stringify(toolResponse);

        this.store.updateDelegation(delegationId, {
          status: 'completed',
          result: result,
          completedAt: Date.now()
        });
        this.broadcast({
          type: 'DELEGATION_COMPLETED',
          payload: { ...this.store.getState().delegations[delegationId] }
        });
      }
    }
  }

  private getProjectName(cwd: string): string {
    // Return the last path segment of the cwd
    const parts = cwd.split(/[/\\]/);
    return parts[parts.length - 1] || cwd;
  }

  private getBriefToolDescription(toolInput: any): string {
    if (toolInput.file_path) {
      return toolInput.file_path;
    }
    if (toolInput.path) {
      return toolInput.path;
    }
    if (toolInput.command) {
      const cmd = toolInput.command;
      return cmd.length > 50 ? cmd.substring(0, 50) + '...' : cmd;
    }
    if (toolInput.description) {
      return toolInput.description;
    }
    return 'No details';
  }

  private getOperationFromToolName(toolName: string): 'read' | 'write' | 'edit' {
    if (toolName === 'Read') return 'read';
    if (toolName === 'Write') return 'write';
    if (toolName === 'Edit') return 'edit';
    return 'read'; // Bash defaults to read
  }

  /**
   * Handle message from webview
   */
  handleWebviewMessage(message: any): void {
    switch (message.type) {
      case 'READY':
        // Send initial state to webview
        this.broadcast({ type: 'INITIAL_STATE', payload: this.getSnapshot() });
        break;
      case 'SELECT_SESSION':
        // Store selection - could be persisted if needed
        break;
      case 'TOGGLE_MUTE':
        // Handle mute toggle - could be persisted if needed
        break;
    }
  }
}
