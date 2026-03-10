import * as fs from 'fs/promises';
import type {
  Session,
  Agent,
  DelegationEvent,
  JsonlEntry,
  ToolCallEntry,
  ToolResultEntry
} from '../types';

/**
 * Claude Code Parser
 * Parses JSONL transcript files and sessions-index.json
 */

export class ClaudeCodeParser {
  private static readonly STALE_ACTIVE_MS = 60 * 60 * 1000;

  /**
   * Parse a JSONL transcript file
   * Each line is a separate JSON object
   */
  static async parseJsonl(filePath: string): Promise<JsonlEntry[]> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.trim().split('\n');
      const entries: JsonlEntry[] = [];

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const entry = JSON.parse(line);
          entries.push(entry);
        } catch {
          // Skip malformed lines
        }
      }

      return entries;
    } catch (error) {
      console.error(`[AgentObservatory] Failed to parse JSONL ${filePath}:`, error);
      return [];
    }
  }

  /**
   * Parse sessions-index.json for pre-computed metadata
   */
  static async parseSessionsIndex(filePath: string): Promise<any> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      console.error(`[AgentObservatory] Failed to parse sessions-index ${filePath}:`, error);
      return null;
    }
  }

  /**
   * Extract session info from JSONL entries
   * Used when scanning existing sessions on startup
   */
  static extractSessionFromJsonl(
    entries: JsonlEntry[],
    sessionPath: string,
    cwd: string
  ): Partial<Session> {
    // Extract session ID from file path
    const sessionId = sessionPath.split(/[/\\]/).pop()?.replace('.jsonl', '') || '';

    // Find the first tool_use to determine activity
    const firstToolUse = entries.find((e): e is ToolCallEntry => e.type === 'tool_use');
    const lastTimestamp = entries.at(-1)?.timestamp || entries[0]?.timestamp || Date.now();
    const isFresh = Date.now() - lastTimestamp <= this.STALE_ACTIVE_MS;

    return {
      id: sessionId,
      tool: 'claude-code',
      cwd,
      projectName: this.getProjectName(cwd),
      status: isFresh ? 'active' : 'idle',
      startedAt: entries[0]?.timestamp || Date.now(),
      lastActivityAt: firstToolUse?.timestamp || lastTimestamp
    };
  }

  /**
   * Extract delegation events from JSONL entries
   */
  static extractDelegations(
    entries: JsonlEntry[],
    sessionId: string
  ): Partial<DelegationEvent>[] {
    const delegations: Partial<DelegationEvent>[] = [];
    const toolUseMap = new Map<string, ToolCallEntry>();

    // First pass: collect all tool uses with their tool_use_id
    for (const entry of entries) {
      if (entry.type === 'tool_use') {
        const toolCall = entry as ToolCallEntry & { id: string };
        toolUseMap.set(toolCall.id, toolCall);
      }
    }

    // Second pass: find Task tool uses with results
    for (const entry of entries) {
      if (entry.type === 'tool_result') {
        const toolResult = entry as ToolResultEntry;
        const toolUse = toolUseMap.get(toolResult.tool_use_id);

        if (toolUse && toolUse.name === 'Task') {
          const toolCall = toolUse as ToolCallEntry & { id: string };
          delegations.push({
            id: `${sessionId}_${toolCall.id}`,
            sessionId,
            fromAgentId: sessionId, // Main agent for now
            toAgentId: 'pending',
            prompt: toolUse.input.description || toolUse.input.task_description || 'No description',
            result: toolResult.output || toolResult.error,
            status: 'completed',
            createdAt: toolUse.timestamp || Date.now(),
            completedAt: Date.now()
          });
        }
      }
    }

    return delegations;
  }

  private static getProjectName(cwd: string): string {
    const parts = cwd.split(/[/\\]/);
    return parts[parts.length - 1] || cwd;
  }
}
