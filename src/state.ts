import * as vscode from 'vscode';
import { formatStableTaskLabel } from './taskLabel';
import type { StateStore } from './store';
import type {
  Session,
  SessionStatus,
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
    this.normalizeMainAgents();
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

  resetTransientSessionsOnStartup(): void {
    const { sessions } = this.store.getState();

    for (const session of Object.values(sessions)) {
      if (!['claude-code', 'codex'].includes(session.tool) || session.status !== 'active') {
        continue;
      }

      this.store.updateSession(session.id, { status: 'idle' });
      this.store.updateAgent(session.id, {
        status: 'completed',
        completedAt: session.lastActivityAt ?? session.startedAt
      });
    }
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
        this.store.updateAgent(session.id, {
          status: 'completed',
          completedAt: lastActivityAt
        });
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
    const startedAt = Date.now();
    const status: SessionStatus = 'idle';
    const session: Session = {
      id: payload.session_id,
      tool: 'claude-code',
      cwd: payload.cwd,
      projectName: this.getProjectName(payload.cwd),
      status,
      startedAt,
      model: payload.model,
      source: payload.source,
      lastActivityAt: startedAt
    };
    const mainAgent = this.createMainAgent(session.id, startedAt, session.tool, status);

    this.store.updateSessions({ [session.id]: session });
    this.store.updateAgents({ [mainAgent.id]: mainAgent });
    this.broadcast({ type: 'SESSION_CREATED', payload: session });
    this.broadcast({ type: 'SUBAGENT_CREATED', payload: mainAgent });
  }

  private handleSubagentStart(payload: any): void {
    const pendingDelegationId = this.getPendingDelegationId(payload.session_id);
    const delegationPrompt = pendingDelegationId
      ? this.store.getState().delegations[pendingDelegationId]?.prompt
      : undefined;
    const agent: Agent = {
      id: payload.agent_id,
      sessionId: payload.session_id,
      parentAgentId: payload.session_id,
      agentType: payload.agent_type,
      status: 'active',
      startedAt: Date.now(),
      currentTask: formatStableTaskLabel(delegationPrompt)
    };

    this.store.updateAgents({ [agent.id]: agent });
    if (pendingDelegationId) {
      this.store.updateDelegation(pendingDelegationId, {
        toAgentId: payload.agent_id
      });
      this.broadcast({
        type: 'DELEGATION_STARTED',
        payload: { ...this.store.getState().delegations[pendingDelegationId] }
      });
    }
    this.broadcast({ type: 'SUBAGENT_CREATED', payload: agent });
  }

  private handleSubagentStop(payload: any): void {
    this.store.updateAgent(payload.agent_id, {
      status: 'completed',
      completedAt: Date.now(),
      lastMessage: payload.last_assistant_message
    });
    const delegationId = this.getDelegationIdForAgent(payload.session_id, payload.agent_id);
    if (delegationId) {
      const existingDelegation = this.store.getState().delegations[delegationId];
      this.store.updateDelegation(delegationId, {
        toAgentId: payload.agent_id,
        status: 'completed',
        result: payload.last_assistant_message || existingDelegation.result,
        completedAt: Date.now()
      });
      this.broadcast({
        type: 'DELEGATION_COMPLETED',
        payload: { ...this.store.getState().delegations[delegationId] }
      });
    }
    this.broadcast({
      type: 'SUBAGENT_COMPLETED',
      payload: { id: payload.agent_id, parentId: payload.session_id }
    });
  }

  private handleStop(payload: any): void {
    const activityTimestamp = Date.now();
    this.store.updateSession(payload.session_id, {
      status: 'idle',
      lastActivityAt: activityTimestamp
    });
    this.store.updateAgent(payload.session_id, {
      status: 'completed',
      completedAt: activityTimestamp
    });
    this.broadcast({
      type: 'SESSION_UPDATED',
      payload: { id: payload.session_id, status: 'idle', lastActivityAt: activityTimestamp }
    });
  }

  private handleSessionEnd(payload: any): void {
    const completedAt = Date.now();
    this.store.updateSession(payload.session_id, {
      status: 'completed',
      completedAt
    });
    this.store.updateAgent(payload.session_id, {
      status: 'completed',
      completedAt
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
    const activityTimestamp = Date.now();

    this.store.updateSession(payload.session_id, {
      status: 'active',
      lastActivityAt: activityTimestamp
    });
    this.ensureMainAgent(payload.session_id);
    this.store.updateAgent(payload.session_id, {
      status: 'active',
      completedAt: undefined
    });

    // Track file activity for Read/Write/Edit tools
    if (['Read', 'Write', 'Edit', 'Bash'].includes(toolName)) {
      const fileEvent: FileEvent = {
        sessionId: payload.session_id,
        agentId: payload.session_id,
        filePath: payload.tool_input.file_path || payload.tool_input.path || payload.tool_input.command || 'unknown',
        operation: this.getOperationFromToolName(toolName),
        createdAt: activityTimestamp
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
        createdAt: activityTimestamp
      };
      this.store.updateDelegations({ [delegation.id]: delegation });
      this.broadcast({ type: 'DELEGATION_STARTED', payload: delegation });
    }
  }

  private handlePostToolUse(payload: any): void {
    const toolName = payload.tool_name;

    // Track delegation completion for Task tool
    if (toolName === 'Task') {
      const delegationId = this.getPendingDelegationId(payload.session_id);

      if (delegationId) {
        const existingDelegation = this.store.getState().delegations[delegationId];
        const failureResult = this.getDelegationFailureResult(payload.tool_response);
        const hasLinkedSubagent =
          existingDelegation.toAgentId !== 'pending' && existingDelegation.toAgentId !== '';

        if (failureResult && !hasLinkedSubagent) {
          this.store.updateDelegation(delegationId, {
            status: 'completed',
            result: failureResult,
            completedAt: Date.now()
          });
          this.broadcast({
            type: 'DELEGATION_COMPLETED',
            payload: { ...this.store.getState().delegations[delegationId] }
          });
        }
      }
    }
  }

  private normalizeMainAgents(): void {
    for (const session of Object.values(this.store.getState().sessions)) {
      this.ensureMainAgent(session.id);
    }
  }

  private ensureMainAgent(sessionId: string): void {
    const state = this.store.getState();
    if (state.agents[sessionId]) {
      return;
    }

    const session = state.sessions[sessionId];
    if (!session) {
      return;
    }

    this.store.updateAgents({
      [sessionId]: this.createMainAgent(sessionId, session.startedAt, session.tool, session.status)
    });
  }

  private createMainAgent(
    sessionId: string,
    startedAt: number,
    tool: string,
    sessionStatus: SessionStatus = 'active'
  ): Agent {
    return {
      id: sessionId,
      sessionId,
      parentAgentId: null,
      agentType: this.getMainAgentType(tool),
      status: sessionStatus === 'active' ? 'active' : 'completed',
      startedAt,
      completedAt: sessionStatus === 'active' ? undefined : startedAt
    };
  }

  private getPendingDelegationId(sessionId: string): string | undefined {
    const delegations = this.store.getState().delegations;
    return Object.values(delegations)
      .filter(delegation => delegation.sessionId === sessionId && delegation.status === 'pending')
      .sort((left, right) => left.createdAt - right.createdAt)[0]?.id;
  }

  private getDelegationIdForAgent(sessionId: string, agentId: string): string | undefined {
    const delegations = this.store.getState().delegations;

    return Object.values(delegations)
      .filter(delegation => delegation.sessionId === sessionId)
      .sort((left, right) => left.createdAt - right.createdAt)
      .find(delegation => delegation.toAgentId === agentId || delegation.toAgentId === 'pending')?.id;
  }

  private getDelegationFailureResult(toolResponse: any): string | undefined {
    if (toolResponse === undefined || toolResponse === null) {
      return undefined;
    }

    const serialized =
      typeof toolResponse === 'string' ? toolResponse : JSON.stringify(toolResponse);
    if (!serialized) {
      return undefined;
    }

    return /(aborted|error|failed|failure)/i.test(serialized) ? serialized : undefined;
  }

  private getMainAgentType(tool: string): string {
    if (tool === 'claude-code') {
      return 'Claude Code';
    }
    if (tool === 'opencode') {
      return 'OpenCode';
    }
    if (tool === 'codex') {
      return 'Codex';
    }
    return 'Main Agent';
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

  private getCurrentTaskLabel(toolName: string, toolInput: any): string {
    if (toolName.toLowerCase() === 'task') {
      return `${toolName}: delegating work`;
    }

    return `${toolName}: ${this.getBriefToolDescription(toolInput)}`;
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
