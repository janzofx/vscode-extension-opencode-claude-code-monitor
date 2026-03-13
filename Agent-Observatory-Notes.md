# Agent Observatory - Build Notes (2026-03-12)

## Summary
The Agent Observatory VS Code extension now monitors Claude Code, OpenCode, and Codex sessions in one dashboard. The panel remains read-only and local-only. Claude uses hooks plus JSONL watchers, OpenCode uses SQLite polling/watcher sync, and Codex uses JSONL rollout/session watchers under `%USERPROFILE%\.codex`.

## High-level Architecture
- **Extension Host**: VS Code extension in TypeScript.
- **Webview**: React + Zustand dashboard.
- **Claude Code**: hooks HTTP server + JSONL file watchers.
- **OpenCode**: SQLite DB reader (read-only) with watcher + polling.
- **Codex**: JSONL session watcher + parser for `session_meta`, `event_msg`, and `response_item`.

## Key Functional Areas

### 1) OpenCode DB Ingestion
- Reads `%USERPROFILE%\.local\share\opencode\opencode.db`.
- Watches `opencode.db` and `opencode.db-wal` and polls every 3 seconds.
- Uses watermarks from `session`, `message`, and `part`.
- Builds sessions, agents, delegations, and file events from DB state.

### 2) Codex Ingestion
- Watches:
  - `%USERPROFILE%\.codex\sessions\**\*.jsonl`
  - `%USERPROFILE%\.codex\archived_sessions\**\*.jsonl`
  - `%USERPROFILE%\.codex\session_index.jsonl` (metadata trigger)
- Parses Codex rollout JSONL and maps to existing dashboard state model.
- Creates one root/main agent per Codex session.
- Tracks current task from latest function/tool activity or agent message.
- Tracks file activity from file-oriented tool calls (best-effort extraction).
- Marks archived Codex sessions as completed.

### 3) Session Status / Stale Handling
- Shared stale timeout for active sessions is 60 minutes.
- Claude and Codex active sessions are moved to idle when stale.
- OpenCode derives status from DB activity and archival markers.

### 4) Dashboard UX Behavior
- **Sessions**: All/Active filter, newest-first ordering, clear selection.
- **Tool colors**:
  - Claude Code: blue
  - OpenCode: green
  - Codex: cyan
- **Agents**: active tabs; fallback to showing non-active agents if a session has no active ones.
- **Progress panels**:
  - Codex shows a clear empty-state message for delegation/task progress when no native delegation data is available.
- **File workspace**: unified file activity list for all three tools.

### 5) Packaging / Docs
- `README.md` and `package.json` updated for Codex support.
- Extension remains local-only with no telemetry.
- Existing build warning from Express/webpack is unchanged and non-blocking.

## Known Paths
- OpenCode DB: `%USERPROFILE%\.local\share\opencode\opencode.db`
- Claude Code config: `%USERPROFILE%\.claude\settings.json`
- Claude Code JSONL: `%USERPROFILE%\.claude\projects\...` (or `.claude` fallback)
- Codex sessions: `%USERPROFILE%\.codex\sessions\...`
- Codex archived sessions: `%USERPROFILE%\.codex\archived_sessions\...`

## Key Files (Reference)
- `src/watchers/opencode.ts` - OpenCode DB watcher + polling + watermark detection.
- `src/parsers/opencode.ts` - OpenCode DB mapping to dashboard state.
- `src/watchers/claudeCode.ts` - Claude JSONL watcher and startup scan.
- `src/parsers/claudeCode.ts` - Claude JSONL parser.
- `src/watchers/codex.ts` - Codex session/archived-session watcher and snapshot builder.
- `src/parsers/codex.ts` - Codex JSONL parser and normalization.
- `src/store.ts` - tool-scoped state replacement (`replaceToolState`).
- `src/state.ts` - stale session idle sweeper.
- `webview/components/SessionList.tsx` - tool badges and session list behavior.
- `webview/components/DelegationFeed.tsx` - Codex-specific delegation empty state.
- `webview/components/TaskProgress.tsx` - Codex-specific task-progress empty state.

## Notes
- Hooks port remains configurable via `agentObservatory.hooksPort`.
- Codex integration is watcher-based and requires no external network hook setup.
- Extension monitor scope is now three tools: Claude Code, OpenCode, Codex.
