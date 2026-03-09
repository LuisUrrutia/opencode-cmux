# opencode-cmux

`@attamusc/opencode-cmux` is an OpenCode plugin that turns OpenCode activity into richer `cmux` sidebar feedback for the **current cmux workspace**. It tracks primary-agent vs subagent work, surfaces questions and permission waits, and keeps project context in notifications, logs, and progress updates.

## Features

- Detects whether OpenCode is running inside a cmux-managed workspace and safely no-ops outside cmux.
- **Optional Unix socket transport** (`/tmp/cmux.sock`) eliminates per-call process spawning (~1-2ms vs ~20-50ms). Falls back to CLI automatically.
- Tracks the active project and primary agent session in the cmux sidebar.
- Distinguishes subagent lifecycle events from primary-session completion to reduce notification spam.
- Uses sidebar status pills, logs, and progress bars for working, waiting, question, done, and error states.
- Shows real-time tool execution in sidebar status (e.g., "working: bash" or "working: 2 tools").
- Logs file edits to the sidebar with deduplication for rapid consecutive edits to the same file.
- Tracks session lifecycle events (created, deleted, compacted) and todo list progress.
- Dynamic progress estimation based on tool call count, elapsed time, and todo completion.
- Render throttling, sidebar log rate limiting, and stale session cleanup for resilience under load.

## Requirements

- [OpenCode](https://opencode.ai/) with plugin support.
- [`cmux`](https://www.cmux.dev/) installed and available on `PATH`.
- A cmux-managed terminal so `CMUX_WORKSPACE_ID` is available.

## Installation

### npm package

Add the package name to your OpenCode config:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["@attamusc/opencode-cmux"]
}
```

### Local development

Build the plugin and point OpenCode at the generated entrypoint:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["file:///absolute/path/to/opencode-cmux/dist/index.js"]
}
```

Then build the package:

```bash
bun run build
```

## Behavior

### Primary session lifecycle

- `session.status = busy` sets a `working` status pill and an activity progress bar.
- `session.status = idle` logs success, notifies, and leaves a `done` status visible.
- `session.error` logs and notifies with project/session context, then marks the workspace as `error`.

### Questions and permissions

- `question.asked` switches the sidebar to `question`, logs the prompt title, and sends a notification.
- `question.replied` / `question.rejected` restore the prior working/done/error state.
- `permission.ask` switches the sidebar to `waiting`, logs the request title, and sends a notification.
- `permission.replied` clears the waiting overlay and restores the underlying state.

### Subagents

- Busy subagents are logged separately.
- While the primary session is busy, the status pill includes the busy subagent count.
- Subagents log completion by default and can optionally notify via environment configuration.

## Configuration

The first version uses environment variables so it works with either local plugins or published packages without relying on undocumented host-specific plugin config wiring.

| Variable | Default | Description |
| --- | --- | --- |
| `OPENCODE_CMUX_BIN` | `cmux` | Override the `cmux` executable path. |
| `OPENCODE_CMUX_STATUS_KEY` | `opencode` | Sidebar status key namespace. |
| `OPENCODE_CMUX_TRANSPORT` | `auto` | Transport mode: `auto` (socket if available, CLI fallback), `socket`, or `cli`. |
| `OPENCODE_CMUX_NOTIFY_SUBAGENTS` | `false` | Notify on subagent completion and errors. |
| `OPENCODE_CMUX_LOG_SUBAGENTS` | `true` | Log subagent lifecycle events to the sidebar. |
| `OPENCODE_CMUX_PROGRESS` | `true` | Show activity-based progress updates. |
| `OPENCODE_CMUX_KEEP_DONE_STATUS` | `true` | Keep the `done` state visible after completion. |
| `OPENCODE_CMUX_NOTIFY_QUESTIONS` | `true` | Notify when the agent asks a question. |
| `OPENCODE_CMUX_NOTIFY_PERMISSIONS` | `true` | Notify when OpenCode needs permission approval. |
| `OPENCODE_CMUX_LOG_TOOLS` | `true` | Log tool execution start/finish to the sidebar. |
| `OPENCODE_CMUX_LOG_TOOLS_VERBOSE` | `false` | Include full tool arguments in log entries. |
| `OPENCODE_CMUX_LOG_FILE_EDITS` | `true` | Log file edits to the sidebar. |
| `OPENCODE_CMUX_LOG_SESSION_LIFECYCLE` | `true` | Log session created/deleted/compacted events. |
| `OPENCODE_CMUX_LOG_TODOS` | `true` | Log todo list progress to the sidebar. |
| `OPENCODE_CMUX_STALE_TIMEOUT` | `0` | Timeout in ms to clear stuck "working" states. `0` disables. |

Boolean variables accept `1`, `true`, `yes`, or `on` for true and `0`, `false`, `no`, or `off` for false.

## Development

```bash
bun test
bun run build
```

## Roadmap

- Expand beyond the current workspace when there is a clear multi-workspace coordination model.
