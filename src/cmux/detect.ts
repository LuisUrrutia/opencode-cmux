import { statSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"

export interface CmuxEnvironment {
  workspaceID?: string
  tabID?: string
  surfaceID?: string
  socketPath: string
  isManagedWorkspace: boolean
  hasSocket: boolean
  termProgram?: string
}

function normalize(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function checkSocketExists(socketPath: string): boolean {
  if (socketPath.startsWith("\\\\.\\pipe\\")) return true

  try {
    const stat = statSync(socketPath)
    return stat.isSocket()
  } catch {
    return false
  }
}

function socketCandidates(env: NodeJS.ProcessEnv): string[] {
  const candidates = [
    env.XDG_RUNTIME_DIR ? join(env.XDG_RUNTIME_DIR, "cmux.sock") : undefined,
    join(homedir(), "Library", "Application Support", "cmux", "cmux.sock"),
    join(homedir(), ".local", "share", "cmux", "cmux.sock"),
    join(tmpdir(), "cmux.sock"),
    "/tmp/cmux.sock",
  ]

  return [...new Set(candidates.filter((candidate): candidate is string => !!candidate))]
}

function resolveSocketPath(env: NodeJS.ProcessEnv): string {
  const explicit = normalize(env.CMUX_SOCKET_PATH) ?? normalize(env.CMUX_SOCKET)
  if (explicit) return explicit

  const candidates = socketCandidates(env)
  return candidates.find(checkSocketExists) ?? candidates[0] ?? "/tmp/cmux.sock"
}

export function detectCmuxEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): CmuxEnvironment {
  const socketPath = resolveSocketPath(env)
  const workspaceID = normalize(env.CMUX_WORKSPACE_ID)
  const tabID = normalize(env.CMUX_TAB_ID)
  const surfaceID = normalize(env.CMUX_SURFACE_ID)

  return {
    workspaceID,
    tabID,
    surfaceID,
    socketPath,
    isManagedWorkspace: workspaceID !== undefined,
    hasSocket: checkSocketExists(socketPath),
    termProgram: normalize(env.TERM_PROGRAM),
  }
}
