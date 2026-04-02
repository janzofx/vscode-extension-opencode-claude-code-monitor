import React from 'react';
import { useDashboardStore } from '../store/dashboardStore';

/**
 * DelegationFeed Component
 * Shows chronological feed of delegation events
 */
export const DelegationFeed: React.FC = () => {
  const { delegations, agents, sessions, selectedSessionId } = useDashboardStore();

  const sessionDelegations = React.useMemo(() => {
    if (!selectedSessionId) return [];
    return Object.values(delegations)
      .filter(d => d.sessionId === selectedSessionId)
      .sort((a, b) => a.createdAt - b.createdAt);
  }, [delegations, selectedSessionId]);

  const formatTime = (timestamp: number): string => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', { hour12: false });
  };

  const getAgentLabel = (agentId: string): string => {
    const agent = agents[agentId];
    if (!agent) return 'unknown';
    if (agent.parentAgentId === null) return 'main-agent';
    return agent.agentType;
  };

  const selectedSession = selectedSessionId ? sessions[selectedSessionId] : null;
  const emptyMessage = selectedSession?.tool === 'codex'
    ? 'Codex does not expose delegation events in the current local logs'
    : 'No delegations yet';

  return (
    <div className="delegation-feed">
      <div className="panel-header">
        <h2>Command Lane</h2>
      </div>

      <div className="delegation-feed-items">
        {sessionDelegations.length === 0 ? (
          <div className="empty-state">{emptyMessage}</div>
        ) : (
          sessionDelegations.map(delegation => {
            const fromAgent = getAgentLabel(delegation.fromAgentId);
            const toAgent = getAgentLabel(delegation.toAgentId);
            const isPending = delegation.status === 'pending';

            return (
              <div key={delegation.id} className={`delegation-item ${isPending ? 'pending' : 'completed'}`}>
                <div className="delegation-item-top">
                  <span className="delegation-timestamp">{formatTime(delegation.createdAt)}</span>
                  <span className={`delegation-state-chip ${isPending ? 'pending' : 'completed'}`}>
                    {isPending ? 'pending' : 'completed'}
                  </span>
                </div>

                <div className="delegation-route">
                  <span className="agent-from">{fromAgent}</span>
                  <span className="route-arrow">to</span>
                  <span className="agent-to">{toAgent}</span>
                </div>

                <div className="delegation-prompt">{delegation.prompt}</div>

                {delegation.result && (
                  <div className="delegation-result">
                    <span className="result-prefix">{toAgent} to main-agent</span>
                    {delegation.result.substring(0, 200)}
                    {delegation.result.length > 200 ? '...' : ''}
                  </div>
                )}

                {isPending && (
                  <div className="delegation-in-progress">Awaiting completion</div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
