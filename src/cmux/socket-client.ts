import { connect } from "node:net"
import type {
  CmuxClient,
  NotificationPayload,
  PluginLogger,
  ProgressPayload,
  SidebarLogPayload,
  SidebarStatusPayload,
} from "../types.js"
import {
  buildSocketClearNotifications,
  buildSocketClearProgress,
  buildSocketClearStatus,
  buildSocketLog,
  buildSocketNotify,
  buildSocketReportGitBranch,
  buildSocketSetProgress,
  buildSocketSetStatus,
  parseCmuxResponse,
} from "./commands.js"

// ---------------------------------------------------------------------------
// Low-level socket request
// ---------------------------------------------------------------------------

interface SocketRequestOptions {
  socketPath: string
  payload: string // newline-terminated string to send
  timeoutMs: number
}

interface SocketResult {
  response: string
  error?: undefined
}

interface SocketError {
  response?: undefined
  error: { code: string; message: string }
}

type SocketOutcome = SocketResult | SocketError

/**
 * Send a single request over a Unix socket and return the response.
 *
 * Opens a new connection for each call (connect-per-call). This is simpler
 * than persistent connections and already much faster than spawning processes
 * (~1-2ms vs ~20-50ms). Never rejects — all errors are returned as SocketError.
 *
 * Protocol: writes the payload (newline-terminated), then reads the response
 * until the server closes the connection. The server reads the newline-terminated
 * message, processes it, and responds by writing the response and closing.
 */
export function socketRequest(
  options: SocketRequestOptions,
): Promise<SocketOutcome> {
  return new Promise((resolve) => {
    let data = ""
    let settled = false

    const settle = (outcome: SocketOutcome) => {
      if (settled) return
      settled = true
      resolve(outcome)
    }

    let socket: ReturnType<typeof connect>
    try {
      socket = connect({ path: options.socketPath })
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      const code =
        typeof err === "object" && err !== null && "code" in err
          ? String((err as { code: unknown }).code)
          : "UNKNOWN"
      settle({ error: { code, message: error.message } })
      return
    }

    socket.setTimeout(options.timeoutMs)

    socket.on("connect", () => {
      socket.write(options.payload)
    })

    socket.on("data", (chunk) => {
      data += chunk.toString()
    })

    socket.on("end", () => {
      settle({ response: data })
    })

    socket.on("close", () => {
      // Safety net: if end didn't fire, settle with whatever we have
      settle({ response: data })
    })

    socket.on("timeout", () => {
      socket.destroy()
      settle({
        error: {
          code: "ETIMEDOUT",
          message: `Socket request timed out after ${options.timeoutMs}ms`,
        },
      })
    })

    socket.on("error", (err) => {
      const code =
        typeof err === "object" && err !== null && "code" in err
          ? String((err as { code: unknown }).code)
          : "UNKNOWN"
      socket.destroy()
      settle({
        error: { code, message: err.message },
      })
    })
  })
}

// ---------------------------------------------------------------------------
// SocketCmuxClient
// ---------------------------------------------------------------------------

interface SocketCmuxClientOptions {
  socketPath: string
  workspaceID?: string
  logger: PluginLogger
  timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 5000

export class SocketCmuxClient implements CmuxClient {
  public readonly available: boolean
  public readonly transport = "socket" as const
  public readonly workspaceID?: string

  private requestCounter = 0
  private reportedConnectionFailure = false

  private readonly socketPath: string
  private readonly logger: PluginLogger
  private readonly timeoutMs: number

  constructor(options: SocketCmuxClientOptions) {
    this.socketPath = options.socketPath
    this.workspaceID = options.workspaceID
    this.logger = options.logger
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.available = true
  }

  public async notify(payload: NotificationPayload): Promise<void> {
    const requestID = this.nextRequestID()
    const message = buildSocketNotify(payload, requestID, this.workspaceID)
    await this.sendJsonRpc(message, "notify")
  }

  public async clearNotifications(): Promise<void> {
    const message = buildSocketClearNotifications(this.workspaceID)
    await this.sendText(message, "clear_notifications")
  }

  public async setStatus(
    key: string,
    payload: SidebarStatusPayload,
  ): Promise<void> {
    const message = buildSocketSetStatus(key, payload, this.workspaceID)
    await this.sendText(message, "set_status")
  }

  public async clearStatus(key: string): Promise<void> {
    const message = buildSocketClearStatus(key, this.workspaceID)
    await this.sendText(message, "clear_status")
  }

  public async setProgress(payload: ProgressPayload): Promise<void> {
    const message = buildSocketSetProgress(payload, this.workspaceID)
    await this.sendText(message, "set_progress")
  }

  public async clearProgress(): Promise<void> {
    const message = buildSocketClearProgress(this.workspaceID)
    await this.sendText(message, "clear_progress")
  }

  public async log(payload: SidebarLogPayload): Promise<void> {
    const message = buildSocketLog(payload, this.workspaceID)
    await this.sendText(message, "log")
  }

  public async reportGitBranch(branch: string, dirty: boolean): Promise<void> {
    const message = buildSocketReportGitBranch(branch, dirty, this.workspaceID)
    await this.sendText(message, "report_git_branch")
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private nextRequestID(): string {
    return `req-${++this.requestCounter}`
  }

  /**
   * Send a JSON-RPC request and check the response for ok:false.
   */
  private async sendJsonRpc(payload: string, label: string): Promise<void> {
    const outcome = await socketRequest({
      socketPath: this.socketPath,
      payload,
      timeoutMs: this.timeoutMs,
    })

    if (outcome.error) {
      this.handleError(outcome.error, label)
      return
    }

    const parsed = parseCmuxResponse(outcome.response)
    if (parsed && !parsed.ok) {
      await this.logger.log("warn", `cmux ${label} returned error`, {
        error: parsed.error,
      })
    }
  }

  /**
   * Send a text-format command. Response is ignored (sidebar commands return "OK").
   */
  private async sendText(payload: string, label: string): Promise<void> {
    const outcome = await socketRequest({
      socketPath: this.socketPath,
      payload,
      timeoutMs: this.timeoutMs,
    })

    if (outcome.error) {
      this.handleError(outcome.error, label)
    }
    // Text-format commands return "OK" — nothing to parse
  }

  /**
   * Handle socket errors with the same pattern as CliCmuxClient:
   * log connection failures once, then silently no-op.
   */
  private handleError(
    error: { code: string; message: string },
    label: string,
  ): void {
    if (error.code === "ECONNREFUSED" || error.code === "ENOENT") {
      if (this.reportedConnectionFailure) return
      this.reportedConnectionFailure = true
    }

    // Fire-and-forget: don't await the logger to avoid blocking the caller
    void this.logger.log("error", `cmux socket ${label} failed`, {
      code: error.code,
      error: error.message,
    })
  }
}
