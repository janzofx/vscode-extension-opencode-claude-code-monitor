// ============================================================================
// Shared Types - Used by both extension host and webview
// ============================================================================

export type Tool = 'claude-code' | 'opencode' | 'codex';

export type SessionStatus = 'active' | 'idle' | 'completed';
export type AgentStatus = 'active' | 'completed' | 'failed';
export type DelegationStatus = 'pending' | 'completed';
export type FileOperation = 'read' | 'write' | 'edit';

export interface Session {
  id: string;
  tool: Tool;
  cwd: string;
  projectName: string;
  status: SessionStatus;
  startedAt: number;
  completedAt?: number;
  model?: string;
  source?: string; // SessionStart source field
  lastActivityAt?: number; // Track for idle detection
}

export interface Agent {
  id: string;
  sessionId: string;
  parentAgentId: string | null; // null = main agent
  agentType: string; // from SubagentStart: "Bash", "Explore", "Plan", or custom
  status: AgentStatus;
  startedAt: number;
  completedAt?: number;
  lastMessage?: string; // from SubagentStop last_assistant_message
  currentTask?: string; // from CURRENT_TASK event
}

export interface DelegationEvent {
  id: string;
  sessionId: string;
  fromAgentId: string;
  toAgentId: string;
  prompt: string;
  result?: string;
  status: DelegationStatus;
  createdAt: number;
  completedAt?: number;
}

export interface FileEvent {
  sessionId: string;
  agentId: string;
  filePath: string;
  operation: FileOperation;
  createdAt: number;
}

export interface PersistedState {
  sessions: Record<string, Session>;
  agents: Record<string, Agent>;
  delegations: Record<string, DelegationEvent>;
  fileEvents: FileEvent[];
}

export interface ToolStateSnapshot {
  sessions: Record<string, Session>;
  agents: Record<string, Agent>;
  delegations: Record<string, DelegationEvent>;
  fileEvents: FileEvent[];
}

export type OpenCodeStateSnapshot = ToolStateSnapshot;
export type CodexStateSnapshot = ToolStateSnapshot;

export interface DashboardState {
  sessions: Record<string, Session>;
  agents: Record<string, Agent>;
  delegations: Record<string, DelegationEvent>;
  fileEvents: FileEvent[];
  selectedSessionId: string | null;
  connectionStatus: 'connected' | 'disconnected';
  isMuted: boolean; // Audio notification mute state
}

// ============================================================================
// Extension → Webview Messages
// ============================================================================

export type ExtensionMessage =
  | { type: 'SESSION_CREATED'; payload: Session }
  | { type: 'SESSION_UPDATED'; payload: Partial<Session> & { id: string } }
  | { type: 'SESSION_COMPLETED'; payload: { id: string } }
  | { type: 'SUBAGENT_CREATED'; payload: Agent }
  | { type: 'SUBAGENT_COMPLETED'; payload: { id: string; parentId: string } }
  | { type: 'DELEGATION_STARTED'; payload: DelegationEvent }
  | { type: 'DELEGATION_COMPLETED'; payload: DelegationEvent }
  | { type: 'FILE_ACTIVITY'; payload: FileEvent }
  | { type: 'CURRENT_TASK'; payload: { sessionId: string; agentId: string; task: string } }
  | { type: 'NOTIFICATION'; payload: { sessionId: string; message: string } }
  | { type: 'INITIAL_STATE'; payload: DashboardState };

// ============================================================================
// Webview → Extension Messages
// ============================================================================

export type WebviewMessage =
  | { type: 'SELECT_SESSION'; sessionId: string }
  | { type: 'READY' }
  | { type: 'TOGGLE_MUTE' };

// ============================================================================
// Claude Code Hook Payload Types
// ============================================================================

export type HookEventName =
  | 'SessionStart'
  | 'SubagentStart'
  | 'SessionEnd'
  | 'Notification'
  | 'PreToolUse'
  | 'PostToolUse'
  | 'SubagentStop'
  | 'Stop';

export interface BaseHookPayload {
  hook_event_name: HookEventName;
  session_id: string;
  cwd: string;
  transcript_path: string;
}

export interface SessionStartPayload extends BaseHookPayload {
  hook_event_name: 'SessionStart';
  source: 'startup' | 'resume' | 'clear' | 'compact';
  model: string;
}

export interface SubagentStartPayload extends BaseHookPayload {
  hook_event_name: 'SubagentStart';
  agent_id: string;
  agent_type: string;
}

export interface SessionEndPayload extends BaseHookPayload {
  hook_event_name: 'SessionEnd';
  reason: 'exit' | 'sigint' | 'error';
}

export interface NotificationPayload extends BaseHookPayload {
  hook_event_name: 'Notification';
  message: string;
}

export interface ToolUsePayload extends BaseHookPayload {
  hook_event_name: 'PreToolUse' | 'PostToolUse';
  tool_name: string;
  tool_input: any;
  tool_response?: any; // PostToolUse only
}

export interface SubagentStopPayload extends BaseHookPayload {
  hook_event_name: 'SubagentStop';
  agent_id: string;
  agent_type: string;
  agent_transcript_path: string;
  last_assistant_message: string;
}

export interface StopPayload extends BaseHookPayload {
  hook_event_name: 'Stop';
}

export type HookPayload =
  | SessionStartPayload
  | SubagentStartPayload
  | SessionEndPayload
  | NotificationPayload
  | ToolUsePayload
  | SubagentStopPayload
  | StopPayload;

// ============================================================================
// JSONL Transcript Entry Types
// ============================================================================

export interface JsonlEntry {
  type: string;
  timestamp?: number;
  // Additional fields vary by type
}

export interface ToolCallEntry extends JsonlEntry {
  type: 'tool_use';
  id: string;
  name: string;
  input: any;
}

export interface ToolResultEntry extends JsonlEntry {
  type: 'tool_result';
  tool_use_id: string;
  output?: string;
  error?: string;
}
