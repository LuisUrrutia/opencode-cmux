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

## OpenCode Plugin Coding Contract

OpenCode plugins are JavaScript or TypeScript modules exporting one or more
plugin functions. Each function receives `{ project, client, $, directory,
worktree }` and returns a hooks object. This repo exports one default `Plugin`
from `src/index.ts`; keep that module shape stable for npm loading.

There are two hook styles:
- **Catch-all events**: `event: async ({ event }) => { ... }`. Route these
  through `normalizeEvent()` in `src/events.ts`, then switch only on the
  normalized union in `src/index.ts`. Unknown or malformed events should return
  `null` and be ignored.
- **Named hooks**: string keys in the returned hooks object, such as
  `"permission.ask"`, `"tool.execute.before"`, `"tool.execute.after"`, and
  `"shell.env"`. Named hooks receive `(input, output)` and usually mutate
  `output` in place. Throwing from a hook can block host behavior, so this
  plugin should only throw intentionally; normal handler failures must be caught.

Important documented event families:
- Command: `command.executed`
- File: `file.edited`, `file.watcher.updated`
- Installation: `installation.updated`
- LSP: `lsp.client.diagnostics`, `lsp.updated`
- Message: `message.part.removed`, `message.part.updated`, `message.removed`,
  `message.updated`
- Permission: `permission.asked`, `permission.replied`
- Server: `server.connected`
- Session: `session.created`, `session.compacted`, `session.deleted`,
  `session.diff`, `session.error`, `session.idle`, `session.status`,
  `session.updated`
- Todo: `todo.updated`
- Shell: `shell.env`
- Tool: `tool.execute.before`, `tool.execute.after`
- TUI: `tui.prompt.append`, `tui.command.execute`, `tui.toast.show`

Coding rules for this repo:
- Keep raw OpenCode shapes out of the presenter. Parse defensively in
  `src/events.ts` using helper-style extraction (`asRecord`, `getString`,
  `readSessionID`) and pass stable typed data into `CmuxStateCoordinator`.
- Update `src/types.ts` when adding named hook input/output contracts. Avoid
  `any`; host payloads are unstable, so prefer `unknown` plus guarded parsing.
- Every hook body in `src/index.ts` must be wrapped in `try/catch` and use
  `logHookError()`. Never let hook failures escape into the OpenCode host.
- Timer callbacks must also catch or swallow failures. An unhandled rejection can
  crash the plugin host process.
- Use `client.app.log()` through `createPluginLogger()` for structured logs.
  Avoid `console.log()` for runtime diagnostics.
- If adding OpenCode custom tools later, use `tool()` from `@opencode-ai/plugin`
  and remember plugin tools override built-ins on name collision.
- Tests should document behavior in `tests/events.test.ts`,
  `tests/plugin.test.ts`, and `tests/presenter.test.ts`; use helpers from
  `tests/helpers/index.ts` for coordinator tests.

## npm Release Work

Distribution details are internal release concerns, not runtime behavior. For an
npm release of `@luisurrutia/opencode-cmux`:
- Published plugins must expose an importable JS module entry. Keep
  `package.json` `main`/`exports` pointed at `dist/index.js`, and keep
  `dist`, `README.md`, and `LICENSE` in `files`.
- OpenCode installs npm plugins automatically with Bun at startup and caches
  packages under `~/.cache/opencode/node_modules/`. Keep the package compatible
  with Bun's ESM loading path.
- Regular and scoped npm packages are supported. Runtime dependencies belong in
  package metadata; local-plugin-only `.opencode/package.json` dependency advice
  does not apply to the published package.
- Before publishing, run `bun test`, `bun run build`, and ideally
  `npm pack --dry-run` to verify the tarball contains the built entrypoint.
- GitHub Actions for releases should validate test/build/pack on PRs and publish
  only from tags or a manual release workflow using an npm token. Do not publish
  from every push to `main`.
- If a release workflow also tests consumption, install the packed tarball in a
  scratch project and verify OpenCode can import the package name from config.

## Dual Transport Protocol

The cmux API docs (`https://cmux.com/docs/api`) define the socket as one
newline-terminated JSON request per call:
`{"id":"req-1","method":"workspace.list","params":{}}\n`. JSON socket
requests must use `method` and `params`; legacy v1 JSON payloads like
`{"command":"..."}` are not supported. Responses are cmux-shaped JSON
(`{"id":"req-1","ok":true,"result":{...}}`), not standard JSON-RPC 2.0.

Sidebar metadata is the exception: it still uses the text socket protocol.
So this plugin uses **two different socket protocols**:

| Command type        | Protocol    | Format example |
|---------------------|-------------|----------------|
| Sidebar metadata    | Text (v1)   | `set_status opencode "working: bash" --icon=terminal --color=#f59e0b --tab=<uuid>\n` |
| Notifications       | JSON request | `{"id":"req-1","method":"notification.create","params":{"title":"Done"}}\n` |

Key differences from CLI:
- Socket sidebar commands use **underscores** (`set_status`) not hyphens (`set-status`)
- Socket sidebar commands use `--key=value` not `--key value`
- Socket sidebar commands use `--tab=<uuid>` not `--workspace <uuid>`
- **Multi-word positional values must be quoted** (e.g. `"working: bash"`)
- Notification socket methods are `notification.create`, `notification.clear`,
  and `notification.list`; do not use sidebar-style text commands for them.
- JSON socket responses use `{"ok":true}` not standard JSON-RPC 2.0 format.
- Socket text/sidebar commands are **fire-and-forget**. Resolve after the
  payload is written; do **not** wait for a response or for the server to close
  the connection. The macOS cmux socket can accept the connection and keep it
  open for more than 5s after sidebar commands like `clear_log`, even though
  the path is correct.
- Notification writes should also be treated as write-complete in this plugin:
  the documented JSON request is correct, but observed macOS cmux sockets can
  accept `notification.create`/`notification.clear` and keep the connection open,
  which makes response-waiting code report false `ETIMEDOUT` failures.
- Use response parsing only for socket API calls where this plugin needs the
  returned `result` or must act on `ok:false`.

The CLI transport is always safe for multi-word values because `spawn()`
passes them as separate array elements. The socket text protocol is the one
that needs quoting.

Command builders live in `src/cmux/commands.ts` — CLI builders return
`string[]`, socket builders return `string`.

Socket detection caveats:
- Default socket paths from the docs are `/tmp/cmux.sock`,
  `/tmp/cmux-debug.sock`, and `/tmp/cmux-debug-<tag>.sock`, with
  `CMUX_SOCKET_PATH` as the override. The macOS app may also expose
  `~/Library/Application Support/cmux/cmux.sock`.
- Socket access mode can be `off`, `cmuxOnly`, or `allowAll` via
  `CMUX_SOCKET_MODE`; default settings normally allow only processes spawned
  inside cmux terminals.
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
