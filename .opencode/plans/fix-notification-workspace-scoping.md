# Fix: Notification commands missing workspace/tab scoping

## Problem

Notifications sent by the plugin are never associated with a workspace. Every
other cmux command (sidebar status, progress, log, clear variants) correctly
passes the workspace ID via `--workspace` (CLI) or `--tab=` / `workspace_id`
(socket), but the two notification builders and both client `notify()` methods
omit it entirely.

The cmux notification lifecycle is **workspace-scoped**: badges appear on the
workspace tab, clicking a notification jumps to that workspace, and suppression
depends on "the specific workspace sending the notification" being active
(per https://www.cmux.dev/docs/notifications). Without the workspace ID, cmux
cannot correctly attribute the notification, so it defaults to the first
workspace regardless of which one triggered it.

## Evidence

| Command builder | Accepts `workspaceID`? | Passes it through? |
|---|---|---|
| `buildSetStatusCommand` | Yes | Yes (`--workspace`) |
| `buildSocketSetStatus` | Yes | Yes (`--tab=`) |
| `buildClearStatusCommand` | Yes | Yes |
| `buildSocketClearStatus` | Yes | Yes |
| `buildSetProgressCommand` | Yes | Yes |
| `buildSocketSetProgress` | Yes | Yes |
| `buildClearProgressCommand` | Yes | Yes |
| `buildSocketClearProgress` | Yes | Yes |
| `buildLogCommand` | Yes | Yes |
| `buildSocketLog` | Yes | Yes |
| **`buildNotifyCommand`** | **No** | **No** |
| **`buildSocketNotify`** | **No** | **No** |

Both `CliCmuxClient` and `SocketCmuxClient` store `this.workspaceID` and pass
it to every builder except the notification ones.

## Plan

### Phase 0: Validate `workspace_id` param key against live cmux

Before writing any production code, run a probe script against the live cmux
socket to confirm the JSON-RPC param key `workspace_id` is accepted by
`notification.create`. This resolves the open question about the correct key
name.

**Script:** `scripts/probe-notify-workspace.ts` (temporary, not committed)

The script sends three `notification.create` requests sequentially to the cmux
socket at `$CMUX_SOCKET_PATH` (or `/tmp/cmux.sock`):

1. **Baseline** -- no `workspace_id`, just `title`/`body`. Expect `ok: true`.
   Confirms the socket is working and notifications are accepted.

2. **Probe** -- includes `workspace_id` set to `$CMUX_WORKSPACE_ID`. Expect
   `ok: true`. If cmux rejects unknown params, this would return `ok: false`.

3. **Control** -- includes `bogus_param: "xxx"` instead of `workspace_id`.
   If this also returns `ok: true`, cmux silently ignores unknown params and
   the response alone cannot distinguish valid from invalid keys. In that case
   we must also **visually confirm** in the cmux UI that test 2's notification
   appeared with the correct workspace badge/attribution, while tests 1 and 3
   did not.

Each test is labeled in the notification title (e.g. "Probe 1/3: baseline")
so you can identify them in the cmux notification panel.

**Interpreting results:**

| Baseline | Probe | Control | Conclusion |
|---|---|---|---|
| ok | ok | ok | cmux ignores unknown params; must visually verify routing |
| ok | ok | error | `workspace_id` is a recognized param; confirmed |
| ok | error | -- | `workspace_id` is rejected; try alternative keys (`workspace`, `tab`) |
| error | -- | -- | Socket/notification issue unrelated to this fix |

**After running:** Open the cmux notification panel (`Cmd+Shift+I`) and check
whether the "Probe 2/3" notification is associated with the current workspace
tab while "Probe 1/3" and "Probe 3/3" are not (or are attributed to the
default/first workspace).

**Script implementation (zero dependencies, uses `node:net`):**

```ts
import { connect } from "node:net"

const SOCKET = process.env.CMUX_SOCKET_PATH ?? "/tmp/cmux.sock"
const WORKSPACE = process.env.CMUX_WORKSPACE_ID

if (!WORKSPACE) {
  console.error("CMUX_WORKSPACE_ID is not set -- run this inside a cmux terminal")
  process.exit(1)
}

interface RpcResult { id: string; ok: boolean; error?: string }

function send(payload: Record<string, unknown>): Promise<RpcResult> {
  return new Promise((resolve, reject) => {
    const socket = connect({ path: SOCKET })
    let data = ""
    socket.on("connect", () => socket.write(JSON.stringify(payload) + "\n"))
    socket.on("data", (chunk) => { data += chunk.toString() })
    socket.on("end", () => {
      try { resolve(JSON.parse(data.trim())) }
      catch { reject(new Error(`Bad response: ${data}`)) }
    })
    socket.on("error", reject)
    socket.setTimeout(5000)
    socket.on("timeout", () => { socket.destroy(); reject(new Error("timeout")) })
  })
}

async function run() {
  console.log(`Socket:    ${SOCKET}`)
  console.log(`Workspace: ${WORKSPACE}\n`)

  // Test 1: Baseline (no workspace_id)
  const r1 = await send({
    id: "probe-1", method: "notification.create",
    params: { title: "Probe 1/3: baseline", body: "No workspace_id param" },
  })
  console.log(`1. Baseline (no workspace_id):  ok=${r1.ok}${r1.error ? ` error="${r1.error}"` : ""}`)

  // Test 2: Probe (with workspace_id)
  const r2 = await send({
    id: "probe-2", method: "notification.create",
    params: {
      title: "Probe 2/3: workspace_id",
      body: `workspace_id=${WORKSPACE}`,
      workspace_id: WORKSPACE,
    },
  })
  console.log(`2. With workspace_id:           ok=${r2.ok}${r2.error ? ` error="${r2.error}"` : ""}`)

  // Test 3: Control (bogus param)
  const r3 = await send({
    id: "probe-3", method: "notification.create",
    params: {
      title: "Probe 3/3: bogus param",
      body: "bogus_param=xxx",
      bogus_param: "xxx",
    },
  })
  console.log(`3. With bogus_param:            ok=${r3.ok}${r3.error ? ` error="${r3.error}"` : ""}`)

  console.log("\nDone. Check cmux notification panel (Cmd+Shift+I) to verify")
  console.log("that Probe 2/3 is attributed to this workspace's tab.")
}

run().catch((err) => { console.error(err); process.exit(1) })
```

Run with: `bun run scripts/probe-notify-workspace.ts`

If `workspace_id` is confirmed, proceed to phase 1. If rejected, try
`workspace` or `tab` as the key and re-run. Update the plan accordingly
before proceeding.

### Phase 1: Update CLI notification builder

**File:** `src/cmux/commands.ts` (line 16)

Add an optional `workspaceID` parameter to `buildNotifyCommand` and use the
existing `withWorkspace()` helper -- identical to how every other CLI builder
works.

```ts
// Before
export function buildNotifyCommand(payload: NotificationPayload): string[] {

// After
export function buildNotifyCommand(
  payload: NotificationPayload,
  workspaceID?: string,
): string[] {
  const args = ["notify", "--title", payload.title]
  if (payload.subtitle) args.push("--subtitle", payload.subtitle)
  if (payload.body) args.push("--body", payload.body)
  return withWorkspace(args, workspaceID)
}
```

### Phase 2: Update socket JSON-RPC notification builder

**File:** `src/cmux/commands.ts` (line 154)

Add an optional `workspaceID` parameter to `buildSocketNotify` and include
`workspace_id` in the JSON-RPC params when present. The key `workspace_id`
matches the convention used by other cmux JSON-RPC methods (e.g.
`workspace.select` uses `params.workspace_id`).

```ts
// Before
export function buildSocketNotify(
  payload: NotificationPayload,
  requestID: string,
): string {

// After
export function buildSocketNotify(
  payload: NotificationPayload,
  requestID: string,
  workspaceID?: string,
): string {
  return buildJsonRpc(
    "notification.create",
    {
      title: payload.title,
      subtitle: payload.subtitle,
      body: payload.body,
      workspace_id: workspaceID,
    },
    requestID,
  )
}
```

When `workspaceID` is `undefined`, `buildJsonRpc` already strips `undefined`
values from params (line 144), so backwards compat is preserved automatically.

### Phase 3: Wire workspace ID through both clients

**File:** `src/cmux/client.ts` (line 70)

```ts
// Before
public async notify(payload: Parameters<CmuxClient["notify"]>[0]): Promise<void> {
  await this.execute("notify", buildNotifyCommand(payload))
}

// After
public async notify(payload: Parameters<CmuxClient["notify"]>[0]): Promise<void> {
  await this.execute("notify", buildNotifyCommand(payload, this.workspaceID))
}
```

**File:** `src/cmux/socket-client.ts` (line 154)

```ts
// Before
public async notify(payload: NotificationPayload): Promise<void> {
  const requestID = this.nextRequestID()
  const message = buildSocketNotify(payload, requestID)
  await this.sendJsonRpc(message, "notify")
}

// After
public async notify(payload: NotificationPayload): Promise<void> {
  const requestID = this.nextRequestID()
  const message = buildSocketNotify(payload, requestID, this.workspaceID)
  await this.sendJsonRpc(message, "notify")
}
```

### Phase 4: Add tests

#### CLI notification builder with workspace (`tests/commands.test.ts`)

Add two tests in the "CLI command builders" `describe` block, after the
existing `buildNotifyCommand` tests (after line 48):

- `buildNotifyCommand with workspace` -- asserts `--workspace` and the ID
  appear at the end of the args array.
- `buildNotifyCommand without workspace preserves existing behavior` -- asserts
  the args array is unchanged from the current output (no `--workspace`).

#### Socket JSON-RPC notification builder with workspace (`tests/commands.test.ts`)

Add two tests in the `buildSocketNotify` `describe` block (after line 353):

- `buildSocketNotify includes workspace_id when provided` -- parses the JSON
  output and asserts `params.workspace_id` equals the supplied ID.
- `buildSocketNotify omits workspace_id when undefined` -- parses the JSON
  output and asserts `workspace_id` is not present in `params`.

#### Socket client integration test (`tests/socket-client.test.ts`)

Add a test in the `notify (JSON-RPC)` `describe` block (after line 212):

- `includes workspace_id in JSON-RPC params when client has workspaceID` --
  creates a `SocketCmuxClient` with a `workspaceID`, calls `notify()`,
  captures the raw JSON sent to the test server, and asserts
  `parsed.params.workspace_id` matches the client's workspace ID.

The existing test at line 191 already creates the client with `workspaceID`
but never asserts on it -- this new test makes the expectation explicit.

### Phase 5: Clean up

- Delete `scripts/probe-notify-workspace.ts` (not committed).
- Run `bun test` and `bun build src/index.ts --outdir=dist` to verify.

## Files changed

| File | Change |
|---|---|
| `scripts/probe-notify-workspace.ts` | Temporary probe script (phase 0, deleted in phase 5) |
| `src/cmux/commands.ts` | Add `workspaceID` param to `buildNotifyCommand` and `buildSocketNotify` |
| `src/cmux/client.ts` | Pass `this.workspaceID` in `CliCmuxClient.notify()` |
| `src/cmux/socket-client.ts` | Pass `this.workspaceID` in `SocketCmuxClient.notify()` |
| `tests/commands.test.ts` | Add workspace tests for both notification builders |
| `tests/socket-client.test.ts` | Add workspace passthrough test for socket client |

## Verification

```bash
bun run scripts/probe-notify-workspace.ts   # phase 0: validate param key
bun test                                    # all tests pass
bun build src/index.ts --outdir=dist        # build check
```
