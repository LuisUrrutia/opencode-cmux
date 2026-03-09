import { describe, expect, test } from "bun:test"
import { createCmuxClient } from "../src/cmux/client.ts"
import type { CmuxEnvironment } from "../src/cmux/detect.ts"
import type { PluginLogger } from "../src/types.ts"

function makeLogger(): PluginLogger & { messages: Array<{ level: string; message: string }> } {
  const messages: Array<{ level: string; message: string }> = []
  return {
    messages,
    async log(level, message) {
      messages.push({ level, message })
    },
  }
}

function makeEnvironment(overrides: Partial<CmuxEnvironment> = {}): CmuxEnvironment {
  return {
    socketPath: "/tmp/cmux.sock",
    isManagedWorkspace: true,
    hasSocket: false,
    workspaceID: "C741C8F0-DD75-4BF2-83BF-2CC032234753",
    ...overrides,
  }
}

describe("createCmuxClient", () => {
  describe("transport = 'auto'", () => {
    test("selects socket when hasSocket is true", () => {
      const logger = makeLogger()
      const client = createCmuxClient({
        binary: "cmux",
        environment: makeEnvironment({ hasSocket: true }),
        logger,
        transport: "auto",
      })

      expect(client.transport).toBe("socket")
    })

    test("selects cli when hasSocket is false", () => {
      const logger = makeLogger()
      const client = createCmuxClient({
        binary: "cmux",
        environment: makeEnvironment({ hasSocket: false }),
        logger,
        transport: "auto",
      })

      expect(client.transport).toBe("cli")
    })

    test("does not log when falling back to cli silently", () => {
      const logger = makeLogger()
      createCmuxClient({
        binary: "cmux",
        environment: makeEnvironment({ hasSocket: false }),
        logger,
        transport: "auto",
      })

      expect(logger.messages).toHaveLength(0)
    })
  })

  describe("transport = 'cli'", () => {
    test("selects cli even when hasSocket is true", () => {
      const logger = makeLogger()
      const client = createCmuxClient({
        binary: "cmux",
        environment: makeEnvironment({ hasSocket: true }),
        logger,
        transport: "cli",
      })

      expect(client.transport).toBe("cli")
    })
  })

  describe("transport = 'socket'", () => {
    test("selects socket when hasSocket is true", () => {
      const logger = makeLogger()
      const client = createCmuxClient({
        binary: "cmux",
        environment: makeEnvironment({ hasSocket: true }),
        logger,
        transport: "socket",
      })

      expect(client.transport).toBe("socket")
    })

    test("falls back to cli with warning when hasSocket is false", () => {
      const logger = makeLogger()
      const client = createCmuxClient({
        binary: "cmux",
        environment: makeEnvironment({ hasSocket: false }),
        logger,
        transport: "socket",
      })

      expect(client.transport).toBe("cli")
      expect(logger.messages).toHaveLength(1)
      expect(logger.messages[0].level).toBe("warn")
      expect(logger.messages[0].message).toContain("falling back to CLI")
    })
  })

  test("passes workspaceID through to the client", () => {
    const logger = makeLogger()
    const wsID = "C741C8F0-DD75-4BF2-83BF-2CC032234753"

    const cliClient = createCmuxClient({
      binary: "cmux",
      environment: makeEnvironment({ workspaceID: wsID }),
      logger,
      transport: "cli",
    })
    expect(cliClient.workspaceID).toBe(wsID)

    const socketClient = createCmuxClient({
      binary: "cmux",
      environment: makeEnvironment({ hasSocket: true, workspaceID: wsID }),
      logger,
      transport: "socket",
    })
    expect(socketClient.workspaceID).toBe(wsID)
  })

  test("marks client as available when in managed workspace", () => {
    const logger = makeLogger()

    const client = createCmuxClient({
      binary: "cmux",
      environment: makeEnvironment({ isManagedWorkspace: true }),
      logger,
      transport: "cli",
    })

    expect(client.available).toBe(true)
  })

  test("marks cli client as unavailable when not in managed workspace", () => {
    const logger = makeLogger()

    const client = createCmuxClient({
      binary: "cmux",
      environment: makeEnvironment({ isManagedWorkspace: false, workspaceID: undefined }),
      logger,
      transport: "cli",
    })

    expect(client.available).toBe(false)
  })
})
