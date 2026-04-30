import { afterAll, describe, expect, test } from "bun:test"
import { createServer } from "node:net"
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { detectCmuxEnvironment } from "../src/cmux/detect.ts"

// Create a temp directory for socket-related tests
const tmpDir = mkdtempSync(join(tmpdir(), "cmux-detect-"))

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

describe("detectCmuxEnvironment", () => {
  test("marks as managed workspace when CMUX_WORKSPACE_ID is set", () => {
    const env = {
      CMUX_WORKSPACE_ID: "workspace:1",
      CMUX_SOCKET_PATH: "/tmp/cmux.sock",
    } as NodeJS.ProcessEnv

    const result = detectCmuxEnvironment(env)

    expect(result.isManagedWorkspace).toBe(true)
    expect(result.workspaceID).toBe("workspace:1")
  })

  test("marks as unmanaged when CMUX_WORKSPACE_ID is absent", () => {
    const env = {} as NodeJS.ProcessEnv

    const result = detectCmuxEnvironment(env)

    expect(result.isManagedWorkspace).toBe(false)
    expect(result.workspaceID).toBeUndefined()
  })

  test("marks as unmanaged when CMUX_WORKSPACE_ID is empty", () => {
    const env = { CMUX_WORKSPACE_ID: "" } as NodeJS.ProcessEnv

    const result = detectCmuxEnvironment(env)

    expect(result.isManagedWorkspace).toBe(false)
    expect(result.workspaceID).toBeUndefined()
  })

  test("marks as unmanaged when CMUX_WORKSPACE_ID is whitespace-only", () => {
    const env = { CMUX_WORKSPACE_ID: "   " } as NodeJS.ProcessEnv

    const result = detectCmuxEnvironment(env)

    expect(result.isManagedWorkspace).toBe(false)
    expect(result.workspaceID).toBeUndefined()
  })

  test("uses a fallback cmux socket path when no socket env is set", () => {
    const env = {} as NodeJS.ProcessEnv

    const result = detectCmuxEnvironment(env)

    expect(result.socketPath.endsWith("cmux.sock")).toBe(true)
  })

  test("uses custom socket path when CMUX_SOCKET_PATH is set", () => {
    const env = {
      CMUX_SOCKET_PATH: "/run/user/1000/cmux.sock",
    } as NodeJS.ProcessEnv

    const result = detectCmuxEnvironment(env)

    expect(result.socketPath).toBe("/run/user/1000/cmux.sock")
  })

  test("uses CMUX_SOCKET as a socket path alias", () => {
    const env = {
      CMUX_SOCKET: "/run/user/1000/cmux-alias.sock",
    } as NodeJS.ProcessEnv

    const result = detectCmuxEnvironment(env)

    expect(result.socketPath).toBe("/run/user/1000/cmux-alias.sock")
  })

  test("prefers CMUX_SOCKET_PATH over CMUX_SOCKET", () => {
    const env = {
      CMUX_SOCKET_PATH: "/explicit/cmux.sock",
      CMUX_SOCKET: "/alias/cmux.sock",
    } as NodeJS.ProcessEnv

    const result = detectCmuxEnvironment(env)

    expect(result.socketPath).toBe("/explicit/cmux.sock")
  })

  test("supports explicit Windows named pipe socket paths", () => {
    const env = {
      CMUX_SOCKET_PATH: "\\\\.\\pipe\\cmux.sock",
    } as NodeJS.ProcessEnv

    const result = detectCmuxEnvironment(env)

    expect(result.socketPath).toBe("\\\\.\\pipe\\cmux.sock")
    expect(result.hasSocket).toBe(true)
  })

  test("reads CMUX_TAB_ID, CMUX_SURFACE_ID, and TERM_PROGRAM", () => {
    const env = {
      CMUX_WORKSPACE_ID: "workspace:1",
      CMUX_TAB_ID: "tab:abc",
      CMUX_SURFACE_ID: "surface:abc",
      TERM_PROGRAM: "cmux",
    } as NodeJS.ProcessEnv

    const result = detectCmuxEnvironment(env)

    expect(result.tabID).toBe("tab:abc")
    expect(result.surfaceID).toBe("surface:abc")
    expect(result.termProgram).toBe("cmux")
  })

  describe("hasSocket", () => {
    test("true when a Unix socket exists at the path", async () => {
      const socketPath = join(tmpDir, "real.sock")
      const server = createServer()

      await new Promise<void>((resolve) => {
        server.listen(socketPath, resolve)
      })

      try {
        const env = { CMUX_SOCKET_PATH: socketPath } as NodeJS.ProcessEnv
        const result = detectCmuxEnvironment(env)
        expect(result.hasSocket).toBe(true)
      } finally {
        server.close()
      }
    })

    test("false when socket path does not exist", () => {
      const env = {
        CMUX_SOCKET_PATH: join(tmpDir, "nonexistent.sock"),
      } as NodeJS.ProcessEnv

      const result = detectCmuxEnvironment(env)

      expect(result.hasSocket).toBe(false)
    })

    test("false when path is a regular file, not a socket", () => {
      const filePath = join(tmpDir, "regular.txt")
      writeFileSync(filePath, "not a socket")

      const env = { CMUX_SOCKET_PATH: filePath } as NodeJS.ProcessEnv
      const result = detectCmuxEnvironment(env)

      expect(result.hasSocket).toBe(false)
    })
  })
})
