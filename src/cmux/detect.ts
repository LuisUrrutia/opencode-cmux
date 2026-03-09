import { existsSync } from "node:fs"

export interface CmuxEnvironment {
  workspaceID?: string
  surfaceID?: string
  socketPath: string
  hasSocket: boolean
  isManagedWorkspace: boolean
  termProgram?: string
}

function normalize(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

export function detectCmuxEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): CmuxEnvironment {
  const socketPath = normalize(env.CMUX_SOCKET_PATH) ?? "/tmp/cmux.sock"
  const workspaceID = normalize(env.CMUX_WORKSPACE_ID)
  const surfaceID = normalize(env.CMUX_SURFACE_ID)

  return {
    workspaceID,
    surfaceID,
    socketPath,
    hasSocket: existsSync(socketPath),
    isManagedWorkspace: workspaceID !== undefined,
    termProgram: normalize(env.TERM_PROGRAM),
  }
}
