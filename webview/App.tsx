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

// Debug: Log when app mounts
if (typeof window !== 'undefined') {
  console.log('[AgentObservatory Webview] App mounted');
}
const App: React.FC = () => {
  const { connectionStatus, isMuted, toggleMute, handleExtensionMessage, selectedSessionId } = useDashboardStore();
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    // Send READY message to extension
    vscode.postMessage({ type: 'READY' });

    // Listen for messages from extension
    const handleMessage = (event: MessageEvent) => {
      const message: ExtensionMessage = event.data;

      // If we receive INITIAL_STATE, mark as ready and process it
      if (message.type === 'INITIAL_STATE') {
        setIsReady(true);
        handleExtensionMessage(message);
      } else if (isReady) {
        // Only process other messages after INITIAL_STATE
        handleExtensionMessage(message);
      }
    };

    window.addEventListener('message', handleMessage);

    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, [handleExtensionMessage, isReady]);

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-title">
          <span className="icon">🔭</span>
          <span>Agent Observatory</span>
        </div>
        <div className="header-controls">
          <div className={`connection-status ${connectionStatus}`}>
            {connectionStatus === 'connected' ? '●' : '○'}
            <span>{connectionStatus}</span>
          </div>
          <button
            className="mute-toggle"
            onClick={toggleMute}
            title={isMuted ? 'Unmute notifications' : 'Mute notifications'}
          >
            {isMuted ? '🔇' : '🔔'}
          </button>
        </div>
      </header>

      <main className="app-main">
        <section className="sidebar">
          <SessionList />
        </section>

        <section className="center-panel">
          {selectedSessionId ? (
            <AgentTree />
          ) : (
            <div className="placeholder">
              Select a session to view agent tree
            </div>
          )}
        </section>

        <section className="right-panel">
          {selectedSessionId ? (
            <DelegationFeed />
          ) : (
            <div className="placeholder">
              Select a session to view delegation feed
            </div>
          )}
        </section>
      </main>

      <footer className="app-footer">
        <div className="app-footer-tabs">
          <div className="app-footer-tab">
            <div className="app-footer-tab-header">
              <h2>Progress</h2>
            </div>
            <div className="app-footer-tab-content">
              {selectedSessionId ? (
                <div className="progress-grid">
                  <div className="progress-column">
                    <div className="progress-column-header">Tasks</div>
                    <TaskProgress />
                  </div>
                  <div className="progress-column">
                    <div className="progress-column-header">Files</div>
                    <FileWorkspace />
                  </div>
                </div>
              ) : (
                <div className="placeholder">
                  Select a session to view details
                </div>
              )}
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default App;
