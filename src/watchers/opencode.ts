import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { DatabaseSync } from 'node:sqlite';
import type { StateStore } from '../store';
import { OpenCodeParser } from '../parsers/opencode';
import type { StateManager } from '../state';

interface OpenCodeWatermarks {
  sessionMaxTime: number;
  messageMaxTime: number;
  partMaxTime: number;
  sessionCount: number;
  messageCount: number;
  partCount: number;
}

/**
 * OpenCode watcher
 * Reads OpenCode's SQLite database and refreshes dashboard state when the DB changes.
 */
export class OpenCodeWatcher {
  private readonly store: StateStore;
  private readonly stateManager: StateManager;
  private readonly opencodeStorageUri: vscode.Uri;
  private readonly databasePath: string;
  private readonly walPath: string;
  private readonly disposables: vscode.Disposable[] = [];
  private pollTimer: NodeJS.Timeout | undefined;
  private syncTimer: NodeJS.Timeout | undefined;
  private syncInProgress = false;
  private syncQueued = false;
  private watermarks: OpenCodeWatermarks = {
    sessionMaxTime: 0,
    messageMaxTime: 0,
    partMaxTime: 0,
    sessionCount: 0,
    messageCount: 0,
    partCount: 0
  };

  constructor(store: StateStore, stateManager: StateManager) {
    this.store = store;
    this.stateManager = stateManager;
    this.opencodeStorageUri = vscode.Uri.file(
      path.join(process.env.USERPROFILE!, '.local', 'share', 'opencode')
    );
    this.databasePath = path.join(this.opencodeStorageUri.fsPath, 'opencode.db');
    this.walPath = path.join(this.opencodeStorageUri.fsPath, 'opencode.db-wal');
  }

  async start(): Promise<void> {
    try {
      await fs.access(this.databasePath);
    } catch {
      console.log('[AgentObservatory] OpenCode database does not exist yet');
      vscode.window.showInformationMessage(
        'Agent Observatory: OpenCode database not found. OpenCode sessions will be monitored after OpenCode has been run at least once.'
      );
      return;
    }

    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(this.opencodeStorageUri, 'opencode.db*')
    );

    const triggerSync = () => {
      this.scheduleSync(250);
    };

    watcher.onDidCreate(triggerSync);
    watcher.onDidChange(triggerSync);
    watcher.onDidDelete(triggerSync);
    this.disposables.push(watcher);

    this.pollTimer = setInterval(() => {
      this.scheduleSync();
    }, 3000);

    console.log('[AgentObservatory] OpenCode database watcher started');
    await this.sync(true);
  }

  stop(): void {
    this.disposables.forEach(disposable => disposable.dispose());
    this.disposables.length = 0;

    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }

    if (this.syncTimer) {
      clearTimeout(this.syncTimer);
      this.syncTimer = undefined;
    }

    console.log('[AgentObservatory] OpenCode database watcher stopped');
  }

  private scheduleSync(delayMs: number = 0): void {
    if (this.syncTimer) {
      clearTimeout(this.syncTimer);
    }

    this.syncTimer = setTimeout(() => {
      this.syncTimer = undefined;
      void this.sync();
    }, delayMs);
  }

  private async sync(force: boolean = false): Promise<void> {
    if (this.syncInProgress) {
      this.syncQueued = true;
      return;
    }

    this.syncInProgress = true;

    try {
      const snapshot = this.readSnapshot(force);
      if (!snapshot) {
        return;
      }

      const derivedState = OpenCodeParser.parseDatabase(snapshot.data);
      this.store.replaceToolState('opencode', derivedState);
      this.stateManager.refreshPanel();
      this.watermarks = snapshot.watermarks;

      console.log(
        `[AgentObservatory] OpenCode sync complete: ${Object.keys(derivedState.sessions).length} sessions, ${Object.keys(derivedState.agents).length} agents`
      );
    } catch (error) {
      console.error('[AgentObservatory] Failed to sync OpenCode database:', error);
    } finally {
      this.syncInProgress = false;

      if (this.syncQueued) {
        this.syncQueued = false;
        this.scheduleSync();
      }
    }
  }

  private readSnapshot(force: boolean): {
    data: Parameters<typeof OpenCodeParser.parseDatabase>[0];
    watermarks: OpenCodeWatermarks;
  } | null {
    const database = new DatabaseSync(this.databasePath, { readonly: true });

    try {
      const watermarks = this.readWatermarks(database);
      const changed =
        force ||
        watermarks.sessionMaxTime > this.watermarks.sessionMaxTime ||
        watermarks.messageMaxTime > this.watermarks.messageMaxTime ||
        watermarks.partMaxTime > this.watermarks.partMaxTime ||
        watermarks.sessionCount !== this.watermarks.sessionCount ||
        watermarks.messageCount !== this.watermarks.messageCount ||
        watermarks.partCount !== this.watermarks.partCount;

      if (!changed) {
        return null;
      }

      const projects = database.prepare(`
        SELECT
          id,
          worktree,
          name,
          time_updated AS timeUpdated
        FROM project
      `).all();

      const sessions = database.prepare(`
        SELECT
          id,
          project_id AS projectId,
          parent_id AS parentId,
          directory,
          title,
          time_created AS timeCreated,
          time_updated AS timeUpdated,
          time_archived AS timeArchived
        FROM session
      `).all();

      const messages = database.prepare(`
        SELECT
          id,
          session_id AS sessionId,
          time_created AS timeCreated,
          time_updated AS timeUpdated,
          data
        FROM message
      `).all();

      const parts = database.prepare(`
        SELECT
          id,
          session_id AS sessionId,
          message_id AS messageId,
          time_created AS timeCreated,
          time_updated AS timeUpdated,
          data
        FROM part
      `).all();

      return {
        data: {
          projects,
          sessions,
          messages,
          parts
        },
        watermarks
      };
    } finally {
      database.close();
    }
  }

  private readWatermarks(database: DatabaseSync): OpenCodeWatermarks {
    const readTableStats = (table: string): { maxTime: number; count: number } => {
      const row = database.prepare(`
        SELECT
          COALESCE(MAX(time_updated), 0) AS updated,
          COALESCE(MAX(time_created), 0) AS created,
          COUNT(1) AS count
        FROM ${table}
      `).get() as { updated: number; created: number; count: number };

      const updated = typeof row?.updated === 'number' ? row.updated : 0;
      const created = typeof row?.created === 'number' ? row.created : 0;
      const count = typeof row?.count === 'number' ? row.count : 0;
      return {
        maxTime: Math.max(updated, created),
        count
      };
    };

    const sessionStats = readTableStats('session');
    const messageStats = readTableStats('message');
    const partStats = readTableStats('part');

    return {
      sessionMaxTime: sessionStats.maxTime,
      messageMaxTime: messageStats.maxTime,
      partMaxTime: partStats.maxTime,
      sessionCount: sessionStats.count,
      messageCount: messageStats.count,
      partCount: partStats.count
    };
  }
}
