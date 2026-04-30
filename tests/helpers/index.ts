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
  | { type: "clearNotifications" }
  | { type: "notify"; payload: NotificationPayload }
  | { type: "setStatus"; key: string; payload: SidebarStatusPayload }
  | { type: "clearStatus"; key: string }
  | { type: "setProgress"; payload: ProgressPayload }
  | { type: "clearProgress" }
  | { type: "log"; payload: SidebarLogPayload }
  | { type: "clearLog" }
  | { type: "reportGitBranch"; branch: string; dirty: boolean }

export class FakeCmuxClient implements CmuxClient {
  public readonly available = true
  public readonly transport: "cli" | "socket"
  public readonly preciseTabTargeting: boolean
  public readonly workspaceID?: string
  public readonly tabID?: string
  public readonly surfaceID?: string
  public readonly calls: FakeCall[] = []

  public constructor(options: {
    transport?: "cli" | "socket"
    preciseTabTargeting?: boolean
    workspaceID?: string
    tabID?: string
    surfaceID?: string
  } = {}) {
    this.transport = options.transport ?? "cli"
    this.preciseTabTargeting = options.preciseTabTargeting ?? true
    this.workspaceID = options.workspaceID ?? "workspace:1"
    this.tabID = options.tabID ?? "tab:1"
    this.surfaceID = options.surfaceID ?? "surface:1"
  }

  public async clearNotifications(): Promise<void> {
    this.calls.push({ type: "clearNotifications" })
  }

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

  public async clearLog(): Promise<void> {
    this.calls.push({ type: "clearLog" })
  }

  public async reportGitBranch(branch: string, dirty: boolean): Promise<void> {
    this.calls.push({ type: "reportGitBranch", branch, dirty })
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

  public setSession(sessionID: string, metadata: SessionMetadata): void {
    this.sessions[sessionID] = metadata
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
  gitIntegration: true,
  staleSessionTimeoutMs: 0,
  doneTimeoutMs: 0,
} as const

/**
 * Create a CmuxStateCoordinator wired to fakes, ready for testing.
 * Returns the coordinator plus the fake cmux client and config for assertions.
 */
export function createCoordinator(
  sessions: Record<string, SessionMetadata>,
  options: { root?: string; label?: string; cmux?: FakeCmuxClient } = {},
) {
  const cmux = options.cmux ?? new FakeCmuxClient()
  const config = { ...defaultTestConfig }
  const sessionResolver = new FakeSessionResolver(sessions)
  const coordinator = new CmuxStateCoordinator({
    cmux,
    config,
    logger: noopLogger,
    project: {
      id: "demo",
      label: options.label ?? "demo",
      root: options.root ?? "/tmp/demo",
    },
    sessionResolver,
  })

  return { coordinator, cmux, config, sessionResolver }
}
