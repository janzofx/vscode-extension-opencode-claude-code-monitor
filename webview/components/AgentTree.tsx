import React, { useMemo, useState } from 'react';
import type { Agent } from '../types';
import { useDashboardStore } from '../store/dashboardStore';

/**
 * AgentTree Component
 * Shows active agents as tabs with their current tasks
 */
export const AgentTree: React.FC = () => {
  const { agents, selectedSessionId } = useDashboardStore();
  const [activeAgentId, setActiveAgentId] = useState<string | null>(null);

  const sessionAgents = useMemo(() => {
    if (!selectedSessionId) return [];
    return Object.values(agents).filter(
      agent => agent.sessionId === selectedSessionId && agent.status === 'active'
    );
  }, [agents, selectedSessionId]);

  const sortedAgents = useMemo(() => {
    return [...sessionAgents].sort((a, b) => {
      if (a.parentAgentId === null && b.parentAgentId !== null) return -1;
      if (a.parentAgentId !== null && b.parentAgentId === null) return 1;
      return a.startedAt - b.startedAt;
    });
  }, [sessionAgents]);

  const selectedAgent = useMemo(() => {
    if (!sortedAgents.length) return null;
    const candidate = sortedAgents.find(agent => agent.id === activeAgentId);
    return candidate || sortedAgents[0];
  }, [sortedAgents, activeAgentId]);

  const getAgentLabel = (agent: Agent): string => {
    if (agent.parentAgentId === null) return 'Main';
    return agent.agentType || 'Subagent';
  };

  if (sessionAgents.length === 0) {
    return (
      <div className="empty-state">
        No active agents for this session
      </div>
    );
  }

  return (
    <div className="agent-tabs">
      <div className="agent-tabs-header">
        {sortedAgents.map(agent => (
          <button
            key={agent.id}
            className={`agent-tab ${selectedAgent?.id === agent.id ? 'active' : ''}`}
            onClick={() => setActiveAgentId(agent.id)}
            title={agent.agentType}
          >
            <span className="agent-tab-label">{getAgentLabel(agent)}</span>
            <span className="agent-tab-status">Active</span>
          </button>
        ))}
      </div>
      <div className="agent-tabs-content">
        <div className="agent-task-label">Current Task</div>
        <div className="agent-task-value">
          {selectedAgent?.currentTask ? selectedAgent.currentTask : 'No active task reported'}
        </div>
      </div>
    </div>
  );
};
