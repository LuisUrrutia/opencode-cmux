import { describe, expect, test } from "bun:test"
import { detectCmuxEnvironment } from "../src/cmux/detect.ts"

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

  test("defaults socket path to /tmp/cmux.sock", () => {
    const env = {} as NodeJS.ProcessEnv

    const result = detectCmuxEnvironment(env)

    expect(result.socketPath).toBe("/tmp/cmux.sock")
  })

  test("uses custom socket path when CMUX_SOCKET_PATH is set", () => {
    const env = {
      CMUX_SOCKET_PATH: "/run/user/1000/cmux.sock",
    } as NodeJS.ProcessEnv

    const result = detectCmuxEnvironment(env)

    expect(result.socketPath).toBe("/run/user/1000/cmux.sock")
  })

  test("reads CMUX_SURFACE_ID and TERM_PROGRAM", () => {
    const env = {
      CMUX_WORKSPACE_ID: "workspace:1",
      CMUX_SURFACE_ID: "surface:abc",
      TERM_PROGRAM: "cmux",
    } as NodeJS.ProcessEnv

    const result = detectCmuxEnvironment(env)

    expect(result.surfaceID).toBe("surface:abc")
    expect(result.termProgram).toBe("cmux")
  })
})
