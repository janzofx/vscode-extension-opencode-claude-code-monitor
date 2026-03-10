import React, { useState, useEffect } from 'react';
import type { FileEvent, Agent } from '../types';
import { useDashboardStore } from '../store/dashboardStore';

/**
 * FileWorkspace Component
 * Shows a flat list of files touched in the current session
 */
export const FileWorkspace: React.FC = () => {
  const { fileEvents, agents, selectedSessionId } = useDashboardStore();
  const [highlightedFile, setHighlightedFile] = useState<string | null>(null);

  const sessionFileEvents = React.useMemo(() => {
    if (!selectedSessionId) return [];
    return fileEvents.filter(f => f.sessionId === selectedSessionId);
  }, [fileEvents, selectedSessionId]);

  const fileMap = React.useMemo(() => {
    const map = new Map<string, FileEvent>();

    for (const event of sessionFileEvents) {
      const existing = map.get(event.filePath);
      if (!existing || event.createdAt > existing.createdAt) {
        map.set(event.filePath, event);
      }
    }

    return map;
  }, [sessionFileEvents]);

  const files = Array.from(fileMap.values())
    .sort((a, b) => b.createdAt - a.createdAt);

  useEffect(() => {
    if (files.length > 0) {
      setHighlightedFile(files[0].filePath);
      const timer = setTimeout(() => {
        setHighlightedFile(null);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [sessionFileEvents]);

  const getAgentLabel = (agentId: string): string => {
    const agent = agents[agentId];
    if (!agent) return 'unknown';
    if (agent.parentAgentId === null) return 'main-agent';
    return agent.agentType;
  };

  const getOperationLabel = (operation: string): string => {
    switch (operation) {
      case 'read': return 'READ';
      case 'write': return 'WRITE';
      case 'edit': return 'EDIT';
      default: return 'FILE';
    }
  };

  if (files.length === 0) {
    return (
      <div className="empty-state">
        No file activity yet for this session
      </div>
    );
  }

  return (
    <div className="file-workspace">
      <div className="file-flat-list">
        {files.map(file => {
          const isHighlighted = highlightedFile === file.filePath;
          const agentLabel = getAgentLabel(file.agentId);

          return (
            <div
              key={file.filePath}
              className={`file-item ${isHighlighted ? 'highlighted' : ''}`}
            >
              <span className={`file-op-badge file-op-${file.operation}`}>
                {getOperationLabel(file.operation)}
              </span>
              <span className="file-name">{file.filePath}</span>
              <span className="file-agents">[{agentLabel}]</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
