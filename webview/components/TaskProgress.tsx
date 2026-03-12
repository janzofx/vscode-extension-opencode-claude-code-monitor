import React from 'react';
import { useDashboardStore } from '../store/dashboardStore';

/**
 * TaskProgress Component
 * Shows delegation tree as a task checklist
 */
export const TaskProgress: React.FC = () => {
  const { delegations, agents, sessions, selectedSessionId } = useDashboardStore();

  // Get selected session
  const selectedSession = React.useMemo(() => {
    return selectedSessionId ? sessions[selectedSessionId] : null;
  }, [sessions, selectedSessionId]);

  // Filter delegations for selected session
  const sessionDelegations = React.useMemo(() => {
    if (!selectedSessionId) return [];
    return Object.values(delegations)
      .filter(d => d.sessionId === selectedSessionId)
      .sort((a, b) => a.createdAt - b.createdAt);
  }, [delegations, selectedSessionId]);

  const getAgentLabel = (agentId: string): string => {
    const agent = agents[agentId];
    if (!agent) return 'unknown';
    if (agent.parentAgentId === null) return 'main-agent';
    return agent.agentType;
  };

  if (!selectedSession) {
    return (
      <div className="empty-state">
        Select a session to view task progress
      </div>
    );
  }

  const emptyMessage = selectedSession.tool === 'codex'
    ? 'Codex does not expose delegation task progress in the current local logs'
    : 'No tasks yet';

  return (
    <div className="task-progress">
      <div className="task-progress-header">
        <h2>Task Progress</h2>
        <span className="session-name">{selectedSession.projectName}</span>
      </div>
      <div className="task-progress-tree">
        {sessionDelegations.length === 0 ? (
          <div className="empty-state">{emptyMessage}</div>
        ) : (
          <ul className="task-list">
            {sessionDelegations.map(delegation => {
              const isCompleted = delegation.status === 'completed';
              const agentLabel = getAgentLabel(delegation.toAgentId);

              return (
                <li key={delegation.id} className={`task-item ${isCompleted ? 'completed' : 'pending'}`}>
                  <span className="task-checkbox">
                    {isCompleted ? '[✓]' : '[ ]'}
                  </span>
                  <span className="task-text">
                    {delegation.prompt.substring(0, 60)}
                    {delegation.prompt.length > 60 ? '...' : ''}
                  </span>
                  <span className="task-agent">{agentLabel}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
};
