import * as path from 'path';
import type {
  Agent,
  DelegationEvent,
  FileEvent,
  FileOperation,
  OpenCodeStateSnapshot,
  Session,
  SessionStatus
} from '../types';

export interface OpenCodeProjectRow {
  id: string;
  worktree: string;
  name: string | null;
  timeUpdated: number;
}

export interface OpenCodeSessionRow {
  id: string;
  projectId: string;
  parentId: string | null;
  directory: string;
  title: string;
  timeCreated: number;
  timeUpdated: number;
  timeArchived: number | null;
}

export interface OpenCodeMessageRow {
  id: string;
  sessionId: string;
  timeCreated: number;
  timeUpdated: number;
  data: string;
}

export interface OpenCodePartRow {
  id: string;
  sessionId: string;
  messageId: string;
  timeCreated: number;
  timeUpdated: number;
  data: string;
}

export interface OpenCodeDatabaseSnapshot {
  projects: OpenCodeProjectRow[];
  sessions: OpenCodeSessionRow[];
  messages: OpenCodeMessageRow[];
  parts: OpenCodePartRow[];
}

interface ParsedMessage extends Omit<OpenCodeMessageRow, 'data'> {
  dataObject: any;
}

interface ParsedPart extends Omit<OpenCodePartRow, 'data'> {
  dataObject: any;
}

interface ToolPartState {
  status?: string;
  input?: Record<string, any>;
  output?: any;
  error?: string;
  title?: string;
  metadata?: Record<string, any>;
  time?: {
    start?: number;
    end?: number;
  };
}

interface ParsedToolPart extends ParsedPart {
  dataObject: {
    type: 'tool';
    tool?: string;
    state?: ToolPartState;
  };
}

interface TaskMatch {
  taskPart: ParsedToolPart;
  childSessionId?: string;
}

/**
 * OpenCode Parser
 * Reconstructs dashboard state from OpenCode's SQLite-backed data model.
 */
export class OpenCodeParser {
  private static readonly STALE_ACTIVE_MS = 60 * 60 * 1000;

  static parseDatabase(snapshot: OpenCodeDatabaseSnapshot): OpenCodeStateSnapshot {
    const projectsById = new Map(snapshot.projects.map(project => [project.id, project]));
    const sessionsById = new Map(snapshot.sessions.map(session => [session.id, session]));
    const childrenByParent = new Map<string, OpenCodeSessionRow[]>();
    const rootCache = new Map<string, string>();

    for (const session of snapshot.sessions) {
      if (!session.parentId) {
        continue;
      }

      const children = childrenByParent.get(session.parentId) || [];
      children.push(session);
      childrenByParent.set(session.parentId, children);
    }

    for (const children of childrenByParent.values()) {
      children.sort((left, right) => left.timeCreated - right.timeCreated);
    }

    const getRootSessionId = (sessionId: string): string => {
      const cached = rootCache.get(sessionId);
      if (cached) {
        return cached;
      }

      const session = sessionsById.get(sessionId);
      if (!session || !session.parentId) {
        rootCache.set(sessionId, sessionId);
        return sessionId;
      }

      if (!sessionsById.has(session.parentId)) {
        rootCache.set(sessionId, session.id);
        return session.id;
      }

      const rootId = getRootSessionId(session.parentId);
      rootCache.set(sessionId, rootId);
      return rootId;
    };

    const parsedMessages = snapshot.messages
      .map(message => ({
        ...message,
        dataObject: this.safeParseJson(message.data)
      }))
      .sort((left, right) => left.timeCreated - right.timeCreated);

    const parsedParts = snapshot.parts
      .map(part => ({
        ...part,
        dataObject: this.safeParseJson(part.data)
      }))
      .sort((left, right) => left.timeCreated - right.timeCreated);

    const messagesBySession = this.groupBySession(parsedMessages);
    const partsBySession = this.groupBySession(parsedParts);
    const latestAssistantTextBySession = this.buildLatestAssistantText(partsBySession);
    const latestToolBySession = this.buildLatestToolParts(partsBySession);
    const latestRunningToolBySession = this.buildLatestRunningToolParts(partsBySession);
    const latestStepFinishBySession = this.buildLatestStepFinishParts(partsBySession);
    const taskMatches = this.matchTaskDelegations(parsedParts, sessionsById);

    const nextSessions: Record<string, Session> = {};
    const nextAgents: Record<string, Agent> = {};
    const nextDelegations: Record<string, DelegationEvent> = {};
    const nextFileEvents: FileEvent[] = [];

    const rootSessions = snapshot.sessions
      .filter(session => session.parentId === null || !sessionsById.has(session.parentId))
      .sort((left, right) => left.timeCreated - right.timeCreated);

    for (const session of rootSessions) {
      const project = projectsById.get(session.projectId);
      const lastActivityAt = this.getLastActivityAt(session, partsBySession, messagesBySession);
      const status = this.getSessionStatus(
        session,
        lastActivityAt,
        latestToolBySession.get(session.id),
        latestStepFinishBySession.get(session.id)
      );
      const model = this.getSessionModel(messagesBySession.get(session.id) || []);

      nextSessions[session.id] = {
        id: session.id,
        tool: 'opencode',
        cwd: session.directory,
        projectName: this.getProjectName(session, project),
        status,
        startedAt: session.timeCreated,
        completedAt: status === 'completed' ? session.timeUpdated : undefined,
        model,
        lastActivityAt
      };

      nextAgents[session.id] = {
        id: session.id,
        sessionId: session.id,
        parentAgentId: null,
        agentType: this.getMainAgentType(messagesBySession.get(session.id) || []),
        status: this.getAgentStatus(status),
        startedAt: session.timeCreated,
        completedAt: status === 'completed' ? session.timeUpdated : undefined,
        lastMessage: latestAssistantTextBySession.get(session.id),
        currentTask: this.formatCurrentTask(latestRunningToolBySession.get(session.id))
      };
    }

    for (const session of snapshot.sessions) {
      if (!session.parentId || !sessionsById.has(session.parentId)) {
        continue;
      }

      const rootSessionId = getRootSessionId(session.id);
      const lastActivityAt = this.getLastActivityAt(session, partsBySession, messagesBySession);
      const status = this.getSessionStatus(
        session,
        lastActivityAt,
        latestToolBySession.get(session.id),
        latestStepFinishBySession.get(session.id)
      );
      const matchedTask = taskMatches.byChildSessionId.get(session.id);

      nextAgents[session.id] = {
        id: session.id,
        sessionId: rootSessionId,
        parentAgentId: session.parentId,
        agentType: this.getSubagentType(session, matchedTask),
        status: this.getAgentStatus(status),
        startedAt: session.timeCreated,
        completedAt: status === 'completed' ? session.timeUpdated : undefined,
        lastMessage: latestAssistantTextBySession.get(session.id),
        currentTask: this.formatCurrentTask(latestRunningToolBySession.get(session.id))
      };
    }

    for (const match of taskMatches.matches) {
      const rootSessionId = getRootSessionId(match.taskPart.sessionId);
      const toolState = match.taskPart.dataObject.state || {};
      const completed = toolState.status === 'completed' || toolState.status === 'error';
      const result = this.getDelegationResult(
        toolState,
        match.childSessionId ? latestAssistantTextBySession.get(match.childSessionId) : undefined
      );

      nextDelegations[match.taskPart.id] = {
        id: match.taskPart.id,
        sessionId: rootSessionId,
        fromAgentId: match.taskPart.sessionId,
        toAgentId: match.childSessionId || 'pending',
        prompt: this.getDelegationPrompt(match.taskPart),
        result,
        status: toolState.status === 'running' ? 'pending' : 'completed',
        createdAt: match.taskPart.timeCreated,
        completedAt: completed ? this.getCompletionTime(match.taskPart) : undefined
      };
    }

    for (const part of parsedParts) {
      const rootSessionId = getRootSessionId(part.sessionId);

      if (part.dataObject?.type === 'tool') {
        const toolPart = part as ParsedToolPart;
        const operation = this.getFileOperation(toolPart);
        const filePath = this.getToolFilePath(toolPart);

        if (operation && filePath) {
          nextFileEvents.push({
            sessionId: rootSessionId,
            agentId: part.sessionId,
            filePath,
            operation,
            createdAt: part.timeCreated
          });
        }
      }

      if (part.dataObject?.type === 'file') {
        const filePath = this.getFileAttachmentPath(part.dataObject);
        if (filePath) {
          nextFileEvents.push({
            sessionId: rootSessionId,
            agentId: part.sessionId,
            filePath,
            operation: 'read',
            createdAt: part.timeCreated
          });
        }
      }
    }

    nextFileEvents.sort((left, right) => left.createdAt - right.createdAt);

    return {
      sessions: nextSessions,
      agents: nextAgents,
      delegations: nextDelegations,
      fileEvents: nextFileEvents
    };
  }

  private static groupBySession<T extends { sessionId: string }>(rows: T[]): Map<string, T[]> {
    const grouped = new Map<string, T[]>();

    for (const row of rows) {
      const existing = grouped.get(row.sessionId) || [];
      existing.push(row);
      grouped.set(row.sessionId, existing);
    }

    return grouped;
  }

  private static safeParseJson(value: string): any {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }

  private static buildLatestAssistantText(partsBySession: Map<string, ParsedPart[]>): Map<string, string> {
    const latestTextBySession = new Map<string, string>();

    for (const [sessionId, parts] of partsBySession.entries()) {
      for (let index = parts.length - 1; index >= 0; index -= 1) {
        const part = parts[index];
        if (part.dataObject?.type === 'text' && typeof part.dataObject.text === 'string') {
          latestTextBySession.set(sessionId, part.dataObject.text);
          break;
        }
      }
    }

    return latestTextBySession;
  }

  private static buildLatestToolParts(partsBySession: Map<string, ParsedPart[]>): Map<string, ParsedToolPart> {
    const latestBySession = new Map<string, ParsedToolPart>();

    for (const [sessionId, parts] of partsBySession.entries()) {
      for (let index = parts.length - 1; index >= 0; index -= 1) {
        const part = parts[index];
        if (part.dataObject?.type === 'tool') {
          latestBySession.set(sessionId, part as ParsedToolPart);
          break;
        }
      }
    }

    return latestBySession;
  }

  private static buildLatestRunningToolParts(partsBySession: Map<string, ParsedPart[]>): Map<string, ParsedToolPart> {
    const latestBySession = new Map<string, ParsedToolPart>();

    for (const [sessionId, parts] of partsBySession.entries()) {
      for (let index = parts.length - 1; index >= 0; index -= 1) {
        const part = parts[index];
        if (part.dataObject?.type === 'tool' && part.dataObject.state?.status === 'running') {
          latestBySession.set(sessionId, part as ParsedToolPart);
          break;
        }
      }
    }

    return latestBySession;
  }

  private static buildLatestStepFinishParts(partsBySession: Map<string, ParsedPart[]>): Map<string, ParsedPart> {
    const latestBySession = new Map<string, ParsedPart>();

    for (const [sessionId, parts] of partsBySession.entries()) {
      for (let index = parts.length - 1; index >= 0; index -= 1) {
        const part = parts[index];
        if (part.dataObject?.type === 'step-finish') {
          latestBySession.set(sessionId, part);
          break;
        }
      }
    }

    return latestBySession;
  }

  private static matchTaskDelegations(
    parsedParts: ParsedPart[],
    sessionsById: Map<string, OpenCodeSessionRow>
  ): {
    matches: TaskMatch[];
    byChildSessionId: Map<string, ParsedToolPart>;
  } {
    const tasks = parsedParts
      .filter(part => part.dataObject?.type === 'tool' && part.dataObject.tool === 'task')
      .map(part => part as ParsedToolPart)
      .sort((left, right) => left.timeCreated - right.timeCreated);

    const childrenByParent = new Map<string, OpenCodeSessionRow[]>();
    for (const session of sessionsById.values()) {
      if (!session.parentId || !sessionsById.has(session.parentId)) {
        continue;
      }

      const children = childrenByParent.get(session.parentId) || [];
      children.push(session);
      childrenByParent.set(session.parentId, children);
    }

    for (const children of childrenByParent.values()) {
      children.sort((left, right) => left.timeCreated - right.timeCreated);
    }

    const usedChildIds = new Set<string>();
    const byChildSessionId = new Map<string, ParsedToolPart>();
    const matches: TaskMatch[] = [];

    for (const task of tasks) {
      const children = childrenByParent.get(task.sessionId) || [];
      const child = children.find(candidate =>
        !usedChildIds.has(candidate.id) && candidate.timeCreated >= task.timeCreated
      );

      if (child) {
        usedChildIds.add(child.id);
        byChildSessionId.set(child.id, task);
      }

      matches.push({
        taskPart: task,
        childSessionId: child?.id
      });
    }

    return {
      matches,
      byChildSessionId
    };
  }

  private static getSessionStatus(
    session: OpenCodeSessionRow,
    lastActivityAt: number,
    latestToolPart: ParsedToolPart | undefined,
    latestStepFinish: ParsedPart | undefined
  ): SessionStatus {
    if (session.timeArchived) {
      return 'completed';
    }

    if (latestStepFinish?.dataObject?.reason === 'stop') {
      return 'completed';
    }

    const isFresh = lastActivityAt > 0 && Date.now() - lastActivityAt <= this.STALE_ACTIVE_MS;
    if (isFresh) {
      return 'active';
    }

    return 'idle';
  }

  private static getAgentStatus(status: SessionStatus): Agent['status'] {
    if (status === 'active') {
      return 'active';
    }

    return 'completed';
  }

  private static getProjectName(session: OpenCodeSessionRow, project: OpenCodeProjectRow | undefined): string {
    if (session.title?.trim()) {
      return session.title.trim();
    }

    if (project?.name?.trim()) {
      return project.name.trim();
    }

    if (project?.worktree && project.worktree !== '/') {
      return path.basename(project.worktree);
    }

    return path.basename(session.directory) || session.directory;
  }

  private static getSessionModel(messages: ParsedMessage[]): string | undefined {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index].dataObject;
      const provider = message?.model?.providerID || message?.providerID;
      const model = message?.model?.modelID || message?.modelID;

      if (provider && model) {
        return `${provider}/${model}`;
      }

      if (model) {
        return model;
      }
    }

    return undefined;
  }

  private static getMainAgentType(messages: ParsedMessage[]): string {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const agent = messages[index].dataObject?.agent;
      if (typeof agent === 'string' && agent.trim()) {
        return agent.trim();
      }
    }

    return 'main-agent';
  }

  private static getSubagentType(session: OpenCodeSessionRow, matchedTask: ParsedToolPart | undefined): string {
    if (session.title?.trim()) {
      return session.title.trim();
    }

    const subagentType = matchedTask?.dataObject?.state?.input?.subagent_type;
    if (typeof subagentType === 'string' && subagentType.trim()) {
      return subagentType.trim();
    }

    return 'Subagent';
  }

  private static getLastActivityAt(
    session: OpenCodeSessionRow,
    partsBySession: Map<string, ParsedPart[]>,
    messagesBySession: Map<string, ParsedMessage[]>
  ): number {
    const lastPart = partsBySession.get(session.id)?.at(-1);
    const lastMessage = messagesBySession.get(session.id)?.at(-1);
    const latestPart = lastPart ? Math.max(lastPart.timeCreated, lastPart.timeUpdated || 0) : 0;
    const latestMessage = lastMessage ? Math.max(lastMessage.timeCreated, lastMessage.timeUpdated || 0) : 0;
    const latestSession = Math.max(session.timeCreated || 0, session.timeUpdated || 0);
    return Math.max(latestPart, latestMessage, latestSession);
  }

  private static formatCurrentTask(toolPart: ParsedToolPart | undefined): string | undefined {
    if (!toolPart) {
      return undefined;
    }

    const toolName = toolPart.dataObject.tool || 'tool';
    const state = toolPart.dataObject.state || {};
    const input = state.input || {};
    const description =
      state.title ||
      input.description ||
      input.filePath ||
      input.path ||
      state.metadata?.filepath ||
      input.command;

    if (typeof description === 'string' && description.trim()) {
      return `${toolName}: ${description.trim()}`;
    }

    return `${toolName}: running`;
  }

  private static getDelegationPrompt(toolPart: ParsedToolPart): string {
    const input = toolPart.dataObject.state?.input || {};
    const candidates = [input.description, input.prompt, toolPart.dataObject.state?.title];

    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate.trim()) {
        return candidate.trim();
      }
    }

    return 'No description';
  }

  private static getDelegationResult(toolState: ToolPartState, fallbackText: string | undefined): string | undefined {
    if (typeof toolState.output === 'string' && toolState.output.trim()) {
      return toolState.output;
    }

    if (toolState.output && typeof toolState.output !== 'string') {
      return JSON.stringify(toolState.output);
    }

    if (typeof toolState.error === 'string' && toolState.error.trim()) {
      return toolState.error;
    }

    return fallbackText;
  }

  private static getCompletionTime(toolPart: ParsedToolPart): number {
    const endTime = toolPart.dataObject.state?.time?.end;
    if (typeof endTime === 'number') {
      return endTime;
    }

    return toolPart.timeUpdated || toolPart.timeCreated;
  }

  private static getFileOperation(toolPart: ParsedToolPart): FileOperation | undefined {
    const toolName = toolPart.dataObject.tool?.toLowerCase();

    if (!toolName) {
      return undefined;
    }

    if (['read', 'grep', 'glob', 'webfetch', 'websearch'].includes(toolName)) {
      return 'read';
    }

    if (['edit', 'apply_patch'].includes(toolName)) {
      return 'edit';
    }

    if (toolName === 'write') {
      return 'write';
    }

    if (toolName === 'bash') {
      const filePath = this.getToolFilePath(toolPart);
      return filePath ? 'read' : undefined;
    }

    return undefined;
  }

  private static getToolFilePath(toolPart: ParsedToolPart): string | undefined {
    const state = toolPart.dataObject.state || {};
    const input = state.input || {};
    const metadata = state.metadata || {};

    const candidates = [
      input.filePath,
      input.path,
      metadata.filepath
    ];

    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate.trim()) {
        return candidate;
      }
    }

    return undefined;
  }

  private static getFileAttachmentPath(dataObject: any): string | undefined {
    if (typeof dataObject?.url !== 'string' || !dataObject.url.startsWith('file:///')) {
      return undefined;
    }

    try {
      const url = new URL(dataObject.url);
      return decodeURIComponent(url.pathname.replace(/^\/+/, ''));
    } catch {
      return undefined;
    }
  }
}
