import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import type { StateStore } from '../store';
import { ClaudeCodeParser } from '../parsers/claudeCode';
import type { Session, DelegationEvent } from '../types';
import type { StateManager } from '../state';

/**
 * Claude Code FileSystemWatcher
 * Watches for JSONL session files and sessions-index.json
 *
 * CRITICAL: Must use vscode.Uri.file() with RelativePattern for paths
 * outside the workspace. Plain string globs only watch inside workspace.
 */

export class ClaudeCodeWatcher {
  private disposables: vscode.Disposable[] = [];
  private store: StateStore;
  private stateManager: StateManager;
  private claudeProjectsUri: vscode.Uri;
  private claudeRootUri: vscode.Uri;
  private claudeWatchUri: vscode.Uri | null = null;

  constructor(store: StateStore, stateManager: StateManager) {
    this.store = store;
    this.stateManager = stateManager;
    this.claudeRootUri = vscode.Uri.file(
      path.join(process.env.USERPROFILE!, '.claude')
    );
    this.claudeProjectsUri = vscode.Uri.file(
      path.join(this.claudeRootUri.fsPath, 'projects')
    );
  }

  async start(): Promise<void> {
    this.claudeWatchUri = await this.resolveWatchRoot();

    // Watcher 1: new/changed JSONL session files
    const jsonlWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(this.claudeWatchUri, '**/*.jsonl')
    );

    jsonlWatcher.onDidCreate(async (uri) => {
      await this.handleNewSession(uri);
    });

    jsonlWatcher.onDidChange(async (uri) => {
      await this.handleSessionUpdate(uri);
    });

    this.disposables.push(jsonlWatcher);

    // Watcher 2: sessions-index.json for metadata
    const indexWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(this.claudeWatchUri, '**/sessions-index.json')
    );

    indexWatcher.onDidChange(async (uri) => {
      await this.handleSessionsIndexUpdate(uri);
    });

    this.disposables.push(indexWatcher);

    console.log('[AgentObservatory] Claude Code watchers started');

    // Initial scan of existing sessions
    await this.scanExistingSessions();
  }

  stop(): void {
    this.disposables.forEach(d => d.dispose());
    this.disposables = [];
    console.log('[AgentObservatory] Claude Code watchers stopped');
  }

  private async handleNewSession(uri: vscode.Uri): Promise<void> {
    try {
      const filePath = uri.fsPath;
      let cwd = this.extractCwdFromPath(filePath);

      if (!cwd) {
        console.warn(`[AgentObservatory] Could not extract cwd from: ${filePath}`);
        cwd = path.dirname(filePath);
      }

      const entries = await ClaudeCodeParser.parseJsonl(filePath);
      const session = ClaudeCodeParser.extractSessionFromJsonl(entries, filePath, cwd);

      this.store.updateSessions({ [session.id!]: session as Session });

      // Extract delegations from JSONL
      const delegations = ClaudeCodeParser.extractDelegations(entries, session.id!);
      const delegationMap: Record<string, DelegationEvent> = {};

      for (const d of delegations) {
        if (d.id) {
          delegationMap[d.id] = d as DelegationEvent;
        }
      }

      this.store.updateDelegations(delegationMap);
      this.stateManager.refreshPanel();

      console.log(`[AgentObservatory] New session detected: ${session.id}`);
    } catch (error) {
      console.error('[AgentObservatory] Error handling new session:', error);
    }
  }

  private async handleSessionUpdate(uri: vscode.Uri): Promise<void> {
    try {
      const filePath = uri.fsPath;
      const entries = await ClaudeCodeParser.parseJsonl(filePath);
      const sessionId = filePath.split(/[/\\]/).pop()?.replace('.jsonl', '');

      if (!sessionId) return;

      // Extract new delegations from updated JSONL
      const delegations = ClaudeCodeParser.extractDelegations(entries, sessionId);
      const delegationMap: Record<string, DelegationEvent> = {};

      for (const d of delegations) {
        if (d.id) {
          delegationMap[d.id] = d as DelegationEvent;
        }
      }

      this.store.updateDelegations(delegationMap);

      // Update session last activity
      this.store.updateSession(sessionId, {
        lastActivityAt: Date.now(),
        status: 'active'
      });
      this.stateManager.refreshPanel();

      console.log(`[AgentObservatory] Session updated: ${sessionId}`);
    } catch (error) {
      console.error('[AgentObservatory] Error handling session update:', error);
    }
  }

  private async handleSessionsIndexUpdate(uri: vscode.Uri): Promise<void> {
    try {
      const indexData = await ClaudeCodeParser.parseSessionsIndex(uri.fsPath);
      console.log('[AgentObservatory] Sessions index updated:', indexData);
      // Could update session metadata from index if needed
    } catch (error) {
      console.error('[AgentObservatory] Error handling sessions index update:', error);
    }
  }

  /**
   * Scan all existing JSONL files on startup
   */
  private async scanExistingSessions(): Promise<void> {
    try {
      const watchPath = this.claudeWatchUri?.fsPath || this.claudeProjectsUri.fsPath;

      // Check if directory exists
      try {
        await fs.access(watchPath);
      } catch {
        console.log('[AgentObservatory] Claude Code projects directory does not exist yet');
        return;
      }

      const pending: string[] = [watchPath];

      while (pending.length) {
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

          if (entry.isFile() && entry.name.endsWith('.jsonl')) {
            await this.handleNewSession(vscode.Uri.file(entryPath));
          }
        }
      }

      console.log('[AgentObservatory] Initial scan complete');
      this.stateManager.refreshPanel();
    } catch (error) {
      console.error('[AgentObservatory] Error scanning existing sessions:', error);
    }
  }

  /**
   * Decode the project directory name to extract the original cwd
   * Note: Encoding is lossy - this is a best-effort fallback only
   * Real sessions will have the cwd from SessionStart hook
   */
  private decodeProjectName(encodedName: string): string | null {
    try {
      // Replace leading "C--" with "C:\" for Windows drive letter
      let decoded = encodedName;

      if (decoded.startsWith('C--')) {
        decoded = 'C:\\' + decoded.substring(3);
      } else if (decoded.match(/^[A-Z]--/)) {
        // Other drive letters
        decoded = decoded.charAt(0) + ':\\' + decoded.substring(3);
      }

      // Replace remaining "-" with spaces for display
      // This is a very rough approximation
      decoded = decoded.replace(/-/g, ' ');

      return decoded;
    } catch {
      return null;
    }
  }

  /**
   * Extract cwd from the full JSONL file path
   */
  private extractCwdFromPath(filePath: string): string | null {
    // Path structure: .../.claude/projects/<encoded-cwd>/<session-id>.jsonl
    const parts = filePath.split(/[/\\]/);

    const claudeIndex = parts.findIndex(p => p === '.claude');
    if (claudeIndex === -1) {
      return null;
    }

    let encodedCwd: string | undefined;

    const projectsIndex = parts.indexOf('projects', claudeIndex + 1);
    if (projectsIndex !== -1 && projectsIndex + 1 < parts.length) {
      encodedCwd = parts[projectsIndex + 1];
    }

    const sessionsIndex = parts.indexOf('sessions', claudeIndex + 1);
    if (!encodedCwd && sessionsIndex !== -1 && sessionsIndex + 1 < parts.length) {
      encodedCwd = parts[sessionsIndex + 1];
    }

    if (!encodedCwd && claudeIndex + 1 < parts.length) {
      encodedCwd = parts[claudeIndex + 1];
    }

    if (!encodedCwd) {
      return null;
    }

    return this.decodeProjectName(encodedCwd);
  }

  private async resolveWatchRoot(): Promise<vscode.Uri> {
    try {
      await fs.access(this.claudeProjectsUri.fsPath);
      return this.claudeProjectsUri;
    } catch {
      try {
        await fs.access(this.claudeRootUri.fsPath);
        console.log('[AgentObservatory] Falling back to .claude root for Claude Code sessions');
        return this.claudeRootUri;
      } catch {
        console.log('[AgentObservatory] Claude Code root directory does not exist yet');
        return this.claudeProjectsUri;
      }
    }
  }
}
