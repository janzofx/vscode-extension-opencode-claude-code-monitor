import * as fs from 'fs/promises';
import {
  deriveStatusLabelFromAssistantMessage,
  extractTextContent,
  formatStableTaskLabel
} from '../taskLabel';
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

  private static toTimestampMs(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === 'string') {
      const parsedNumber = Number(value);
      if (Number.isFinite(parsedNumber)) {
        return parsedNumber;
      }

      const parsedDate = Date.parse(value);
      if (Number.isFinite(parsedDate)) {
        return parsedDate;
      }
    }

    return undefined;
  }

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

    const firstTimestamp = this.toTimestampMs(entries[0]?.timestamp);
    const lastTimestamp = this.toTimestampMs(entries.at(-1)?.timestamp) ?? firstTimestamp ?? Date.now();
    const isFresh = Date.now() - lastTimestamp <= this.STALE_ACTIVE_MS;

    return {
      id: sessionId,
      tool: 'claude-code',
      cwd,
      projectName: this.getProjectName(cwd),
      status: isFresh ? 'active' : 'idle',
      startedAt: firstTimestamp ?? Date.now(),
      lastActivityAt: lastTimestamp
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
          const createdAt = this.toTimestampMs(toolUse.timestamp) ?? Date.now();
          const completedAt = this.toTimestampMs(toolResult.timestamp) ?? createdAt;
          delegations.push({
            id: `${sessionId}_${toolCall.id}`,
            sessionId,
            fromAgentId: sessionId, // Main agent for now
            toAgentId: 'pending',
            prompt: toolUse.input.description || toolUse.input.task_description || 'No description',
            result: toolResult.output || toolResult.error,
            status: 'completed',
            createdAt,
            completedAt
          });
        }
      }
    }

    return delegations;
  }

  static extractCurrentTaskFromJsonl(entries: JsonlEntry[]): string | undefined {
    const latestUserPrompt = this.findLatestUserPrompt(entries);
    if (latestUserPrompt?.label) {
      return latestUserPrompt.label;
    }

    if (latestUserPrompt) {
      const assistantAfterWeakPrompt = this.findLatestAssistantStatus(entries, latestUserPrompt.index + 1);
      if (assistantAfterWeakPrompt) {
        return assistantAfterWeakPrompt;
      }

      const previousStrongUserPrompt = this.findPreviousStrongUserPrompt(entries, latestUserPrompt.index - 1);
      if (previousStrongUserPrompt) {
        return previousStrongUserPrompt;
      }
    } else {
      const latestAssistantStatus = this.findLatestAssistantStatus(entries);
      if (latestAssistantStatus) {
        return latestAssistantStatus;
      }
    }

    return undefined;
  }

  private static findLatestUserPrompt(
    entries: JsonlEntry[]
  ): { index: number; label?: string } | undefined {
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const promptText = this.extractUserPromptText(entries[index]);
      if (promptText === undefined) {
        continue;
      }

      return {
        index,
        label: formatStableTaskLabel(promptText)
      };
    }

    return undefined;
  }

  private static findPreviousStrongUserPrompt(entries: JsonlEntry[], endIndex: number): string | undefined {
    for (let index = endIndex; index >= 0; index -= 1) {
      const promptText = this.extractUserPromptText(entries[index]);
      const label = formatStableTaskLabel(promptText);
      if (label) {
        return label;
      }
    }

    return undefined;
  }

  private static findLatestAssistantStatus(entries: JsonlEntry[], startIndex: number = 0): string | undefined {
    for (let index = entries.length - 1; index >= startIndex; index -= 1) {
      const assistantText = this.extractAssistantMessageText(entries[index]);
      const assistantLabel = deriveStatusLabelFromAssistantMessage(assistantText);
      if (assistantLabel) {
        return assistantLabel;
      }
    }

    return undefined;
  }

  private static extractAssistantMessageText(entry: any): string | undefined {
    if (!entry || typeof entry !== 'object') {
      return undefined;
    }

    if (entry.type === 'assistant') {
      return extractTextContent(entry.message || entry.content || entry.text);
    }

    if (entry.type === 'message' && entry.role === 'assistant') {
      return extractTextContent(entry.content || entry.message || entry.text);
    }

    if (entry.type === 'response_item' && entry.payload?.type === 'message' && entry.payload.role === 'assistant') {
      return extractTextContent(entry.payload.content);
    }

    return undefined;
  }

  private static extractUserPromptText(entry: any): string | undefined {
    if (!entry || typeof entry !== 'object') {
      return undefined;
    }

    if (entry.type === 'user') {
      return extractTextContent(entry.message || entry.content || entry.text);
    }

    if (entry.type === 'message' && entry.role === 'user') {
      return extractTextContent(entry.content || entry.message || entry.text);
    }

    if (entry.type === 'response_item' && entry.payload?.type === 'message' && entry.payload.role === 'user') {
      return extractTextContent(entry.payload.content);
    }

    return undefined;
  }

  private static getProjectName(cwd: string): string {
    const parts = cwd.split(/[/\\]/);
    return parts[parts.length - 1] || cwd;
  }
}
