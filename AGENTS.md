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
activity, file edits, todos, questions, and permissions, then renders this
OpenCode process' **local cmux status pill + optional progress bar** on every
state change. Multiple OpenCode terminals in the same cmux workspace can show
multiple pills because each process writes a distinct cmux status key.

Within one plugin instance, only one primary status can be shown at a time, so
there is an implicit priority order.

## State Priority Order (highest wins)

| Priority | Condition                              | Status text                         | Icon          | Color      |
|----------|----------------------------------------|-------------------------------------|---------------|------------|
| 1        | Permission pending                     | `waiting`                           | `lock`        | #ef4444    |
| 2        | Question pending                       | `question`                          | `help-circle` | #a855f7    |
| 3        | Primary busy, active tool, or subagent | `working [- N tools] [- M subagents]` | `terminal`  | surface accent |
| 4        | Primary session error                  | `error`                             | `alert-circle`| #ef4444    |
| 5        | Primary session idle+done              | `done`                              | `check-circle`| #22c55e    |
| —        | No primary session/activity            | *(cleared)*                         | —             | —          |

This priority is implemented in `buildSnapshot()` in `src/state/presenter.ts`.
**Any change to this method must preserve the priority order or explicitly
document a new one.**

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
- `src/index.ts` schedules `coordinator.initialize()` and `syncGitState()` in a
  zero-delay timer after hooks are returned. Those startup tasks are deliberately
  lazy and best-effort so plugin construction does not block OpenCode hook
  registration.
- `process.once("beforeExit")` calls `coordinator.cleanup()` as a best-effort
  terminal cleanup, but OpenCode still has no real plugin dispose hook. Do not
  rely on cleanup for correctness; state transitions must be correct while live.

## Runtime Behavior Contracts

These are easy to break because they emerge from several files rather than one
obvious API:
- `renderNow()` diffs the next `PresentationSnapshot` against `currentSnapshot`
  before calling cmux. Identical status and progress payloads are skipped; this
  is the main anti-flicker/idempotence layer.
- cmux stores custom status pills as workspace-local `statusEntries[key]`.
  Multiple visible pills require **different keys in the same workspace**.
  The status command's `--tab=<uuid>` targets the cmux workspace/sidebar tab;
  it is not the per-terminal identity. Status entries have no `source` or
  `title` field, so do not try to distinguish OpenCode processes that way.
- Main sidebar status is written to a local per-surface key, not directly to the
  base `statusKey`. The key is `${statusKey}:${sanitizeStatusKeyPart(seed)}`.
  With complete cmux IDs, `seed` is the joined tuple
  `workspaceID:tabID:surfaceID`. If `surfaceID` is missing, the seed also uses
  primary session ID, project ID, project root, and the process PID to reduce
  collisions. In current cmux, `CMUX_TAB_ID` is a backward-compatible alias for
  the workspace ID, while `CMUX_SURFACE_ID` is the per-terminal/session identity.
  Include `surfaceID` in the key seed or parallel OpenCode terminals in one
  workspace can overwrite each other's pill.
- Working status is a count summary, not a tool-name display:
  `working`, `working - 1 tool`, `working - 3 subagents`, or
  `working - N tools - M subagents`. Zero-count segments are intentionally
  omitted. It can be driven by primary busy state, local active tools, or busy
  subagents, because hook ordering can report tool or subagent activity before
  the primary busy event arrives.
- Working status color is a deterministic HSL accent derived from the same cmux
  status seed. It is a visual hint for distinguishing surfaces, not a guarantee
  of global uniqueness across every possible surface.
- The old auxiliary keys `opencode:tools`, `opencode:subagents`, and
  `opencode:todos` are legacy cleanup targets now. Current tool/subagent counts
  are folded into the per-surface working summary, and todos influence
  progress/logs rather than rendering a separate status pill.
- Primary terminal paths (`idle`, `error`, stale-session clear, done-timeout
  clear, and deletion/cleanup) must clear transient auxiliary state: active
  tools, todo state, and busy subagent activity. This prevents stale counts from
  leaking into `done`, `error`, or the next session.
- `clearPresentationBestEffort()` and startup/session-start cleanup only run when
  `cmux.preciseTabTargeting` is true. Without a real tab ID, clearing can wipe
  another workspace/tab, so tests expect cleanup to be skipped. Safe cleanup
  clears the local per-surface status key, the base status key, and legacy
  auxiliary keys for migration cleanup. Startup/session-start cleanup must not
  clear shared workspace progress or logs. Primary cleanup and local status
  transitions also must not call `clearProgress()`, because cmux progress has no
  key/source/surface ownership check and clearing can wipe another OpenCode
  surface's live bar. The one allowed clear is immediately after rendering
  primary completion at `1.0` and sending the done notification, so the native
  progress bar does not linger at 100%.
- `OpencodeSessionResolver` has a 5s negative cache after session lookup
  failures. `fresh: true` bypasses a successful cache entry, but it does not
  bypass recent-failure suppression; callers get fallback primary metadata.
- Socket clients self-disable after `ENOENT` or `ECONNREFUSED` and log the
  connection failure once. CLI clients are also best-effort: missing `cmux`
  (`ENOENT`) is logged once, and non-zero exits are logged with trimmed output.
- `syncGitState()` reports branch metadata only when git integration is enabled
  and `detectGitInfo()` finds a branch. It also reruns after bash commands whose
  command string contains `git`. Git probing is capped with a 500ms timeout.
- `ProgressTracker` uses a high-water mark. Working progress starts at `0.1`,
  never reaches `1.0` while active, waiting states have a `0.5` floor, and idle
  always reports `1.0`.

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
- Question notifications should put the question text in `body`, not only
  `subtitle`. Done notifications already use `body`, and cmux/macOS notification
  click behavior has been observed to feel inconsistent when question text is
  subtitle-only. Keep question notifications body-based unless cmux behavior
  changes.
- Use response parsing only for socket API calls where this plugin needs the
  returned `result` or must act on `ok:false`.

The CLI transport is always safe for multi-word values because `spawn()`
passes them as separate array elements. The socket text protocol is the one
that needs quoting.

Command builders live in `src/cmux/commands.ts` — CLI builders return
`string[]`, socket builders return `string`.

cmux identity details that matter for status keys:
- `CMUX_WORKSPACE_ID` is the sidebar workspace/tab target.
- `CMUX_TAB_ID` is kept for backward compatibility and currently matches the
  workspace ID in cmux-managed terminals.
- `CMUX_SURFACE_ID` is the individual terminal/browser surface. Use it to make
  OpenCode process status keys unique inside one workspace.
- Socket sidebar commands still use `--tab=<workspace-id>` because they mutate
  workspace-local metadata. Do not pass `surfaceID` as `--tab`; include it in
  the status key instead.

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
  active tool, current status, or progress snapshot exists. It also must not
  clear shared progress/log resources that may belong to another OpenCode
  process in the same cmux workspace.
- **Progress clearing is intentionally narrow** — cmux progress is workspace
  metadata, not a keyed status entry. `applyProgress()` may write updated labels
  and values, but a local transition to no progress must not call
  `clearProgress()`. Only primary completion should clear after the final 100%
  update has been rendered.
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
- `gitIntegration`: `true` (report branch/dirty metadata to cmux)
- `staleSessionTimeoutMs`: `0` (disabled — no auto-clear of stuck sessions)
- `doneTimeoutMs`: `10000` (clear lingering done pill after 10s; tests often set this to `0`)

## Testing

```bash
bun test            # run all tests
bun test --watch    # watch mode
bun build src/index.ts --outdir=dist   # build check
```

Test helpers (`FakeCmuxClient`, `FakeSessionResolver`, `noopLogger`,
`createCoordinator`) are in `tests/helpers/index.ts`.

Presenter/coordinator tests should use `createCoordinator()` rather than
hand-rolling fakes. Its default config intentionally differs from runtime in one
important way: `doneTimeoutMs` is `0` so done-state tests are deterministic unless
a test opts into the timer. `FakeCmuxClient` records calls only; use
`cmux.reset()` between phases and `await coordinator.flush()` before asserting on
coalesced renders. The default fake cmux IDs are `workspace:1`, `tab:1`, and
`surface:1`, so the default local status key is
`opencode:workspace-1-tab-1-surface-1`.

Timing behavior is part of the public contract: render throttling coalesces rapid
state changes, sidebar logs are capped at 5/sec, stale-session timers and
done-state timers are real timers, and `dispose()`/`cleanup()` must cancel pending
timers for deterministic tests. Surface behavior is also contractual: working
status keys and colors are deterministic per cmux identity tuple, and tests
should cover any change to the local status-key fallback chain, zero-count
summary formatting, and legacy key cleanup.

Command-builder tests are exact protocol tests, not snapshots to casually update.
CLI builders use hyphenated command names and `--workspace`/`--surface`; socket
text builders use underscored names, newline termination, `--tab=<id>`, quoted
multi-word values, and `--` before log messages. JSON socket builders strip
`undefined`, preserve `null`, increment request IDs, and use
`notification.create` / `notification.clear`.

## File Inventory

| File | Purpose | Lines |
|------|---------|-------|
| `src/index.ts` | Plugin entry point, hook wiring | ~174 |
| `src/types.ts` | All shared interfaces | ~138 |
| `src/config.ts` | Env-var config (16 options) | ~106 |
| `src/events.ts` | Event normalization | ~222 |
| `src/logger.ts` | Plugin logger wrapper | small |
| `src/cmux/detect.ts` | cmux environment detection | small |
| `src/cmux/commands.ts` | CLI + socket command builders | ~197 |
| `src/cmux/client.ts` | CmuxClient factory | small |
| `src/cmux/socket-client.ts` | Unix socket transport | medium |
| `src/opencode/session-resolver.ts` | Session metadata cache | ~58 |
| `src/state/presenter.ts` | **CmuxStateCoordinator** (main) | ~1062 |
| `src/state/session-state.ts` | Session types + helpers | small |
| `src/state/progress-tracker.ts` | Progress estimation | small |
| `src/state/project-context.ts` | Project context resolution | small |
