import { spawn } from "node:child_process"
import type { PluginLogger, CmuxClient } from "../types.js"
import {
  buildClearProgressCommand,
  buildClearStatusCommand,
  buildLogCommand,
  buildNotifyCommand,
  buildSetProgressCommand,
  buildSetStatusCommand,
} from "./commands.js"
import type { CmuxEnvironment } from "./detect.js"
import { SocketCmuxClient } from "./socket-client.js"

interface CommandResult {
  exitCode: number
  signal: string | null
  stdout: string
  stderr: string
}

interface CreateCmuxClientOptions {
  binary: string
  environment: CmuxEnvironment
  logger: PluginLogger
  transport: "cli" | "socket" | "auto"
}

function runCommand(binary: string, args: string[]): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    })

    let stdout = ""
    let stderr = ""

    child.stdout?.setEncoding("utf8")
    child.stderr?.setEncoding("utf8")
    child.stdout?.on("data", (chunk) => {
      stdout += chunk
    })
    child.stderr?.on("data", (chunk) => {
      stderr += chunk
    })

    child.once("error", reject)
    child.once("close", (exitCode, signal) => {
      resolve({
        exitCode: exitCode ?? 1,
        signal,
        stdout,
        stderr,
      })
    })
  })
}

class CliCmuxClient implements CmuxClient {
  public readonly available: boolean
  public readonly transport = "cli" as const
  public readonly workspaceID?: string
  private reportedMissingBinary = false

  public constructor(private readonly options: CreateCmuxClientOptions) {
    this.available = options.environment.isManagedWorkspace
    this.workspaceID = options.environment.workspaceID
  }

  public async notify(payload: Parameters<CmuxClient["notify"]>[0]): Promise<void> {
    await this.execute("notify", buildNotifyCommand(payload, this.workspaceID))
  }

  public async setStatus(
    key: string,
    payload: Parameters<CmuxClient["setStatus"]>[1],
  ): Promise<void> {
    await this.execute(
      "set-status",
      buildSetStatusCommand(key, payload, this.workspaceID),
    )
  }

  public async clearStatus(key: string): Promise<void> {
    await this.execute("clear-status", buildClearStatusCommand(key, this.workspaceID))
  }

  public async setProgress(
    payload: Parameters<CmuxClient["setProgress"]>[0],
  ): Promise<void> {
    await this.execute(
      "set-progress",
      buildSetProgressCommand(payload, this.workspaceID),
    )
  }

  public async clearProgress(): Promise<void> {
    await this.execute("clear-progress", buildClearProgressCommand(this.workspaceID))
  }

  public async log(payload: Parameters<CmuxClient["log"]>[0]): Promise<void> {
    await this.execute("log", buildLogCommand(payload, this.workspaceID))
  }

  private async execute(label: string, args: string[]): Promise<void> {
    if (!this.available) return

    try {
      const result = await runCommand(this.options.binary, args)
      if (result.exitCode === 0) return

      await this.options.logger.log("warn", "cmux command exited unsuccessfully", {
        label,
        args,
        exitCode: result.exitCode,
        signal: result.signal,
        stderr: result.stderr.trim() || undefined,
        stdout: result.stdout.trim() || undefined,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const code =
        typeof error === "object" && error !== null && "code" in error
          ? String((error as { code: unknown }).code)
          : undefined

      if (code === "ENOENT") {
        if (this.reportedMissingBinary) return
        this.reportedMissingBinary = true
      }

      await this.options.logger.log("error", "Failed to execute cmux command", {
        label,
        args,
        code,
        error: message,
      })
    }
  }
}

function shouldUseSocket(
  transport: "cli" | "socket" | "auto",
  env: CmuxEnvironment,
  logger: PluginLogger,
): boolean {
  if (transport === "cli") return false

  if (transport === "socket") {
    if (!env.hasSocket) {
      // User explicitly requested socket but it's not available — warn and fall back
      void logger.log(
        "warn",
        "Socket transport requested but socket not found, falling back to CLI",
        { socketPath: env.socketPath },
      )
      return false
    }
    return true
  }

  // "auto" — use socket if available, silent fallback to CLI
  return env.hasSocket
}

export function createCmuxClient(options: CreateCmuxClientOptions): CmuxClient {
  const useSocket = shouldUseSocket(
    options.transport,
    options.environment,
    options.logger,
  )

  if (useSocket) {
    return new SocketCmuxClient({
      socketPath: options.environment.socketPath,
      workspaceID: options.environment.workspaceID,
      logger: options.logger,
    })
  }

  return new CliCmuxClient(options)
}
