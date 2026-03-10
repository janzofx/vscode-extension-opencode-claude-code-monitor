# AI Agent Observatory — Build Specification

## Project Overview

Build a **read-only, real-time monitoring dashboard** for AI coding tools — specifically **Claude Code** and **OpenCode** — as a **VSCode Extension**. The dashboard lives as a panel inside VSCode, always visible while you work. It is purely observational: it displays what agents are doing, never sends commands back to them.

The user runs both Claude Code and OpenCode as VSCode extensions. The dashboard auto-detects all running and past sessions with zero manual setup per project.

---

## Goals

- See all active Claude Code and OpenCode sessions at a glance
- Visualize the agent → subagent delegation tree live as it builds
- See what each agent is working on right now (current tool call)
- See which files each agent is reading/writing
- See delegation messages: what the main agent asked a subagent, and what it got back
- Track to-do / progress: tasks delegated, completed, in-progress
- Audio notifications when a subagent completes or the main agent needs attention

---

## Platform & Architecture

This is a **VSCode Extension** with a **Webview Panel** UI.

| Layer | Choice | Reason |
|---|---|---|
| Extension host | VSCode Extension API (TypeScript) | Runs inside VSCode, no separate process needed |
| File watching | VSCode `FileSystemWatcher` API | Built-in, no external library, reliable on Windows |
| Claude Code events | Small Express HTTP server on `localhost:3001` | Claude Code hooks POST to it; runs inside the extension host |
| UI | React + Tailwind CSS inside a Webview panel | Full rich UI living inside VSCode |
| Agent graph | React Flow (`@xyflow/react`) | Purpose-built for live node/edge graphs |
| Extension → Webview | `webview.postMessage()` | Native VSCode API, no WebSocket needed |
| Webview → Extension | `vscode.postMessage()` | Native VSCode API |
| Session storage | JSON files via Node.js `fs` module | Zero native dependencies, works perfectly in VSCode extensions, sufficient for this use case |

### How it works

```
Claude Code hooks  →  POST localhost:3001/events
                              ↓
                    Extension Host (TypeScript)
                    - Express HTTP listener
                    - VSCode FileSystemWatcher
                    - JSON state store (fs)
                              ↓
                    webview.postMessage(event)
                              ↓
                    Webview Panel (React)
                    - Agent Tree (React Flow)
                    - Delegation Feed
                    - File Workspace
                    - Task Progress
                    - Session List
```

---

## Repository Structure

```
agent-observatory/
├── package.json                   # Extension manifest (name, activationEvents, contributes)
├── tsconfig.json
├── webpack.config.js              # Bundles extension host + webview separately
├── src/
│   ├── extension.ts               # Entry point — activate(), registers panel command
│   ├── panel.ts                   # Creates and manages the Webview panel
│   ├── server.ts                  # Tiny Express server for Claude Code hooks on :3001
│   ├── store.ts                   # JSON file persistence — saves/loads full state to disk
│   ├── state.ts                   # In-memory state + broadcast to webview
│   ├── watchers/
│   │   ├── claudeCode.ts          # VSCode FileSystemWatcher on ~/.claude/projects/
│   │   └── opencode.ts            # VSCode FileSystemWatcher on OpenCode storage
│   ├── parsers/
│   │   ├── claudeCode.ts          # Parses JSONL files and hook payloads
│   │   └── opencode.ts            # Parses OpenCode session/message JSON files
│   └── types.ts                   # Shared TypeScript types
└── webview/
    ├── index.tsx                  # React entry point
    ├── App.tsx
    ├── store/
    │   └── dashboardStore.ts      # Zustand store
    ├── components/
    │   ├── SessionList.tsx
    │   ├── AgentTree.tsx          # React Flow graph
    │   ├── DelegationFeed.tsx
    │   ├── FileWorkspace.tsx
    │   └── TaskProgress.tsx
    └── types.ts
```

---

## Data Sources

### Claude Code

**Storage path (Windows):**
```
%USERPROFILE%\.claude\projects\<encoded-cwd>\<session-id>.jsonl
```
Path encoding: every non-alphanumeric character in the working directory path is replaced with `-`. Example: `C:\Algo Trading\AI Hedge fund` → `C--Algo-Trading-AI-Hedge-fund`.

Also check `%USERPROFILE%\.claude\projects\<encoded-cwd>\sessions-index.json` for pre-computed session metadata (summaries, message counts, git branch, timestamps).

**Hook system (real-time):**

> ⚠️ **Critical:** Not all hook events support HTTP hooks. `SessionStart`, `SubagentStart`, `SessionEnd`, and `Notification` are **command-only** events — they must use shell command hooks that POST to the server. The remaining events support HTTP hooks directly.

> ⚠️ **Known Claude Code bug:** `SessionStart` hooks fire and execute correctly for `/clear`, `/compact`, and resume operations, but for **brand new sessions** the hook fires but context injection is silently discarded. Since we only need the hook to POST to our endpoint (not inject context), this bug does NOT affect the dashboard — the POST will still be sent. Verify this works on first test run.

Configure once in `%USERPROFILE%\.claude\settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Task|Read|Write|Edit|Bash",
        "hooks": [{ "type": "http", "url": "http://localhost:3001/events" }]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Task",
        "hooks": [{ "type": "http", "url": "http://localhost:3001/events" }]
      }
    ],
    "SubagentStop": [{ "hooks": [{ "type": "http", "url": "http://localhost:3001/events" }] }],
    "Stop":         [{ "hooks": [{ "type": "http", "url": "http://localhost:3001/events" }] }],

    "SessionStart": [{
      "hooks": [{
        "type": "command",
        "command": "curl -s -X POST http://localhost:3001/events -H \"Content-Type: application/json\" -d @-",
        "windows": "powershell -Command \"$rawInput = [Console]::In.ReadToEnd(); Invoke-RestMethod -Uri 'http://localhost:3001/events' -Method POST -ContentType 'application/json' -Body $rawInput\""
      }]
    }],
    "SubagentStart": [{
      "hooks": [{
        "type": "command",
        "command": "curl -s -X POST http://localhost:3001/events -H \"Content-Type: application/json\" -d @-",
        "windows": "powershell -Command \"$rawInput = [Console]::In.ReadToEnd(); Invoke-RestMethod -Uri 'http://localhost:3001/events' -Method POST -ContentType 'application/json' -Body $rawInput\""
      }]
    }],
    "SessionEnd": [{
      "hooks": [{
        "type": "command",
        "command": "curl -s -X POST http://localhost:3001/events -H \"Content-Type: application/json\" -d @-",
        "windows": "powershell -Command \"$rawInput = [Console]::In.ReadToEnd(); Invoke-RestMethod -Uri 'http://localhost:3001/events' -Method POST -ContentType 'application/json' -Body $rawInput\""
      }]
    }],
    "Notification": [{
      "hooks": [{
        "type": "command",
        "command": "curl -s -X POST http://localhost:3001/events -H \"Content-Type: application/json\" -d @-",
        "windows": "powershell -Command \"$rawInput = [Console]::In.ReadToEnd(); Invoke-RestMethod -Uri 'http://localhost:3001/events' -Method POST -ContentType 'application/json' -Body $rawInput\""
      }]
    }]
  }
}
```

> The `matcher` on `PreToolUse`/`PostToolUse` is a pipe-separated regex filter. It prevents hook calls for every Claude Code internal tool — only delegation and file-relevant tools are forwarded.
>
> **Critical — how command hooks receive data:** Claude Code sends the JSON hook payload via **stdin** to command hooks, not via environment variables. The bash command uses `curl -d @-` which reads from stdin. The PowerShell command reads stdin via `[Console]::In.ReadToEnd()`. Do NOT use `$CLAUDE_HOOK_INPUT` or any other env var — those are empty.
>
> The `windows` key lets Claude Code automatically use PowerShell on Windows and bash (with curl) on Mac/Linux.

**Key hook payload fields (common to all events):**
- `hook_event_name` — e.g. `SessionStart`, `PreToolUse`, `SubagentStart`
- `session_id` — unique session identifier
- `cwd` — working directory of the session
- `transcript_path` — path to the full JSONL transcript

**`SessionStart` additional fields:**
- `source` — how the session started: `"startup"` (new session), `"resume"` (resumed), `"clear"` (after /clear), or `"compact"` (after /compact)
- `model` — the model being used (e.g. `claude-opus-4-5`)

**`PreToolUse` / `PostToolUse` additional fields:**
- `tool_name` — e.g. `Task`, `Read`, `Write`, `Edit`, `Bash`
- `tool_input` — full input object (includes `description` field = delegation prompt for `Task` tool)
- `tool_response` — result of the tool call (`PostToolUse` only)

**`SubagentStart` additional fields:**
- `agent_id` — unique identifier for the subagent
- `agent_type` — subagent type name: `"Bash"`, `"Explore"`, `"Plan"`, or custom agent name — use this to label nodes in the agent tree

**`SubagentStop` additional fields:**
- `agent_id` — matches the `agent_id` from `SubagentStart`
- `agent_type` — same as SubagentStart
- `agent_transcript_path` — path to the subagent's own transcript (stored in a `subagents/` subfolder)
- `last_assistant_message` — the subagent's final response text **directly in the payload** — use this for the DelegationFeed result without parsing any transcript files

**`SessionEnd` additional fields:**
- `reason` — why the session ended: `"exit"`, `"sigint"`, or `"error"`

**Subagent note:** Claude Code subagents cannot spawn further subagents — delegation is always max 2 levels deep: main agent → subagents. However, the main agent **can spawn multiple subagents in parallel**. The agent tree and delegation feed must handle multiple subagents active simultaneously — shown as sibling nodes on the same level, each with their own live status.

---

### OpenCode

**Storage path (Windows):**
```
%USERPROFILE%\.local\share\opencode\
```

**Internal directory structure:**
```
%USERPROFILE%\.local\share\opencode\
├── auth.json                          # API keys / OAuth tokens — DO NOT READ
├── log/                               # Log files — ignore
└── project/
    ├── <project-slug>/                # One directory per Git repo (slug = repo name)
    │   └── storage/
    │       ├── <sessionId>.json       # Session file
    │       └── <sessionId>/
    │           └── msg_<id>.json      # Message files
    └── global/                        # For projects NOT inside a Git repo
        └── storage/
            ├── <sessionId>.json
            └── <sessionId>/
                └── msg_<id>.json
```

> ⚠️ **First-run verification:** Confirm that OpenCode running as a VSCode extension writes to this same path. Since it is the same underlying process, it should — but verify on first test run.

**Session file fields:**
- `id` — session ID
- `parentId` — if present, this session is a subagent of the referenced parent session
- `title` — auto-generated session title
- `createdAt`, `updatedAt` — timestamps

**Message file fields:**
- `sessionId`
- `role` — `user` or `assistant`
- `parts` — array of content parts; tool calls have `type: "tool-invocation"` containing `toolName`, `input`, `output`

**Detecting delegation in OpenCode:**
When a message contains a tool call with `toolName: "task"`, that is a delegation event. The `input.description` is the delegation prompt. The `output` (once available) is what the subagent returned. When a new session file appears with a `parentId` field, that is a subagent — link it to its parent in the agent tree.

**No hooks in OpenCode** — use `VSCode FileSystemWatcher` exclusively.

---

## Extension Host — Detailed Spec

### `extension.ts` — Activation

```typescript
export function activate(context: vscode.ExtensionContext) {
  // 1. Load persisted state from JSON file (context.globalStorageUri)
  // 2. Start Express server on :3001 for Claude Code hooks
  // 3. Start FileSystemWatchers for Claude Code + OpenCode paths
  // 4. Scan existing files on startup to hydrate state
  // 5. Register command: "agent-observatory.openPanel"
  // 6. Auto-open panel on activation
}
```

The extension activates on VSCode startup (`"activationEvents": ["onStartupFinished"]` in `package.json`). The panel command can also be triggered manually from the command palette.

---

### `state.ts` — In-Memory State Manager

Holds the full `PersistedState` object in memory and is the single source of truth at runtime. Responsible for:
- Applying incremental updates from hook events and file watchers
- Broadcasting relevant `ExtensionMessage` events to the webview panel via `panel.webview.postMessage()`
- Triggering a debounced `saveState()` call after each mutation
- Providing the full `DashboardState` snapshot for `INITIAL_STATE` on webview connect

```typescript
class StateManager {
  private state: PersistedState;
  private panel: vscode.WebviewPanel | undefined;

  setPanel(panel: vscode.WebviewPanel): void
  broadcast(message: ExtensionMessage): void  // sends to panel if open
  getSnapshot(): DashboardState              // for INITIAL_STATE
  applyEvent(event: HookPayload): void       // called by server.ts and watchers
}
```

---

Listens on `localhost:3001`. Receives Claude Code hook POST payloads. Routes by `hook_event_name`:

| Event | Hook type | Action |
|---|---|---|
| `SessionStart` | command → POST | Create session in state store, broadcast `SESSION_CREATED` |
| `PreToolUse` (tool: `Task`) | HTTP | Record delegation start, broadcast `DELEGATION_STARTED` |
| `PostToolUse` (tool: `Task`) | HTTP | Record delegation result, broadcast `DELEGATION_COMPLETED` |
| `PreToolUse` (tool: `Read`/`Write`/`Edit`/`Bash`) | HTTP | Record file activity, broadcast `FILE_ACTIVITY` |
| `SubagentStart` | command → POST | Create subagent node with `agent_type` label, link to parent, broadcast `SUBAGENT_CREATED` |
| `SubagentStop` | HTTP | Mark subagent complete, capture `last_assistant_message` as delegation result, broadcast `SUBAGENT_COMPLETED` |
| `Stop` | HTTP | Mark session idle/complete, broadcast `SESSION_UPDATED` |
| `SessionEnd` | command → POST | Mark session definitively completed with `reason`, broadcast `SESSION_COMPLETED` |
| `Notification` | command → POST | Claude needs user attention — broadcast `NOTIFICATION` to trigger audio alert in webview |

If the HTTP server fails to bind to port 3001, show a VSCode warning notification: *"Agent Observatory: port 3001 is in use. Claude Code hooks will not be received."*

---

### File Watchers (`watchers/`)

**Claude Code watcher:**
```typescript
// IMPORTANT: Must use vscode.Uri.file() with RelativePattern to watch paths
// outside the opened workspace. A plain string glob pattern only watches
// inside the workspace and will silently miss all events from ~/.claude/
const claudeProjectsUri = vscode.Uri.file(
  path.join(process.env.USERPROFILE!, '.claude', 'projects')
);
// Watcher 1: new/changed JSONL session files
const jsonlWatcher = vscode.workspace.createFileSystemWatcher(
  new vscode.RelativePattern(claudeProjectsUri, '**/*.jsonl')
);
jsonlWatcher.onDidCreate(uri => handleNewSession(uri));
jsonlWatcher.onDidChange(uri => handleSessionUpdate(uri));
context.subscriptions.push(jsonlWatcher);

// Watcher 2: sessions-index.json for metadata (summary, git branch, message count)
const indexWatcher = vscode.workspace.createFileSystemWatcher(
  new vscode.RelativePattern(claudeProjectsUri, '**/sessions-index.json')
);
indexWatcher.onDidChange(uri => handleSessionsIndexUpdate(uri));
context.subscriptions.push(indexWatcher);
```
1. On startup: scan all existing `.jsonl` files — parse each to hydrate historical sessions
2. On startup: read any existing `sessions-index.json` files for pre-computed metadata

**OpenCode watcher:**
```typescript
// Same pattern — must use vscode.Uri.file() for paths outside the workspace
const opencodeProjectsUri = vscode.Uri.file(
  path.join(process.env.USERPROFILE!, '.local', 'share', 'opencode', 'project')
);
const watcher = vscode.workspace.createFileSystemWatcher(
  new vscode.RelativePattern(opencodeProjectsUri, '**/storage/**/*.json')
);
watcher.onDidCreate(uri => handleNewOpenCodeFile(uri));
watcher.onDidChange(uri => handleOpenCodeFileChange(uri));
context.subscriptions.push(watcher);
```
1. On startup: scan all existing session JSON files under `project/*/storage/`
2. New session file with no `parentId` = new main session
3. New session file with `parentId` = new subagent — link to parent
4. New/changed message files = parse for tool calls, delegation events, file activity

---

### Path Decoder

> ⚠️ **The directory name encoding is lossy.** All non-alphanumeric characters (`:`, `\`, ` `, `-`) all map to `-`, so you cannot perfectly reconstruct the original cwd from the directory name alone. Follow this priority:

- **Primary (authoritative):** Use the `cwd` field from the hook payload — it contains the exact original path. Store this on `SessionStart` and use it everywhere.
- **Fallback (file watcher only):** When a `.jsonl` file is discovered by the file watcher before any hook fires (e.g. on startup scanning old sessions), decode the directory name as a best-effort display name only.

```typescript
function getProjectName(cwd: string): string {
  // Returns last path segment of the full cwd: "AI Hedge fund"
  // Use path.basename(cwd) — works on both Windows and Unix paths
}

function bestEffortProjectNameFromDirName(encoded: string): string {
  // Only used as fallback when cwd is not available from hook payload
  // Replace leading "C--" with "C:\" for Windows drive letter
  // Replace remaining "-" with spaces for display only
  // Never use this for file system operations — display label only
}
```

---

### Extension → Webview Messages

All messages are JSON with a `type` field. Sent via `panel.webview.postMessage(event)`:

```typescript
type ExtensionMessage =
  | { type: 'SESSION_CREATED';      payload: Session }
  | { type: 'SESSION_UPDATED';      payload: Partial<Session> & { id: string } }
  | { type: 'SESSION_COMPLETED';    payload: { id: string } }
  | { type: 'SUBAGENT_CREATED';     payload: Agent }
  | { type: 'SUBAGENT_COMPLETED';   payload: { id: string; parentId: string } }
  | { type: 'DELEGATION_STARTED';   payload: DelegationEvent }
  | { type: 'DELEGATION_COMPLETED'; payload: DelegationEvent }
  | { type: 'FILE_ACTIVITY';        payload: FileEvent }
  | { type: 'CURRENT_TASK';         payload: { sessionId: string; agentId: string; task: string } }
  // ^ sent on every PreToolUse — task = tool_name + brief description of tool_input, e.g. "Read src/auth.ts"
  // used to show "what is this agent doing right now" on each AgentTree node
  | { type: 'NOTIFICATION';         payload: { sessionId: string; message: string } }  // triggers audio alert
  | { type: 'INITIAL_STATE';        payload: DashboardState }  // sent when panel opens
```

### Webview → Extension Messages

Sent via `vscode.postMessage()` from the webview:

```typescript
type WebviewMessage =
  | { type: 'SELECT_SESSION'; sessionId: string }
  | { type: 'READY' }  // webview loaded — extension responds with INITIAL_STATE
```

---

### JSON Persistence (`store.ts`)

> ⚠️ **Why not SQLite:** `better-sqlite3` and all SQLite native modules fail in VSCode extensions with "compiled against a different Node.js version" errors because VSCode runs on Electron's internal Node.js, not the system Node.js. Avoid all native modules. Use pure JS only.

The full dashboard state is stored as a single JSON file at `context.globalStorageUri.fsPath + '/state.json'`. State is written to disk on every meaningful update (debounced 500ms to avoid excessive writes) and loaded on extension activation.

**State shape:**

```typescript
interface PersistedState {
  sessions: Record<string, Session>;
  agents: Record<string, Agent>;
  delegations: Record<string, DelegationEvent>;
  fileEvents: FileEvent[];  // Keep last 1000 entries max — trim on write
}

interface Session {
  id: string;
  tool: 'claude-code' | 'opencode';
  cwd: string;
  projectName: string;
  status: 'active' | 'idle' | 'completed';
  startedAt: number;
  completedAt?: number;
  model?: string;
  source?: string;  // SessionStart source field
}

interface Agent {
  id: string;
  sessionId: string;
  parentAgentId: string | null;  // null = main agent
  agentType: string;             // from SubagentStart: "Bash", "Explore", "Plan", or custom
  status: 'active' | 'completed' | 'failed';
  startedAt: number;
  completedAt?: number;
  lastMessage?: string;          // from SubagentStop last_assistant_message
}

interface DelegationEvent {
  id: string;
  sessionId: string;
  fromAgentId: string;
  toAgentId: string;
  prompt: string;
  result?: string;
  status: 'pending' | 'completed';
  createdAt: number;
  completedAt?: number;
}

interface FileEvent {
  sessionId: string;
  agentId: string;
  filePath: string;
  operation: 'read' | 'write' | 'edit';
  createdAt: number;
}
```

**Persistence operations:**
```typescript
// Load on startup
async function loadState(storagePath: string): Promise<PersistedState>

// Save on every meaningful update (debounced 500ms)
async function saveState(storagePath: string, state: PersistedState): Promise<void>

// Reset (for development/testing)
async function clearState(storagePath: string): Promise<void>
```

---

## Webview Panel — Detailed Spec

### Panel Registration

```typescript
const panel = vscode.window.createWebviewPanel(
  'agentObservatory',
  'Agent Observatory',
  vscode.ViewColumn.Two,          // Opens beside the editor by default
  {
    enableScripts: true,
    retainContextWhenHidden: true, // Don't re-render when panel is hidden
    localResourceRoots: [context.extensionUri]
  }
);
```

### Layout

```
┌─────────────────────────────────────────────────────────────────┐
│  🔭 Agent Observatory          ● Claude Code  ● OpenCode        │
├──────────────┬──────────────────────────┬───────────────────────┤
│              │                          │                       │
│   Sessions   │     Agent Tree           │  Delegation Feed      │
│   (left)     │     (center, main)       │  (right)              │
│              │                          │                       │
├──────────────┴──────────────────────────┴───────────────────────┤
│                  File Workspace   |   Task Progress             │
│                        (bottom strip, tabbed)                   │
└─────────────────────────────────────────────────────────────────┘
```

**Important:** Use VSCode CSS variables throughout for all colors and fonts so the panel looks native in any VSCode theme (dark, light, high contrast):
- `var(--vscode-editor-background)`
- `var(--vscode-editor-foreground)`
- `var(--vscode-panel-border)`
- `var(--vscode-badge-background)` for status badges
- `var(--vscode-textLink-foreground)` for interactive elements

The panel header must include a **🔔 mute toggle button** for audio notifications.

### SessionList component

- List of all sessions (active first, then completed)
- Each item: project name, tool badge (Claude Code / OpenCode), status dot (🟢 active / 🟡 working / ⚪ idle / ⚫ completed), working directory, time since started
- Clicking a session filters all other panels to that session
- "All sessions" toggle available

### AgentTree component (React Flow)

- Nodes: one per agent (main + subagents)
- Edges: delegation relationship (main → subagent)
- Node content: `agent_type` as the label (e.g. "Explore", "Plan", "Bash", or custom name), current status, current task (last tool call, truncated)
- Node colors: use VSCode CSS variables, not hardcoded hex
- Edges animate (dashed) while delegation is in-progress
- Edge label: short excerpt of the delegation prompt
- Auto-layout updates as new subagents spawn
- **Parallel subagents:** when multiple subagents are active simultaneously, show them as sibling nodes at the same level, all connected to the main agent node, each with independent live status. This is the normal case — expect it, not the exception
- Tab between sessions if multiple sessions active simultaneously

### DelegationFeed component

Chronological feed of delegation events for the selected session:

```
[10:42:31] main-agent → Explore
           "Review the authentication changes in src/auth.ts for security issues"

[10:42:58] Explore → main-agent ✓
           "Found 2 issues: missing rate limiting on /login, JWT secret in env..."

[10:43:01] main-agent → Plan
           "Write unit tests for the fixed auth module"
           ⟳ in progress...
```

Each entry: timestamp, from → to (using `agent_type` as label), full delegation prompt (expandable on click), result when available (from `last_assistant_message` in `SubagentStop` payload — no transcript parsing needed), status icon. When multiple subagents are running in parallel, show all of them interleaved by timestamp with clear visual grouping so it's obvious which ones are concurrent.

### FileWorkspace component

File tree of all files touched in the current session:

```
src/
  auth.ts          ✏️ edited    [reviewer] [main-agent]
  api.ts           👁 read      [main-agent]
tests/
  auth.test.ts     ✏️ written   [test-writer]
```

- Icons: 👁 read, ✏️ write/edit
- Agent badges per file showing which agents touched it
- Files currently being accessed highlight and fade after 3s

### TaskProgress component

Delegation tree rendered as a task checklist:

```
Session: AI Hedge fund
├── [✓] Analyze existing trading strategy        main-agent
├── [✓] Review risk management module            reviewer (subagent)
├── [⟳] Write backtesting framework              coder (subagent)
└── [ ] Write tests                              (pending)
```

Each delegation = one task. Status derived from SubagentStart/Stop and delegation completed events.

---

## State Management (Webview)

Use **Zustand** for global state in the React webview:

```typescript
interface DashboardState {
  sessions: Record<string, Session>;
  agents: Record<string, Agent>;
  delegations: Record<string, DelegationEvent>;  // keyed by delegation id
  fileEvents: FileEvent[];
  selectedSessionId: string | null;
  connectionStatus: 'connected' | 'disconnected';
  // connectionStatus: set to 'connected' when INITIAL_STATE is received from extension.
  // set to 'disconnected' if the webview loses the message channel (e.g. extension crashes).
  // Show a "reconnecting..." banner in the UI when disconnected.
}
```

On webview load: send `READY` to extension → extension responds with `INITIAL_STATE` loaded from the JSON state file. All subsequent events are incremental patches to the Zustand store.

---

## Session Status Logic

| Signal | Status |
|---|---|
| `SessionStart` hook fired / new session file appeared | 🟢 Active |
| `PreToolUse` hook / new message file appearing | 🟡 Working |
| No new events for 30 seconds | ⚪ Idle |
| `Stop` hook fired | ⚫ Finished responding (may continue) |
| `SessionEnd` hook fired / final JSONL record present | ⚫ Completed (session terminated) |

---

## Auto-Detection Behavior

Zero per-project configuration required. When the user opens Claude Code or OpenCode in any folder:

1. **Claude Code:** `SessionStart` hook fires → POST to `localhost:3001/events` → instant panel update. Simultaneously, new `.jsonl` file is detected by `FileSystemWatcher`.
2. **OpenCode:** New session JSON file appears in `project/<slug>/storage/` → `FileSystemWatcher` catches it within ~200ms → session appears in panel.
3. **Panel re-opened:** Extension sends `INITIAL_STATE` from in-memory state (backed by JSON file) — full history restored instantly.
4. **VSCode restarted:** JSON state file retains all history, watchers re-attach on extension activation.

---

## Installation & Setup

### One-time setup (user does this once)

1. Clone the repo and run `npm install`
2. Run `npm run build`
3. In VSCode: `Extensions: Install from VSIX...` → select the built `.vsix`
   - OR during development: press `F5` in VSCode to launch Extension Development Host
4. Add the provided hook config to `%USERPROFILE%\.claude\settings.json` (file included in repo as `claude-hooks-config.json`)
5. Done — the panel opens automatically on next VSCode start, or via Command Palette: `Agent Observatory: Open Panel`

### Development workflow

```bash
npm run watch   # watches both extension host + webview, recompiles on change
# Press F5 in VSCode → Extension Development Host with live reload
```

### Building for distribution

```bash
npm run package   # produces agent-observatory-x.x.x.vsix
```

---

## Implementation Notes & Edge Cases

- **Audio notifications:** Play a short sound in the webview using the Web Audio API (no external files needed) on the following events: (1) `SUBAGENT_COMPLETED` message received — soft chime; (2) `SESSION_COMPLETED` received — distinct completion sound; (3) `NOTIFICATION` received (from Claude Code's native `Notification` hook — this fires when Claude genuinely needs user attention, making it the most reliable trigger) — urgent ping. Use the Web Audio API's `AudioContext` to generate tones programmatically — zero audio file dependencies. Add a mute toggle button in the panel header. Only play sounds when `document.visibilityState === 'hidden'` (VSCode window not focused) — never interrupt the user when they are actively watching the panel.
- **FileSystemWatcher outside workspace:** Both Claude Code and OpenCode store data outside any VSCode workspace folder. A plain string glob pattern passed to `createFileSystemWatcher` only watches inside the opened workspace — events from external paths are silently ignored. Always use `new vscode.RelativePattern(vscode.Uri.file(<absolute path>), <glob>)` for watching `%USERPROFILE%\.claude\` and `%USERPROFILE%\.local\share\opencode\`. Always push watchers to `context.subscriptions` so they are disposed when the extension deactivates.
- **No native modules:** Never use native compiled Node.js modules (`better-sqlite3`, `sqlite3`, `bcrypt`, etc.) in the extension host. They all fail with Electron Node.js version mismatches. Use only pure JS / TypeScript packages. The entire stack in this spec is native-module-free.
- **Windows command hooks:** `SessionStart`, `SubagentStart`, `SessionEnd`, and `Notification` use command hooks. Claude Code sends the JSON payload via **stdin** (not environment variables — `$CLAUDE_TOOL_INPUT` and similar env vars are always empty, confirmed by the Claude Code issue tracker). The bash command uses `curl -d @-` to read from stdin. The PowerShell command uses `[Console]::In.ReadToEnd()` to read stdin. The `windows` key in `settings.json` ensures Claude Code automatically runs the correct command per OS.
- **Windows paths:** Resolve `%USERPROFILE%` via `process.env.USERPROFILE` at runtime. Use Node's cross-platform `path` module for all path operations.
- **VSCode theme compatibility:** Use `var(--vscode-*)` CSS variables for all colors. Never hardcode hex. React Flow node styles must also use CSS variables.
- **Port 3001 conflict:** If port is in use on startup, show a VSCode notification and fall back to file-watching only. Claude Code events will be reconstructed from JSONL files with a small delay.
- **retainContextWhenHidden: true** — critical. Without it, the React app re-mounts every time the user switches panel tabs, losing all state.
- **Dashboard starts after sessions:** Always scan existing files on activation. Reconstruct state by replaying JSONL from the beginning.
- **Multiple simultaneous sessions:** All panels handle concurrent sessions. Agent Tree tabs per session. Delegation Feed and FileWorkspace filter to selected session.
- **OpenCode subagent detection:** Session files with `parentId` may arrive before or after their parent. Buffer orphaned subagents and link them when the parent session file appears.
- **JSONL parsing:** Each line is an independent JSON object. Parse line-by-line, skip malformed lines. New lines are appended as the session progresses — tail the file on change events.
- **OpenCode storage path verification:** On first activation, if `%USERPROFILE%\.local\share\opencode\project\` does not exist, show a one-time info notification: *"Agent Observatory: OpenCode storage not found. OpenCode sessions will not be monitored until OpenCode has been run at least once."*

---

## MVP Scope (Build in this order)

### Phase 1 — Extension scaffold + Claude Code hooks
- [ ] `package.json` manifest with `activationEvents: ["onStartupFinished"]`, `contributes.commands`
- [ ] `extension.ts` activate/deactivate
- [ ] Express HTTP server on `:3001` for Claude Code hooks
- [ ] JSON state persistence (`store.ts`) — load/save state to `context.globalStorageUri`
- [ ] Claude Code HTTP hook handlers (PreToolUse, PostToolUse, SubagentStop, Stop)
- [ ] Claude Code command hook handlers (SessionStart, SubagentStart, SessionEnd, Notification) — same `/events` endpoint
- [ ] `FileSystemWatcher` for Claude Code JSONL + sessions-index.json (needed for startup scan and fallback detection)
- [ ] Startup scan — parse all existing `.jsonl` files on activation to hydrate state
- [ ] Webview panel shell — blank React app with postMessage bridge working
- [ ] SessionList component
- [ ] `claude-hooks-config.json` with correct HTTP + command hook split for Windows

### Phase 2 — Agent Tree + Delegation
- [ ] AgentTree component (React Flow) with parallel subagent support
- [ ] DelegationFeed component
- [ ] TaskProgress component
- [ ] Audio notifications via Web Audio API (subagent complete, session complete, Notification hook) + mute toggle

### Phase 3 — File Workspace
- [ ] File event tracking from `PreToolUse` (Read/Write/Edit tools) — `CURRENT_TASK` + `FILE_ACTIVITY` events
- [ ] FileWorkspace component

### Phase 4 — OpenCode
- [ ] `FileSystemWatcher` for OpenCode storage directory
- [ ] Startup scan — parse all existing OpenCode session/message JSON files on activation
- [ ] OpenCode session/message JSON parser
- [ ] OpenCode delegation detection (task tool calls + parentId linking)
- [ ] Verify OpenCode VSCode extension writes to expected storage path on first test run

---

## Out of Scope

- Sending any commands to Claude Code or OpenCode
- Controlling or interrupting agents
- Authentication / multi-user
- Remote/networked sessions (local only)
- Publishing to VSCode Marketplace (personal use only)
- Any tool integration beyond Claude Code and OpenCode (for now)
