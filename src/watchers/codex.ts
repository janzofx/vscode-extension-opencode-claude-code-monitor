import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import type { StateStore } from '../store';
import type { StateManager } from '../state';
import { CodexParser } from '../parsers/codex';
import type { CodexStateSnapshot } from '../types';

export class CodexWatcher {
  private readonly store: StateStore;
  private readonly stateManager: StateManager;
  private readonly codexRootUri: vscode.Uri;
  private readonly sessionsUri: vscode.Uri;
  private readonly archivedSessionsUri: vscode.Uri;
  private readonly disposables: vscode.Disposable[] = [];
  private scanTimer: NodeJS.Timeout | undefined;
  private scanInProgress = false;
  private rescanQueued = false;

  constructor(store: StateStore, stateManager: StateManager) {
    this.store = store;
    this.stateManager = stateManager;
    this.codexRootUri = vscode.Uri.file(path.join(process.env.USERPROFILE!, '.codex'));
    this.sessionsUri = vscode.Uri.file(path.join(this.codexRootUri.fsPath, 'sessions'));
    this.archivedSessionsUri = vscode.Uri.file(path.join(this.codexRootUri.fsPath, 'archived_sessions'));
  }

  async start(): Promise<void> {
    try {
      await fs.access(this.codexRootUri.fsPath);
    } catch {
      console.log('[AgentObservatory] Codex root directory does not exist yet');
      return;
    }

    const sessionsWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(this.codexRootUri, 'sessions/**/*.jsonl')
    );
    const archivedWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(this.codexRootUri, 'archived_sessions/**/*.jsonl')
    );
    const indexWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(this.codexRootUri, 'session_index.jsonl')
    );

    const triggerRescan = () => {
      this.scheduleRescan();
    };

    sessionsWatcher.onDidCreate(triggerRescan);
    sessionsWatcher.onDidChange(triggerRescan);
    sessionsWatcher.onDidDelete(triggerRescan);

    archivedWatcher.onDidCreate(triggerRescan);
    archivedWatcher.onDidChange(triggerRescan);
    archivedWatcher.onDidDelete(triggerRescan);

    indexWatcher.onDidCreate(triggerRescan);
    indexWatcher.onDidChange(triggerRescan);
    indexWatcher.onDidDelete(triggerRescan);

    this.disposables.push(sessionsWatcher, archivedWatcher, indexWatcher);

    console.log('[AgentObservatory] Codex watchers started');
    await this.scanSessions();
  }

  stop(): void {
    this.disposables.forEach(disposable => disposable.dispose());
    this.disposables.length = 0;

    if (this.scanTimer) {
      clearTimeout(this.scanTimer);
      this.scanTimer = undefined;
    }

    console.log('[AgentObservatory] Codex watchers stopped');
  }

  private scheduleRescan(delayMs: number = 250): void {
    if (this.scanTimer) {
      clearTimeout(this.scanTimer);
    }

    this.scanTimer = setTimeout(() => {
      this.scanTimer = undefined;
      void this.scanSessions();
    }, delayMs);
  }

  private async scanSessions(): Promise<void> {
    if (this.scanInProgress) {
      this.rescanQueued = true;
      return;
    }

    this.scanInProgress = true;

    try {
      const snapshot = await this.buildSnapshot();
      this.store.replaceToolState('codex', snapshot);
      this.stateManager.refreshPanel();

      console.log(
        `[AgentObservatory] Codex scan complete: ${Object.keys(snapshot.sessions).length} sessions`
      );
    } catch (error) {
      console.error('[AgentObservatory] Failed to scan Codex sessions:', error);
    } finally {
      this.scanInProgress = false;

      if (this.rescanQueued) {
        this.rescanQueued = false;
        this.scheduleRescan();
      }
    }
  }

  private async buildSnapshot(): Promise<CodexStateSnapshot> {
    const snapshot: CodexStateSnapshot = {
      sessions: {},
      agents: {},
      delegations: {},
      fileEvents: []
    };

    await this.loadDirectoryIntoSnapshot(this.sessionsUri.fsPath, false, snapshot);
    await this.loadDirectoryIntoSnapshot(this.archivedSessionsUri.fsPath, true, snapshot);

    return snapshot;
  }

  private async loadDirectoryIntoSnapshot(
    directoryPath: string,
    archived: boolean,
    snapshot: CodexStateSnapshot
  ): Promise<void> {
    try {
      await fs.access(directoryPath);
    } catch {
      return;
    }

    const pending: string[] = [directoryPath];

    while (pending.length > 0) {
      const current = pending.pop();
      if (!current) {
        continue;
      }

      const entries = await fs.readdir(current, { withFileTypes: true });

      for (const entry of entries) {
        const entryPath = path.join(current, entry.name);

        if (entry.isDirectory()) {
          pending.push(entryPath);
          continue;
        }

        if (!entry.isFile() || !entry.name.endsWith('.jsonl')) {
          continue;
        }

        const fileSnapshot = await CodexParser.parseSessionFile(entryPath, archived);
        Object.assign(snapshot.sessions, fileSnapshot.sessions);
        Object.assign(snapshot.agents, fileSnapshot.agents);
        Object.assign(snapshot.delegations, fileSnapshot.delegations);
        snapshot.fileEvents.push(...fileSnapshot.fileEvents);
      }
    }
  }
}
