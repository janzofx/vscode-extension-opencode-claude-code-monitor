import * as vscode from 'vscode';
import { StateStore } from './store';
import { StateManager } from './state';
import { HookServer } from './server';
import { PanelManager } from './panel';
import { ClaudeCodeWatcher } from './watchers/claudeCode';
import { OpenCodeWatcher } from './watchers/opencode';

/**
 * Extension Activation
 */

export async function activate(context: vscode.ExtensionContext) {
  console.log('[AgentObservatory] Extension is now active!');

  // Initialize state store and load persisted state
  const stateStore = new StateStore(context);
  await stateStore.load();
  console.log('[AgentObservatory] State loaded successfully');

  // Initialize state manager
  const stateManager = new StateManager(stateStore);
  stateManager.markStaleClaudeSessionsIdle();

  const getHookPort = (): number => {
    const config = vscode.workspace.getConfiguration('agentObservatory');
    const configuredPort = config.get<number>('hooksPort', 3001);
    if (!Number.isInteger(configuredPort) || configuredPort < 1 || configuredPort > 65535) {
      vscode.window.showWarningMessage(
        'Agent Observatory: Invalid hooks port configured. Falling back to 3001.'
      );
      return 3001;
    }
    return configuredPort;
  };

  // Start Express HTTP server for Claude Code hooks
  const hookServer = new HookServer(stateManager, getHookPort());
  const serverStarted = hookServer.start();

  if (serverStarted) {
    console.log('[AgentObservatory] Hook server started successfully');
  } else {
    console.warn('[AgentObservatory] Hook server failed to start - file watching only');
  }

  // Start FileSystemWatchers
  const claudeCodeWatcher = new ClaudeCodeWatcher(stateStore, stateManager);
  const opencodeWatcher = new OpenCodeWatcher(stateStore, stateManager);

  const watcherResults = await Promise.allSettled([
    claudeCodeWatcher.start(),
    opencodeWatcher.start()
  ]);

  if (watcherResults[0].status === 'rejected') {
    console.error('[AgentObservatory] Failed to start Claude Code watcher:', watcherResults[0].reason);
  }

  if (watcherResults[1].status === 'rejected') {
    console.error('[AgentObservatory] Failed to start OpenCode watcher:', watcherResults[1].reason);
  }

  // Register command to open panel
  const openPanelCommand = vscode.commands.registerCommand(
    'agent-observatory.openPanel',
    () => {
      PanelManager.createOrShow(context.extensionUri, stateManager);
    }
  );

  context.subscriptions.push(openPanelCommand, {
    dispose: () => {
      hookServer.stop();
      claudeCodeWatcher.stop();
      opencodeWatcher.stop();
    }
  });

  const staleTimer = setInterval(() => {
    stateManager.markStaleClaudeSessionsIdle();
  }, 60000);

  const configListener = vscode.workspace.onDidChangeConfiguration(event => {
    if (event.affectsConfiguration('agentObservatory.hooksPort')) {
      hookServer.updatePort(getHookPort());
    }
  });

  context.subscriptions.push(configListener, {
    dispose: () => clearInterval(staleTimer)
  });

  // Auto-open panel on activation
  PanelManager.createOrShow(context.extensionUri, stateManager);
}

/**
 * Extension Deactivation
 */
export function deactivate() {
  console.log('[AgentObservatory] Extension deactivated');
}
