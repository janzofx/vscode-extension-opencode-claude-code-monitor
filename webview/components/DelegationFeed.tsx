import React from 'react';
import type { DelegationEvent, Agent } from '../types';
import { useDashboardStore } from '../store/dashboardStore';

/**
 * DelegationFeed Component
 * Shows chronological feed of delegation events
 */
export const DelegationFeed: React.FC = () => {
  const { delegations, agents, selectedSessionId } = useDashboardStore();

  // Filter delegations for selected session
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

  return (
    <div className="delegation-feed">
      <div className="delegation-feed-header">
        <h2>Delegation Feed</h2>
      </div>
      <div className="delegation-feed-items">
        {sessionDelegations.length === 0 ? (
          <div className="empty-state">No delegations yet</div>
        ) : (
          sessionDelegations.map(delegation => {
            const fromAgent = getAgentLabel(delegation.fromAgentId);
            const toAgent = getAgentLabel(delegation.toAgentId);
            const isPending = delegation.status === 'pending';

            return (
              <div key={delegation.id} className={`delegation-item ${isPending ? 'pending' : 'completed'}`}>
                <div className="delegation-timestamp">
                  [{formatTime(delegation.createdAt)}]
                </div>
                <div className="delegation-content">
                  <div className="delegation-header">
                    <span className="agent-from">{fromAgent}</span>
                    <span className="arrow">→</span>
                    <span className="agent-to">{toAgent}</span>
                    <span className="status-icon">{isPending ? '⟳' : '✓'}</span>
                  </div>
                  <div className="delegation-prompt">
                    "{delegation.prompt}"
                  </div>
                  {delegation.result && (
                    <div className="delegation-result">
                      <span className="result-prefix">{toAgent} → main-agent</span>
                      "{delegation.result.substring(0, 200)}{delegation.result.length > 200 ? '...' : ''}"
                    </div>
                  )}
                  {isPending && (
                    <div className="delegation-in-progress">⟳ in progress...</div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
