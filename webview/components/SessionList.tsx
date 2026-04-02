import React, { useState } from 'react';
import { useDashboardStore } from '../store/dashboardStore';

/**
 * SessionList Component
 * Lists all Claude Code, OpenCode, and Codex sessions
 */
export const SessionList: React.FC = () => {
  const { sessions, selectedSessionId, selectSession } = useDashboardStore();
  const [view, setView] = useState<'all' | 'active'>('all');

  const sessionsArray = Object.values(sessions).sort((a, b) => {
    return b.startedAt - a.startedAt;
  });

  const getToolBadge = (tool: string): string => {
    switch (tool) {
      case 'claude-code':
        return 'Claude Code';
      case 'opencode':
        return 'OpenCode';
      case 'codex':
        return 'Codex';
      default:
        return tool;
    }
  };

  const formatTime = (timestamp: number): string => {
    const now = Date.now();
    const diff = now - timestamp;

    if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return new Date(timestamp).toLocaleDateString();
  };

  const visibleSessions = view === 'active'
    ? sessionsArray.filter(session => session.status === 'active')
    : sessionsArray;

  const emptyMessage = view === 'active' ? 'No active sessions' : 'No sessions yet';

  return (
    <div className="session-list">
      <div className="session-list-header">
        <h2>Session Fleet</h2>
        <div className="session-list-actions">
          <div className="session-list-filters">
            <button
              onClick={() => setView('all')}
              className={view === 'all' ? 'active' : ''}
            >
              All
            </button>
            <button
              onClick={() => setView('active')}
              className={view === 'active' ? 'active' : ''}
            >
              Active
            </button>
          </div>
          <button
            onClick={() => selectSession(null)}
            className="session-clear"
            title="Clear selection"
          >
            Clear
          </button>
        </div>
      </div>
      <div className="session-list-items">
        {visibleSessions.length === 0 ? (
          <div className="empty-state">{emptyMessage}</div>
        ) : (
          visibleSessions.map(session => (
            <div
              key={session.id}
              className={`session-item tool-${session.tool} status-${session.status} ${selectedSessionId === session.id ? 'selected' : ''}`}
              onClick={() => selectSession(session.id)}
            >
              <span className="session-item-signal" aria-hidden="true" />
              <div className="session-item-body">
                <div className="session-item-header">
                  <span className="session-title">{session.projectName}</span>
                  <span className={`session-status-chip status-${session.status}`}>
                    {session.status}
                  </span>
                </div>
                <div className="session-item-meta">
                  <span className={`tool-badge tool-${session.tool}`}>{getToolBadge(session.tool)}</span>
                  <span className="session-time">{formatTime(session.startedAt)}</span>
                </div>
                <div className="session-cwd">{session.cwd}</div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
