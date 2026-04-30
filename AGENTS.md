# AGENTS.md — opencode-cmux

> Non-discoverable context for agentic coding loops. Everything here is
> information you **cannot** figure out just by reading the source code.

## Mental Model

This is an [OpenCode](https://opencode.ai) plugin that bridges OpenCode's
event hooks to [cmux](https://cmux.dev)'s sidebar/notification UI. The core
data flow is:

```
OpenCode hooks → normalizeEvent() → CmuxStateCoordinator → cmux CLI or socket
```

The coordinator is a **state machine** — it accumulates session state, tool
activity, file edits, todos, questions, and permissions, then renders a
**single sidebar status pill + optional progress bar** on every state change.
Only one status can be shown at a time, so there is an implicit priority order.

## State Priority Order (highest wins)

| Priority | Condition                 | Status text | Icon          | Color   |
|----------|---------------------------|-------------|---------------|---------|
| 1        | Permission pending        | `waiting`   | `lock`        | #ef4444 |
| 2        | Question pending          | `question`  | `help-circle` | #a855f7 |
| 3        | Primary session busy      | `working…`  | `terminal`    | #f59e0b |
| 4        | Primary session error     | `error`     | `alert-circle`| #ef4444 |
| 5        | Primary session idle+done | `done`      | `check-circle`| #22c55e |
| —        | No primary session        | *(cleared)* | —             | —       |

This priority is implemented in `buildSnapshot()` in `src/state/presenter.ts`
(around line 479). **Any change to this method must preserve the priority
order or explicitly document a new one.**

## How to Add a New Event Type

1. Add a variant to the `NormalizedEvent` union in `src/events.ts`
2. Add a `case` in `normalizeEvent()` in the same file to parse the raw event
3. Add a `handle*()` public method on `CmuxStateCoordinator` in
   `src/state/presenter.ts`
4. Wire the handler in `src/index.ts`:
   - For `event()` hook events: add a `case` in the switch statement
   - For named hooks (`permission.ask`, `tool.execute.*`): add a new hook key
5. Add tests in `tests/presenter.test.ts` using the helpers from
   `tests/helpers/`

## Dual Transport Protocol

The cmux socket (`/tmp/cmux.sock`) uses **two different protocols**:

| Command type        | Protocol    | Format example |
|---------------------|-------------|----------------|
| Sidebar metadata    | Text (v1)   | `set_status opencode "working: bash" --icon=terminal --color=#f59e0b --tab=<uuid>\n` |
| Notifications       | JSON-RPC    | `{"id":"req-1","method":"notification.create","params":{"title":"Done"}}\n` |

Key differences from CLI:
- Socket sidebar commands use **underscores** (`set_status`) not hyphens (`set-status`)
- Socket sidebar commands use `--key=value` not `--key value`
- Socket sidebar commands use `--tab=<uuid>` not `--workspace <uuid>`
- **Multi-word positional values must be quoted** (e.g. `"working: bash"`)
- JSON-RPC responses use `{"ok":true}` not standard JSON-RPC 2.0 format
- Socket text/sidebar commands are **fire-and-forget**. Resolve after the
  payload is written; do **not** wait for a response or for the server to close
  the connection. The macOS cmux socket can accept the connection and keep it
  open for more than 5s after commands like `clear_notifications`, even though
  the path is correct.
- JSON-RPC notification commands are different: keep waiting for their response
  and parse `ok:false` failures.

The CLI transport is always safe for multi-word values because `spawn()`
passes them as separate array elements. The socket text protocol is the one
that needs quoting.

Command builders live in `src/cmux/commands.ts` — CLI builders return
`string[]`, socket builders return `string`.

Socket detection caveats:
- `hasSocket: true` only means `statSync(socketPath).isSocket()` passed. It
  does not prove cmux will answer a command.
- A wrong or absent socket usually surfaces as `ENOENT` or `ECONNREFUSED`.
  `ETIMEDOUT` means the request did not complete in time; do not permanently
  disable socket transport on a single timeout.
- Socket discovery tries explicit env vars first (`CMUX_SOCKET_PATH`, then
  `CMUX_SOCKET`), then candidate locations. The macOS app socket path
  `~/Library/Application Support/cmux/cmux.sock` is one expected candidate and
  should be preferred when it exists, but it is not the only valid location.

## Constraints

- **Zero dependencies** — only Node.js/Bun built-ins (`node:net`,
  `node:child_process`, `node:path`)
- **Never throw from hook handlers** — every hook in `index.ts` wraps its
  body in try/catch. Timer callbacks (`setTimeout`) must also be wrapped.
  An unhandled rejection crashes the OpenCode host process.
- **Invisible when cmux is absent** — if `detectCmuxEnvironment()` finds no
  socket/workspace, the plugin returns `{}` (no hooks) and does nothing.
- **Render throttling** — `render()` coalesces rapid state changes to at
  most one cmux call per 200ms. Sidebar logs are rate-limited to 5/sec.
- **Startup cleanup must be guarded** — `initialize()` runs lazily after plugin
  construction. It must not clear presentation state once a busy session,
  active tool, current status, or progress snapshot exists; otherwise it can
  wipe a live cmux progress bar while the coordinator still thinks it is visible.
- **Primary completion ordering matters** — on primary idle, render the final
  `done` status and `1.0` progress before sending the completion notification.
  Subagent idle/completion must not drive the primary session to `done` or
  force main progress to `1.0`.
- **Session rename/title updates** — OpenCode creates sessions with a generic
  title, then later emits `session.updated` with the real prompt-derived title.
  `handleSessionUpdated()` must refresh metadata with a fresh resolver lookup
  and re-render the live progress label while the session is still busy.
- **No shutdown hook** — OpenCode's plugin API has no `dispose`/`shutdown`
  lifecycle event. The coordinator's `dispose()` method exists for tests
  only. All timers are one-shot `setTimeout`s wrapped in try/catch, so
  they are harmless if they fire (or don't) after the host process exits.

## Config

All configuration is via environment variables with the `OPENCODE_CMUX_`
prefix. See `src/config.ts` for parsing logic and defaults. The
`PluginConfig` interface is defined in `src/config.ts` (canonical) and
re-exported nowhere — agents should read `config.ts` directly.

Key defaults to know:
- `transport`: `"auto"` (prefer socket, fall back to CLI)
- `progressEnabled`: `true`
- `keepDoneStatus`: `true` (show "done" pill after session ends)
- `notifySubagents`: `false` (desktop notifications for subagent events off by default)
- `staleSessionTimeoutMs`: `0` (disabled — no auto-clear of stuck sessions)

## Testing

```bash
bun test            # run all tests
bun test --watch    # watch mode
bun build src/index.ts --outdir=dist   # build check
```

Test helpers (`FakeCmuxClient`, `FakeSessionResolver`, `noopLogger`,
`createCoordinator`) are in `tests/helpers/index.ts`.

## File Inventory

| File | Purpose | Lines |
|------|---------|-------|
| `src/index.ts` | Plugin entry point, hook wiring | ~156 |
| `src/types.ts` | All shared interfaces | ~138 |
| `src/config.ts` | Env-var config (14 options) | ~69 |
| `src/events.ts` | Event normalization | ~222 |
| `src/logger.ts` | Plugin logger wrapper | small |
| `src/cmux/detect.ts` | cmux environment detection | small |
| `src/cmux/commands.ts` | CLI + socket command builders | ~197 |
| `src/cmux/client.ts` | CmuxClient factory | small |
| `src/cmux/socket-client.ts` | Unix socket transport | medium |
| `src/opencode/session-resolver.ts` | Session metadata cache | ~58 |
| `src/state/presenter.ts` | **CmuxStateCoordinator** (main) | ~725 |
| `src/state/session-state.ts` | Session types + helpers | small |
| `src/state/progress-tracker.ts` | Progress estimation | small |
| `src/state/project-context.ts` | Project context resolution | small |
