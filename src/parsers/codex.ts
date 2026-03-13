import * as fs from 'fs/promises';
import * as path from 'path';
import type {
  Agent,
  CodexStateSnapshot,
  FileEvent,
  FileOperation,
  Session,
  SessionStatus
} from '../types';

interface CodexSessionMetaPayload {
  id?: string;
  timestamp?: string;
  cwd?: string;
  originator?: string;
  source?: string;
  model?: string;
  model_provider?: string;
}

interface CodexFunctionCallPayload {
  type: 'function_call';
  name: string;
  arguments?: string | Record<string, any>;
  call_id?: string;
}

interface CodexMessagePayload {
  type: 'message';
  role?: string;
  content?: Array<{ type?: string; text?: string }>;
}

interface CodexEventMessagePayload {
  type: string;
  message?: string;
  phase?: string;
}

interface CodexLogEntry {
  timestamp?: string;
  type: string;
  payload?: any;
}

export class CodexParser {
  private static readonly STALE_ACTIVE_MS = 60 * 60 * 1000;

  static async parseJsonl(filePath: string): Promise<CodexLogEntry[]> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.trim().split('\n');
      const entries: CodexLogEntry[] = [];

      for (const line of lines) {
        if (!line.trim()) {
          continue;
        }

        try {
          entries.push(JSON.parse(line) as CodexLogEntry);
        } catch {
          // Skip malformed lines.
        }
      }

      return entries;
    } catch (error) {
      console.error(`[AgentObservatory] Failed to parse Codex JSONL ${filePath}:`, error);
      return [];
    }
  }

  static async parseSessionFile(filePath: string, archived: boolean): Promise<CodexStateSnapshot> {
    const entries = await this.parseJsonl(filePath);
    if (entries.length === 0) {
      return this.emptySnapshot();
    }

    const sessionMeta = entries.find((entry): entry is CodexLogEntry & { payload: CodexSessionMetaPayload } =>
      entry.type === 'session_meta'
    )?.payload;

    const sessionId = sessionMeta?.id || path.basename(filePath, '.jsonl');
    const cwd = sessionMeta?.cwd || path.dirname(filePath);
    const startedAt =
      this.parseTimestamp(sessionMeta?.timestamp) ||
      this.parseTimestamp(entries[0]?.timestamp) ||
      Date.now();
    const lastActivityAt = this.getLastActivityAt(entries, startedAt);
    const status = this.getSessionStatus(lastActivityAt, archived);
    const session: Session = {
      id: sessionId,
      tool: 'codex',
      cwd,
      projectName: this.getProjectName(cwd, sessionId),
      status,
      startedAt,
      completedAt: status === 'completed' ? lastActivityAt : undefined,
      model: sessionMeta?.model || sessionMeta?.model_provider,
      source: sessionMeta?.source || sessionMeta?.originator,
      lastActivityAt
    };

    const agent: Agent = {
      id: sessionId,
      sessionId,
      parentAgentId: null,
      agentType: 'Codex',
      status: status === 'completed' ? 'completed' : 'active',
      startedAt,
      completedAt: status === 'completed' ? lastActivityAt : undefined,
      lastMessage: this.getLastAgentMessage(entries),
      currentTask: this.getCurrentTask(entries)
    };

    return {
      sessions: { [sessionId]: session },
      agents: { [sessionId]: agent },
      delegations: {},
      fileEvents: this.extractFileEvents(entries, sessionId)
    };
  }

  private static emptySnapshot(): CodexStateSnapshot {
    return {
      sessions: {},
      agents: {},
      delegations: {},
      fileEvents: []
    };
  }

  private static getLastActivityAt(entries: CodexLogEntry[], fallback: number): number {
    let lastTimestamp = fallback;

    for (const entry of entries) {
      const timestamp = this.parseTimestamp(entry.timestamp);
      if (timestamp && timestamp > lastTimestamp) {
        lastTimestamp = timestamp;
      }
    }

    return lastTimestamp;
  }

  private static getSessionStatus(lastActivityAt: number, archived: boolean): SessionStatus {
    if (archived) {
      return 'completed';
    }

    return Date.now() - lastActivityAt <= this.STALE_ACTIVE_MS ? 'active' : 'idle';
  }

  private static getProjectName(cwd: string, fallback: string): string {
    const normalized = cwd.replace(/[\\/]+$/, '');
    const projectName = path.basename(normalized);
    return projectName || fallback;
  }

  private static getLastAgentMessage(entries: CodexLogEntry[]): string | undefined {
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const entry = entries[index];
      if (entry.type !== 'event_msg') {
        continue;
      }

      const payload = entry.payload as CodexEventMessagePayload | undefined;
      if (payload?.type === 'agent_message' && payload.message) {
        return payload.message;
      }
    }

    return undefined;
  }

  private static getCurrentTask(entries: CodexLogEntry[]): string | undefined {
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const entry = entries[index];

      if (entry.type === 'response_item') {
        const payload = entry.payload as CodexFunctionCallPayload | CodexMessagePayload | undefined;

        if (payload?.type === 'function_call' && payload.name) {
          return this.formatFunctionCallTask(payload.name, this.parseArguments(payload.arguments));
        }

        if (payload?.type === 'message') {
          const messageText = this.extractMessageText(payload);
          if (messageText) {
            return messageText;
          }
        }
      }

      if (entry.type === 'event_msg') {
        const payload = entry.payload as CodexEventMessagePayload | undefined;
        if (payload?.type === 'agent_message' && payload.message) {
          return payload.message;
        }
        if (payload?.type === 'task_started') {
          return 'Task started';
        }
      }
    }

    return undefined;
  }

  private static extractFileEvents(entries: CodexLogEntry[], sessionId: string): FileEvent[] {
    const fileEvents: FileEvent[] = [];

    for (const entry of entries) {
      if (entry.type !== 'response_item') {
        continue;
      }

      const payload = entry.payload as CodexFunctionCallPayload | undefined;
      if (payload?.type !== 'function_call' || !payload.name) {
        continue;
      }

      const createdAt = this.parseTimestamp(entry.timestamp) || Date.now();
      const args = this.parseArguments(payload.arguments);

      for (const fileEvent of this.extractFileEventsFromFunctionCall(payload.name, args, sessionId, createdAt)) {
        fileEvents.push(fileEvent);
      }
    }

    return fileEvents;
  }

  private static extractFileEventsFromFunctionCall(
    toolName: string,
    args: Record<string, any>,
    sessionId: string,
    createdAt: number
  ): FileEvent[] {
    const filePaths = new Set<string>();
    let operation: FileOperation | null = null;

    if (toolName === 'view_image' && typeof args.path === 'string') {
      filePaths.add(this.normalizePath(args.path, args.workdir));
      operation = 'read';
    }

    if (toolName === 'apply_patch') {
      const patchText = this.getPatchText(args);
      for (const filePath of this.extractPathsFromPatch(patchText, args.workdir)) {
        filePaths.add(filePath);
      }
      operation = 'edit';
    }

    if (toolName === 'shell_command' && typeof args.command === 'string') {
      for (const filePath of this.extractPathsFromShellCommand(args.command, args.workdir)) {
        filePaths.add(filePath);
      }
      operation = this.getShellCommandOperation(args.command);
    }

    if (!operation || filePaths.size === 0) {
      return [];
    }

    return Array.from(filePaths).map(filePath => ({
      sessionId,
      agentId: sessionId,
      filePath,
      operation,
      createdAt
    }));
  }

  private static parseArguments(rawArguments: string | Record<string, any> | undefined): Record<string, any> {
    if (!rawArguments) {
      return {};
    }

    if (typeof rawArguments === 'object') {
      return rawArguments;
    }

    try {
      return JSON.parse(rawArguments) as Record<string, any>;
    } catch {
      return { input: rawArguments };
    }
  }

  private static formatFunctionCallTask(toolName: string, args: Record<string, any>): string {
    if (toolName === 'shell_command' && typeof args.command === 'string') {
      return `shell_command: ${this.previewText(args.command)}`;
    }

    if (toolName === 'view_image' && typeof args.path === 'string') {
      return `view_image: ${args.path}`;
    }

    if (toolName === 'apply_patch') {
      const patchText = this.getPatchText(args);
      const patchTargets = this.extractPathsFromPatch(patchText, args.workdir);
      if (patchTargets.length > 0) {
        return `apply_patch: ${this.previewText(patchTargets.join(', '))}`;
      }
    }

    if (typeof args.path === 'string') {
      return `${toolName}: ${args.path}`;
    }

    return toolName;
  }

  private static extractMessageText(payload: CodexMessagePayload): string | undefined {
    if (!Array.isArray(payload.content)) {
      return undefined;
    }

    const textParts = payload.content
      .filter(part => part?.type === 'output_text' || part?.type === 'input_text')
      .map(part => part.text?.trim())
      .filter((part): part is string => Boolean(part));

    if (textParts.length === 0) {
      return undefined;
    }

    return this.previewText(textParts.join(' '), 120);
  }

  private static getPatchText(args: Record<string, any>): string {
    if (typeof args.patch === 'string') {
      return args.patch;
    }
    if (typeof args.input === 'string') {
      return args.input;
    }
    return '';
  }

  private static extractPathsFromPatch(patchText: string, workdir?: string): string[] {
    if (!patchText) {
      return [];
    }

    const filePaths = new Set<string>();

    for (const line of patchText.split(/\r?\n/)) {
      const match = line.match(/^\*\*\* (?:Update|Add|Delete) File: (.+)$/);
      if (match?.[1]) {
        filePaths.add(this.normalizePath(match[1].trim(), workdir));
      }
    }

    return Array.from(filePaths);
  }

  private static extractPathsFromShellCommand(command: string, workdir?: string): string[] {
    const filePaths = new Set<string>();
    const patterns = [
      /-(?:Path|LiteralPath)\s+['"]([^'"]+)['"]/gi,
      /\b(?:Get-Content|Select-String|Get-ChildItem)\s+['"]([^'"]+)['"]/gi
    ];

    for (const pattern of patterns) {
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(command)) !== null) {
        if (match[1]) {
          filePaths.add(this.normalizePath(match[1], workdir));
        }
      }
    }

    return Array.from(filePaths);
  }

  private static getShellCommandOperation(command: string): FileOperation {
    if (/\b(Set-Content|Add-Content|Out-File)\b/i.test(command)) {
      return 'write';
    }

    if (/\b(Edit|apply_patch)\b/i.test(command)) {
      return 'edit';
    }

    return 'read';
  }

  private static normalizePath(filePath: string, workdir?: string): string {
    if (!filePath) {
      return filePath;
    }

    if (path.isAbsolute(filePath)) {
      return path.normalize(filePath);
    }

    if (workdir) {
      return path.normalize(path.join(workdir, filePath));
    }

    return path.normalize(filePath);
  }

  private static parseTimestamp(value: string | undefined): number | undefined {
    if (!value) {
      return undefined;
    }

    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  private static previewText(value: string, maxLength: number = 80): string {
    const trimmed = value.trim();
    return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength)}...` : trimmed;
  }
}
