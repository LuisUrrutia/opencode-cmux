/**
 * Shared test helpers for opencode-cmux tests.
 *
 * Exports:
 * - FakeCmuxClient — in-memory CmuxClient that records all calls
 * - FakeSessionResolver — returns pre-configured session metadata
 * - noopLogger — silent PluginLogger
 * - createCoordinator — convenience factory that wires everything together
 */

import { CmuxStateCoordinator } from "../../src/state/presenter.ts"
import type {
  CmuxClient,
  NotificationPayload,
  PluginLogger,
  ProgressPayload,
  SessionMetadata,
  SessionResolver,
  SidebarLogPayload,
  SidebarStatusPayload,
} from "../../src/types.ts"

// ---------------------------------------------------------------------------
// FakeCmuxClient
// ---------------------------------------------------------------------------

export type FakeCall =
  | { type: "notify"; payload: NotificationPayload }
  | { type: "setStatus"; key: string; payload: SidebarStatusPayload }
  | { type: "clearStatus"; key: string }
  | { type: "setProgress"; payload: ProgressPayload }
  | { type: "clearProgress" }
  | { type: "log"; payload: SidebarLogPayload }

export class FakeCmuxClient implements CmuxClient {
  public readonly available = true
  public readonly transport = "cli" as const
  public readonly workspaceID = "workspace:1"
  public readonly calls: FakeCall[] = []

  public async notify(payload: NotificationPayload): Promise<void> {
    this.calls.push({ type: "notify", payload })
  }

  public async setStatus(
    key: string,
    payload: SidebarStatusPayload,
  ): Promise<void> {
    this.calls.push({ type: "setStatus", key, payload })
  }

  public async clearStatus(key: string): Promise<void> {
    this.calls.push({ type: "clearStatus", key })
  }

  public async setProgress(payload: ProgressPayload): Promise<void> {
    this.calls.push({ type: "setProgress", payload })
  }

  public async clearProgress(): Promise<void> {
    this.calls.push({ type: "clearProgress" })
  }

  public async log(payload: SidebarLogPayload): Promise<void> {
    this.calls.push({ type: "log", payload })
  }

  public reset(): void {
    this.calls.length = 0
  }
}

// ---------------------------------------------------------------------------
// FakeSessionResolver
// ---------------------------------------------------------------------------

export class FakeSessionResolver implements SessionResolver {
  public constructor(private readonly sessions: Record<string, SessionMetadata>) {}

  public async getSessionMetadata(sessionID: string): Promise<SessionMetadata | null> {
    return this.sessions[sessionID] ?? null
  }
}

// ---------------------------------------------------------------------------
// noopLogger
// ---------------------------------------------------------------------------

export const noopLogger: PluginLogger = {
  async log() {},
}

// ---------------------------------------------------------------------------
// createCoordinator
// ---------------------------------------------------------------------------

/** Default config used by most presenter tests. */
export const defaultTestConfig = {
  cmuxBin: "cmux",
  statusKey: "opencode",
  notifySubagents: false,
  logSubagents: true,
  progressEnabled: true,
  keepDoneStatus: true,
  notifyQuestions: true,
  notifyPermissions: true,
  logToolCalls: true,
  logToolCallsVerbose: false,
  logFileEdits: true,
  logSessionLifecycle: true,
  logTodos: true,
  staleSessionTimeoutMs: 0,
  doneTimeoutMs: 0,
} as const

/**
 * Create a CmuxStateCoordinator wired to fakes, ready for testing.
 * Returns the coordinator plus the fake cmux client and config for assertions.
 */
export function createCoordinator(sessions: Record<string, SessionMetadata>) {
  const cmux = new FakeCmuxClient()
  const config = { ...defaultTestConfig }
  const coordinator = new CmuxStateCoordinator({
    cmux,
    config,
    logger: noopLogger,
    project: {
      id: "demo",
      label: "demo",
      root: "/tmp/demo",
    },
    sessionResolver: new FakeSessionResolver(sessions),
  })

  return { coordinator, cmux, config }
}
