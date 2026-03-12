import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import type { PersistedState, Tool, ToolStateSnapshot } from './types';

const STATE_FILE = 'state.json';

/**
 * JSON Persistence Store
 * Uses pure Node.js fs module - no native dependencies needed
 */

export class StateStore {
  private storagePath: string;
  private state: PersistedState;
  private saveTimer: NodeJS.Timeout | null = null;

  constructor(context: vscode.ExtensionContext) {
    this.storagePath = context.globalStorageUri.fsPath;
    this.state = {
      sessions: {},
      agents: {},
      delegations: {},
      fileEvents: []
    };
  }

  async load(): Promise<void> {
    try {
      const statePath = path.join(this.storagePath, STATE_FILE);
      const content = await fs.readFile(statePath, 'utf-8');
      this.state = JSON.parse(content);
      console.log('[AgentObservatory] State loaded from disk');
    } catch (error) {
      // File doesn't exist or is corrupted - start with empty state
      console.log('[AgentObservatory] No existing state found, starting fresh');
      this.state = {
        sessions: {},
        agents: {},
        delegations: {},
        fileEvents: []
      };
    }
  }

  async save(): Promise<void> {
    // Debounce saves - wait 500ms after last update
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
    }

    this.saveTimer = setTimeout(async () => {
      try {
        // Trim fileEvents to last 1000 entries
        const trimmedFileEvents = this.state.fileEvents.slice(-1000);

        const stateToSave: PersistedState = {
          sessions: this.state.sessions,
          agents: this.state.agents,
          delegations: this.state.delegations,
          fileEvents: trimmedFileEvents
        };

        await fs.mkdir(this.storagePath, { recursive: true });
        const statePath = path.join(this.storagePath, STATE_FILE);
        await fs.writeFile(statePath, JSON.stringify(stateToSave, null, 2), 'utf-8');
        console.log('[AgentObservatory] State saved to disk');
      } catch (error) {
        console.error('[AgentObservatory] Failed to save state:', error);
      }
    }, 500);
  }

  getState(): PersistedState {
    return this.state;
  }

  updateSessions(sessions: Record<string, any>): void {
    this.state.sessions = { ...this.state.sessions, ...sessions };
    this.save();
  }

  updateSession(id: string, session: Partial<any>): void {
    if (!this.state.sessions[id]) {
      return;
    }
    this.state.sessions[id] = { ...this.state.sessions[id], ...session };
    this.save();
  }

  updateAgents(agents: Record<string, any>): void {
    this.state.agents = { ...this.state.agents, ...agents };
    this.save();
  }

  updateAgent(id: string, agent: Partial<any>): void {
    if (!this.state.agents[id]) {
      return;
    }
    this.state.agents[id] = { ...this.state.agents[id], ...agent };
    this.save();
  }

  updateDelegations(delegations: Record<string, any>): void {
    this.state.delegations = { ...this.state.delegations, ...delegations };
    this.save();
  }

  updateDelegation(id: string, delegation: Partial<any>): void {
    if (!this.state.delegations[id]) {
      return;
    }
    this.state.delegations[id] = { ...this.state.delegations[id], ...delegation };
    this.save();
  }

  addFileEvent(event: any): void {
    this.state.fileEvents.push(event);
    this.save();
  }

  replaceToolState(tool: Tool, snapshot: ToolStateSnapshot): void {
    const existingToolSessionIds = new Set(
      Object.values(this.state.sessions)
        .filter(session => session.tool === tool)
        .map(session => session.id)
    );

    const nextToolSessionIds = new Set(Object.keys(snapshot.sessions));
    const affectedSessionIds = new Set<string>([
      ...existingToolSessionIds,
      ...nextToolSessionIds
    ]);

    this.state.sessions = {
      ...Object.fromEntries(
        Object.entries(this.state.sessions).filter(([, session]) => session.tool !== tool)
      ),
      ...snapshot.sessions
    };

    this.state.agents = {
      ...Object.fromEntries(
        Object.entries(this.state.agents).filter(([, agent]) => !affectedSessionIds.has(agent.sessionId))
      ),
      ...snapshot.agents
    };

    this.state.delegations = {
      ...Object.fromEntries(
        Object.entries(this.state.delegations).filter(
          ([, delegation]) => !affectedSessionIds.has(delegation.sessionId)
        )
      ),
      ...snapshot.delegations
    };

    this.state.fileEvents = [
      ...this.state.fileEvents.filter(event => !affectedSessionIds.has(event.sessionId)),
      ...snapshot.fileEvents
    ];

    this.save();
  }

  async clear(): Promise<void> {
    this.state = {
      sessions: {},
      agents: {},
      delegations: {},
      fileEvents: []
    };
    try {
      const statePath = path.join(this.storagePath, STATE_FILE);
      await fs.unlink(statePath);
      console.log('[AgentObservatory] State cleared');
    } catch (error) {
      // File might not exist - that's fine
    }
  }
}
