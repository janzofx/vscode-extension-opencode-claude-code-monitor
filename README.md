# Agent Observatory

A read-only monitoring dashboard for Claude Code, OpenCode, and Codex sessions inside VS Code.

## Features

- Live session list for Claude Code, OpenCode, and Codex with active/idle/completed states
- Active/All session filters and tool color-coding
- Agent tabs with current task details
- Delegation feed
- Progress area with Tasks and Files shown side by side
- File activity list (read/write/edit)
- OpenCode ingestion via SQLite database (no CLI shelling)
- Claude Code updates via hooks and JSONL transcript watching
- Codex updates via local JSONL session-log watching

## Requirements

- VS Code 1.74+
- Claude Code installed and run at least once (JSONL transcripts exist)
- OpenCode installed and run at least once (SQLite DB exists)
- Codex installed and run at least once (`%USERPROFILE%\\.codex\\sessions\\...` exists)

## Setup

### Claude Code Hooks

1. Open your Claude Code settings file:
   - Windows: `%USERPROFILE%\.claude\settings.json`
   - Mac/Linux: `~/.claude/settings.json`
2. Merge the contents of `claude-hooks-config.json` from this repo into your `hooks` section.
3. If you changed the hooks port, update all `http://localhost:PORT/events` entries to match.

### OpenCode

OpenCode sessions are read from:

`%USERPROFILE%\.local\share\opencode\opencode.db`

Run OpenCode at least once so the database exists.

### Codex

Codex sessions are read from:

- `%USERPROFILE%\.codex\sessions\...`
- `%USERPROFILE%\.codex\archived_sessions\...`

Run Codex at least once so the session logs exist. No extra hook setup is required.

## Configuration

VS Code Settings:

- `Agent Observatory: Hooks Port` (`agentObservatory.hooksPort`)
  - Default: `3001`
  - Must match the port used in your Claude Code hooks config.

## Usage

- The panel opens automatically on VS Code startup.
- Command palette: `Agent Observatory: Open Panel`
- Use the `All` / `Active` filter in the Sessions list.

## Security & Privacy

- Local-only processing. No telemetry.
- Data stays on your machine.
- Listens on `127.0.0.1:<hooksPort>` for Claude Code hooks.
- Reads Codex session logs locally from `%USERPROFILE%\.codex`.

## Development

```bash
npm install
npm run watch
```

Press `F5` in VS Code to launch the Extension Development Host.

## Packaging

```bash
npm install
npm run package
```

Then install the generated `.vsix` via `Extensions: Install from VSIX...`.

## Troubleshooting

### "Port 3001 is in use"
Change `Agent Observatory: Hooks Port` to a free port and update your Claude Code hooks config to match.
The hooks URL must be `http://127.0.0.1:<port>/events`.

### No Claude Code sessions appearing
- Verify JSONL transcripts exist under `%USERPROFILE%\.claude\...`.
- Check the VS Code Output panel for "Agent Observatory" logs.
- Confirm the hooks config is merged into Claude Code settings.

### No OpenCode sessions appearing
- Verify the DB exists at `%USERPROFILE%\.local\share\opencode\opencode.db`.
- Start a new OpenCode session and wait a few seconds for the poll cycle.

### No Codex sessions appearing
- Verify session logs exist under `%USERPROFILE%\.codex\sessions\...`.
- Check the VS Code Output panel for "Agent Observatory" logs.
- Start a new Codex session and wait for the watcher refresh.
