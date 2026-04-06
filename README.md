# Agent Observatory

Read-only VS Code dashboard for monitoring local **Claude Code**, **OpenCode**, and **Codex** sessions in one place.

The extension is designed for local observability, not control. It watches each tool's existing local state, normalizes it into a shared session model, and renders a live dashboard inside VS Code.

## Key Features

- Unified session fleet for Claude Code, OpenCode, and Codex
- Live session status tracking with `active`, `idle`, and `completed` states
- Delegation feed for subagent/task activity
- File activity timeline for read, write, and edit events
- Local-only processing with no telemetry or remote sync
- Automatic cleanup of extension state older than **7 days**
- Fleet filtering that hides stale or no-op inactive sessions by default
- Claude Code startup behavior aligned with OpenCode/Codex semantics

## Table of Contents

- [Tech Stack](#tech-stack)
- [Requirements](#requirements)
- [Getting Started](#getting-started)
- [How It Works](#how-it-works)
- [Session Lifecycle Rules](#session-lifecycle-rules)
- [Retention and Fleet Filtering](#retention-and-fleet-filtering)
- [Project Structure](#project-structure)
- [Available Scripts](#available-scripts)
- [Development Workflow](#development-workflow)
- [Configuration](#configuration)
- [Security and Privacy](#security-and-privacy)
- [Troubleshooting](#troubleshooting)
- [Packaging](#packaging)

## Tech Stack

- **Language**: TypeScript
- **Extension Host**: VS Code Extension API
- **Backend Runtime**: Node.js
- **Webview UI**: React 18 + Zustand
- **Build Tooling**: Webpack + ts-loader
- **Claude Code ingestion**: local JSONL transcripts + local HTTP hook server
- **OpenCode ingestion**: local SQLite database (`node:sqlite`)
- **Codex ingestion**: local JSONL session logs

## Requirements

- VS Code `1.74.0` or newer
- Node.js and npm for local development
- At least one supported agent tool installed and run once:
  - Claude Code
  - OpenCode
  - Codex

### Local data locations

The extension reads from local tool state only:

- **Claude Code**: `%USERPROFILE%\.claude\...`
- **OpenCode**: `%USERPROFILE%\.local\share\opencode\opencode.db`
- **Codex**:
  - `%USERPROFILE%\.codex\sessions\...`
  - `%USERPROFILE%\.codex\archived_sessions\...`

## Getting Started

### 1. Install dependencies

```bash
npm install
```

### 2. Configure Claude Code hooks

Claude Code needs hooks so the extension can receive live session events instead of relying only on transcript scanning.

Open your Claude Code settings file:

- **Windows**: `%USERPROFILE%\.claude\settings.json`
- **macOS/Linux**: `~/.claude/settings.json`

Merge the `hooks` configuration from [`claude-hooks-config.json`](./claude-hooks-config.json) into your Claude Code settings.

If you change the port, update every hook URL to the same port as the VS Code setting:

```json
"agentObservatory.hooksPort": 3001
```

### 3. Run each tool at least once

The extension can only monitor sources that already exist locally:

- Claude Code must have created `.jsonl` transcripts
- OpenCode must have created `opencode.db`
- Codex must have created session logs in `.codex`

### 4. Start the extension in development

```bash
npm run watch
```

Press `F5` in VS Code to open an **Extension Development Host** window.

### 5. Open the panel

The panel opens automatically on VS Code startup because the extension activates on `onStartupFinished`.

You can also open it manually from the command palette:

```text
Agent Observatory: Open Panel
```

## How It Works

The extension has two major runtime parts:

1. **Extension host**
   - Loads persisted state
   - Starts tool-specific watchers
   - Starts the Claude hook server
   - Owns the normalized dashboard state

2. **Webview**
   - Renders the dashboard UI
   - Receives extension messages
   - Displays the fleet, delegation feed, agent tree, and file activity

### Tool ingestion model

#### Claude Code

Claude Code is handled with a hybrid approach:

- **Live events** arrive through the local hook server at `127.0.0.1:<port>`
- **Transcript scanning** reads existing `.jsonl` files under `.claude`

This is important because hooks provide real-time status changes, while transcript scanning lets the extension rebuild context after VS Code restarts.

#### OpenCode

OpenCode is read from its local SQLite database:

- The extension watches `opencode.db*`
- It also polls every few seconds to catch updates reliably
- The parser rebuilds sessions, agents, delegations, and file events from the database tables

No extra hook setup is required.

#### Codex

Codex is reconstructed from local session logs:

- Active sessions are read from `.codex/sessions`
- Archived sessions are read from `.codex/archived_sessions`
- File watchers trigger rescans when logs change

No extra hook setup is required.

## Session Lifecycle Rules

This is the behavior the dashboard currently implements.

### Shared model

Every tool is normalized to the same session statuses:

- `active`
- `idle`
- `completed`

### Claude Code behavior

Claude now follows the same dashboard rule you wanted:

- **`SessionStart` does not make a session active**
- A new Claude session is created as **idle**
- It only becomes **active** after the first real activity event arrives
- If VS Code restarts, previously restored transient Claude sessions are reset to **idle**

This avoids phantom active sessions that appear just because Claude created a session shell.

### OpenCode and Codex behavior

- OpenCode and Codex infer activity from real underlying data
- Fresh activity remains `active`
- Stale sessions become `idle`
- Archived/ended sessions become `completed`

### Stale activity handling

The extension marks active Claude/Codex sessions idle when they have been inactive for too long.

## Retention and Fleet Filtering

This part matters because the extension is intentionally not a permanent archive.

### One-week retention

The extension now keeps only **7 days** of session state in its own persisted storage.

That means:

- Sessions older than 7 days are pruned from the extension's internal state
- Related agents, delegations, and file activity for those sessions are also pruned
- This does **not** delete the original source data from Claude Code, OpenCode, or Codex

So if you want older history, you still go back to the original tool. The extension only keeps a recent monitoring window.

### Fleet visibility rules

The Session Fleet is intentionally opinionated:

- `Active` sessions are always shown
- Inactive sessions older than the retention window are hidden
- Inactive sessions with no recorded work are hidden by default
- The selected session stays visible while you are inspecting it

The default list is now effectively a **recent, useful sessions** view, not a raw archive dump.

## Project Structure

```text
.
├── media/                     # Extension icon and static assets
├── out/                       # Compiled extension and webview bundles
├── src/                       # Extension host source
│   ├── parsers/               # Tool-specific parsers
│   ├── watchers/              # Tool-specific watchers
│   ├── extension.ts           # Activation entrypoint
│   ├── panel.ts               # Webview panel manager
│   ├── server.ts              # Claude hook HTTP server
│   ├── sessionRetention.ts    # One-week state pruning
│   ├── sessionVisibility.ts   # Fleet filtering rules
│   ├── state.ts               # Runtime state manager
│   ├── store.ts               # Persisted state store
│   ├── taskLabel.ts           # Current-task normalization
│   └── types.ts               # Shared types
├── test/                      # Node-based regression tests
├── webview/                   # React webview app
│   ├── components/            # Dashboard UI pieces
│   └── store/                 # Zustand webview store
├── claude-hooks-config.json   # Example Claude hook config
├── package.json
├── tsconfig.json
└── webpack.config.js
```

## Available Scripts

| Command | Description |
|---------|-------------|
| `npm install` | Install dependencies |
| `npm run watch` | Start webpack in watch mode for development |
| `npm run compile` | Build production extension and webview bundles |
| `npm run package` | Build a `.vsix` package |
| `npm run version:patch` | Bump the extension version without creating a git tag |
| `npm run release:patch` | Bump the patch version and build a fresh `.vsix` |
| `node --test test\\*.cjs` | Run the current test suite |

## Development Workflow

### Build the extension

```bash
npm run compile
```

This builds:

- `out/extension.js` for the extension host
- `out/webview.js` for the React dashboard

### Run tests

```bash
node --test test\*.cjs
```

The tests currently cover:

- Claude watcher/session behavior
- Session lifecycle handling
- Current-task parsing
- Fleet visibility filtering
- One-week retention pruning

### Typical local dev loop

```bash
npm install
npm run watch
```

Then:

1. Press `F5`
2. Open the Extension Development Host
3. Start Claude Code, OpenCode, or Codex activity locally
4. Open the Agent Observatory panel

## Configuration

### VS Code settings

#### `agentObservatory.hooksPort`

- **Type**: number
- **Default**: `3001`
- **Valid range**: `1-65535`

This must match the port used in your Claude Code hook configuration.

## Security and Privacy

- Local-only processing
- No telemetry
- No external API calls for monitoring
- Claude hook server binds to `127.0.0.1`
- Session data remains on your machine

Important distinction:

- The extension may **read** local tool state
- The extension does **not** modify Claude/OpenCode/Codex session history
- Retention pruning only affects the extension's own persisted state

## Troubleshooting

### Claude Code sessions do not appear

Check the following:

- Claude hooks are configured correctly
- The configured hook port matches `agentObservatory.hooksPort`
- Claude transcript files exist under `%USERPROFILE%\.claude\...`
- The VS Code Output panel contains `AgentObservatory` logs

### Claude sessions appear idle when no work has started

That is expected now.

The dashboard intentionally treats Claude the same way as the other tools:

- session shell created -> `idle`
- first real work event -> `active`

### OpenCode sessions do not appear

Check the database path:

```text
%USERPROFILE%\.local\share\opencode\opencode.db
```

Also confirm:

- OpenCode has been run at least once
- The database file exists
- You give the watcher a few seconds for the poll cycle

### Codex sessions do not appear

Check that logs exist in:

```text
%USERPROFILE%\.codex\sessions
%USERPROFILE%\.codex\archived_sessions
```

Then confirm:

- Codex has been run at least once
- The VS Code Output panel shows watcher activity

### "Port 3001 is in use"

Change the VS Code setting:

```json
"agentObservatory.hooksPort": 3002
```

Then update the Claude hook configuration to the same port.

### Sessions disappear after a week

That is expected.

The extension now prunes its own stored session state after 7 days. Older history should still be available in the underlying agent tools unless you delete it there.

## Packaging

Build a distributable VSIX:

```bash
npm run package
```

If you are publishing an update to the marketplace, bump the extension version first. `vsce` uses the version in
`package.json`; rebuilding alone will not increment it.

Fastest patch release flow:

```bash
npm run release:patch
```

You can also bump the version manually first:

```bash
npm run version:patch
npm run package
```

Then install it from VS Code:

```text
Extensions: Install from VSIX...
```

## License

[MIT](./LICENSE)
