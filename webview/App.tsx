import React, { useEffect, useState } from 'react';
import { SessionList } from './components/SessionList';
import { AgentTree } from './components/AgentTree';
import { DelegationFeed } from './components/DelegationFeed';
import { TaskProgress } from './components/TaskProgress';
import { FileWorkspace } from './components/FileWorkspace';
import { useDashboardStore } from './store/dashboardStore';
import type { ExtensionMessage } from './types';
import { vscode } from './vscode';

/**
 * Main App Component
 */

if (typeof window !== 'undefined') {
  console.log('[AgentObservatory Webview] App mounted');
}

const App: React.FC = () => {
  const {
    connectionStatus,
    isMuted,
    toggleMute,
    handleExtensionMessage,
    selectedSessionId,
    sessions
  } = useDashboardStore();
  const [isReady, setIsReady] = useState(false);
  const selectedSession = selectedSessionId ? sessions[selectedSessionId] : null;

  useEffect(() => {
    vscode.postMessage({ type: 'READY' });

    const handleMessage = (event: MessageEvent) => {
      const message: ExtensionMessage = event.data;

      if (message.type === 'INITIAL_STATE') {
        setIsReady(true);
        handleExtensionMessage(message);
      } else if (isReady) {
        handleExtensionMessage(message);
      }
    };

    window.addEventListener('message', handleMessage);

    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, [handleExtensionMessage, isReady]);

  const getToolLabel = (tool: string | undefined): string => {
    switch (tool) {
      case 'claude-code':
        return 'Claude Code';
      case 'opencode':
        return 'OpenCode';
      case 'codex':
        return 'Codex';
      default:
        return 'No Session';
    }
  };

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-brand">
          <span className="brand-mark" aria-hidden="true" />
          <div className="brand-copy">
            <span className="brand-eyebrow">Agent Observatory</span>
            <span className="brand-title">Mission Control</span>
          </div>
        </div>

        <div className="header-focus">
          <span className="header-focus-label">Focus</span>
          {selectedSession ? (
            <div className="header-focus-content">
              <span className="header-focus-name">{selectedSession.projectName}</span>
              <span className={`header-focus-tool tool-${selectedSession.tool}`}>
                {getToolLabel(selectedSession.tool)}
              </span>
            </div>
          ) : (
            <span className="header-focus-empty">No session selected</span>
          )}
        </div>

        <div className="header-controls">
          <div className={`connection-status ${connectionStatus}`}>
            <span className="connection-indicator" aria-hidden="true" />
            <span>{connectionStatus}</span>
          </div>
          <button
            className="mute-toggle"
            onClick={toggleMute}
            title={isMuted ? 'Unmute notifications' : 'Mute notifications'}
          >
            <span className={`mute-indicator ${isMuted ? 'muted' : 'armed'}`} aria-hidden="true" />
            <span>{isMuted ? 'Muted' : 'Alerts'}</span>
          </button>
        </div>
      </header>

      <div className="app-body">
        <main className="control-grid">
          <section className="control-zone fleet-zone">
            <SessionList />
          </section>

          <section className="control-zone command-zone">
            {selectedSessionId ? (
              <DelegationFeed />
            ) : (
              <div className="placeholder">
                Select a session to monitor delegation flow
              </div>
            )}
          </section>

          <section className="control-zone inspector-zone">
            {selectedSessionId ? (
              <AgentTree />
            ) : (
              <div className="placeholder">
                Select a session to inspect active agents
              </div>
            )}
          </section>
        </main>

        <footer className="telemetry-dock">
          <section className="dock-zone dock-zone-progress">
            {selectedSessionId ? (
              <TaskProgress />
            ) : (
              <div className="placeholder">
                Select a session to view task telemetry
              </div>
            )}
          </section>

          <section className="dock-zone dock-zone-files">
            {selectedSessionId ? (
              <FileWorkspace />
            ) : (
              <div className="placeholder">
                Select a session to view file activity
              </div>
            )}
          </section>
        </footer>
      </div>
    </div>
  );
};

export default App;
