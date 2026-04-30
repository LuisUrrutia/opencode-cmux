import { describe, expect, test, afterEach } from "bun:test"
import { createServer, type Server } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { unlinkSync } from "node:fs"
import { SocketCmuxClient, socketRequest, socketWrite } from "../src/cmux/socket-client.ts"
import type { PluginLogger } from "../src/types.ts"

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

interface TestServer {
  server: Server
  socketPath: string
  close: () => Promise<void>
}

let testServers: TestServer[] = []

afterEach(async () => {
  for (const ts of testServers) {
    await ts.close()
  }
  testServers = []
})

/**
 * Create a Unix socket server that reads a newline-terminated message from
 * each client, passes it to the handler, and writes the response back.
 * The server closes its end of the connection after responding (matching
 * cmux's connect-per-call behavior).
 */
function createTestServer(
  handler: (data: string) => string,
): Promise<TestServer> {
  return new Promise((resolve, reject) => {
    const socketPath = join(
      tmpdir(),
      `cmux-test-${Date.now()}-${Math.random().toString(36).slice(2)}.sock`,
    )

    const sockets = new Set<Parameters<Parameters<typeof createServer>[0]>[0]>()
    const server = createServer((socket) => {
      sockets.add(socket)
      socket.on("close", () => sockets.delete(socket))
      socket.on("data", (chunk) => {
        const response = handler(chunk.toString())
        socket.end(response)
      })
    })

    server.on("error", reject)
    server.listen(socketPath, () => {
      const ts: TestServer = {
        server,
        socketPath,
        close: () =>
          new Promise<void>((res) => {
            for (const socket of sockets) socket.destroy()
            server.close(() => {
              try {
                unlinkSync(socketPath)
              } catch {}
              res()
            })
          }),
      }
      testServers.push(ts)
      resolve(ts)
    })
  })
}

async function waitFor(assertion: () => void): Promise<void> {
  const deadline = Date.now() + 500
  let lastError: unknown

  while (Date.now() < deadline) {
    try {
      assertion()
      return
    } catch (error) {
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
  }

  if (lastError) throw lastError
  assertion()
}

function createTestLogger(): PluginLogger & {
  calls: Array<{ level: string; message: string; extra?: Record<string, unknown> }>
} {
  const calls: Array<{ level: string; message: string; extra?: Record<string, unknown> }> = []
  return {
    calls,
    async log(level, message, extra) {
      calls.push({ level, message, extra })
    },
  }
}

// ---------------------------------------------------------------------------
// socketRequest (low-level)
// ---------------------------------------------------------------------------

describe("socketRequest", () => {
  test("sends payload and receives response", async () => {
    const ts = await createTestServer((data) => {
      return `echo: ${data.trim()}`
    })

    const outcome = await socketRequest({
      socketPath: ts.socketPath,
      payload: "hello\n",
      timeoutMs: 5000,
    })

    expect(outcome.error).toBeUndefined()
    expect(outcome.response).toBe("echo: hello")
  })

  test("returns SocketError on ENOENT (no socket file)", async () => {
    const outcome = await socketRequest({
      socketPath: "/tmp/nonexistent-cmux-test.sock",
      payload: "hello\n",
      timeoutMs: 5000,
    })

    expect(outcome.error).toBeDefined()
    expect(outcome.error!.code).toBe("ENOENT")
  })

  test("returns SocketError on timeout", async () => {
    // Create a server that never responds (doesn't end the connection)
    const socketPath = join(
      tmpdir(),
      `cmux-test-hang-${Date.now()}.sock`,
    )
    const server = createServer((_socket) => {
      // Intentionally do nothing — hold the connection open
    })

    await new Promise<void>((resolve, reject) => {
      server.on("error", reject)
      server.listen(socketPath, resolve)
    })

    const ts: TestServer = {
      server,
      socketPath,
      close: () =>
        new Promise<void>((res) => {
          server.close(() => {
            try { unlinkSync(socketPath) } catch {}
            res()
          })
        }),
    }
    testServers.push(ts)

    const outcome = await socketRequest({
      socketPath,
      payload: "hello\n",
      timeoutMs: 100, // Short timeout
    })

    expect(outcome.error).toBeDefined()
    expect(outcome.error!.code).toBe("ETIMEDOUT")
  })

  test("never rejects (returns error outcome instead)", async () => {
    // Even with a bad path, should resolve not reject
    const outcome = await socketRequest({
      socketPath: "/tmp/definitely-not-a-real-socket.sock",
      payload: "test\n",
      timeoutMs: 1000,
    })

    // Should have resolved (not thrown)
    expect(outcome.error).toBeDefined()
  })
})

describe("socketWrite", () => {
  test("resolves after writing without waiting for a response", async () => {
    let resolveReceived!: () => void
    const receivedPromise = new Promise<void>((resolve) => {
      resolveReceived = resolve
    })
    let received = ""
    const socketPath = join(
      tmpdir(),
      `cmux-test-write-${Date.now()}.sock`,
    )
    const server = createServer((socket) => {
      socket.on("data", (chunk) => {
        received += chunk.toString()
        resolveReceived()
        socket.destroy()
      })
    })

    await new Promise<void>((resolve, reject) => {
      server.on("error", reject)
      server.listen(socketPath, resolve)
    })

    const ts: TestServer = {
      server,
      socketPath,
      close: () =>
        new Promise<void>((res) => {
          server.close(() => {
            try { unlinkSync(socketPath) } catch {}
            res()
          })
        }),
    }
    testServers.push(ts)

    const startedAt = Date.now()
    const outcome = await socketWrite({
      socketPath,
      payload: "clear_notifications --tab=workspace\n",
      timeoutMs: 1000,
    })

    expect(outcome.error).toBeUndefined()
    expect(Date.now() - startedAt).toBeLessThan(500)
    await receivedPromise
    expect(received).toBe("clear_notifications --tab=workspace\n")
  })
})

// ---------------------------------------------------------------------------
// SocketCmuxClient
// ---------------------------------------------------------------------------

describe("SocketCmuxClient", () => {
  const workspaceID = "C741C8F0-DD75-4BF2-83BF-2CC032234753"

  test("has transport: 'socket' property", () => {
    const logger = createTestLogger()
    const client = new SocketCmuxClient({
      socketPath: "/tmp/fake.sock",
      logger,
    })
    expect(client.transport).toBe("socket")
  })

  test("has available: true property", () => {
    const logger = createTestLogger()
    const client = new SocketCmuxClient({
      socketPath: "/tmp/fake.sock",
      logger,
    })
    expect(client.available).toBe(true)
  })

  describe("clearNotifications and reportGitBranch", () => {
    test("send text commands to the socket", async () => {
      let received = ""
      const ts = await createTestServer((data) => {
        received = data
        return "OK"
      })

      const logger = createTestLogger()
      const client = new SocketCmuxClient({
        socketPath: ts.socketPath,
        workspaceID,
        logger,
      })

      await client.clearNotifications()
      await waitFor(() => {
        expect(received.trim()).toBe(`clear_notifications --tab=${workspaceID}`)
      })

      received = ""
      await client.reportGitBranch("main", true)
      await waitFor(() => {
        expect(received.trim()).toBe(
          `report_git_branch main --status=dirty --tab=${workspaceID}`,
        )
      })
    })
  })

  describe("notify (JSON-RPC)", () => {
    test("sends JSON-RPC to server and receives ok:true response", async () => {
      let receivedData = ""
      const ts = await createTestServer((data) => {
        receivedData = data
        return JSON.stringify({ id: "req-1", ok: true, result: {} })
      })

      const logger = createTestLogger()
      const client = new SocketCmuxClient({
        socketPath: ts.socketPath,
        workspaceID,
        logger,
      })

      await client.notify({ title: "Build Done", body: "All tests passed" })

      const parsed = JSON.parse(receivedData.trim())
      expect(parsed.method).toBe("notification.create")
      expect(parsed.params.title).toBe("Build Done")
      expect(parsed.params.body).toBe("All tests passed")
      expect(logger.calls).toHaveLength(0) // No warnings
    })

    test("uses JSON-RPC with workspace and surface when both are available", async () => {
      let receivedData = ""
      const ts = await createTestServer((data) => {
        receivedData = data
        return JSON.stringify({ id: "req-1", ok: true, result: {} })
      })

      const logger = createTestLogger()
      const client = new SocketCmuxClient({
        socketPath: ts.socketPath,
        workspaceID,
        surfaceID: "surface-456",
        logger,
      })

      await client.notify({
        title: "Build Done",
        subtitle: "opencode",
        body: "All tests passed",
      })

      const parsed = JSON.parse(receivedData.trim())
      expect(parsed.method).toBe("notification.create")
      expect(parsed.params).toEqual({
        title: "Build Done",
        subtitle: "opencode",
        body: "All tests passed",
        workspace_id: workspaceID,
        surface_id: "surface-456",
      })
    })

    test("includes workspace_id in JSON-RPC params when client has workspaceID", async () => {
      let receivedData = ""
      const ts = await createTestServer((data) => {
        receivedData = data
        return JSON.stringify({ id: "req-1", ok: true, result: {} })
      })

      const logger = createTestLogger()
      const client = new SocketCmuxClient({
        socketPath: ts.socketPath,
        workspaceID,
        logger,
      })

      await client.notify({ title: "Test", body: "workspace check" })

      const parsed = JSON.parse(receivedData.trim())
      expect(parsed.params.workspace_id).toBe(workspaceID)
      expect(parsed.params.title).toBe("Test")
      expect(parsed.params.surface_id).toBeUndefined()
    })

    test("omits workspace_id when client has no workspaceID", async () => {
      let receivedData = ""
      const ts = await createTestServer((data) => {
        receivedData = data
        return JSON.stringify({ id: "req-1", ok: true, result: {} })
      })

      const logger = createTestLogger()
      const client = new SocketCmuxClient({
        socketPath: ts.socketPath,
        surfaceID: "surface-456",
        logger,
      })

      await client.notify({ title: "Test" })

      const parsed = JSON.parse(receivedData.trim())
      expect("workspace_id" in parsed.params).toBe(false)
      expect(parsed.params.surface_id).toBe("surface-456")
    })

    test("logs warning on ok:false response", async () => {
      const ts = await createTestServer(() => {
        return JSON.stringify({ id: "req-1", ok: false, error: "rate limited" })
      })

      const logger = createTestLogger()
      const client = new SocketCmuxClient({
        socketPath: ts.socketPath,
        logger,
      })

      await client.notify({ title: "Test" })

      expect(logger.calls.length).toBeGreaterThanOrEqual(1)
      const warnCall = logger.calls.find((c) => c.level === "warn")
      expect(warnCall).toBeDefined()
      expect(warnCall!.message).toContain("notify")
      expect(warnCall!.message).toContain("error")
    })

    test("increments request IDs for JSON-RPC calls", async () => {
      const receivedIDs: string[] = []
      const ts = await createTestServer((data) => {
        const parsed = JSON.parse(data.trim())
        receivedIDs.push(parsed.id)
        return JSON.stringify({ id: parsed.id, ok: true, result: {} })
      })

      const logger = createTestLogger()
      const client = new SocketCmuxClient({
        socketPath: ts.socketPath,
        logger,
      })

      await client.notify({ title: "First" })
      await client.notify({ title: "Second" })
      await client.notify({ title: "Third" })

      expect(receivedIDs).toEqual(["req-1", "req-2", "req-3"])
    })
  })

  describe("setStatus (text format)", () => {
    test("sends correct text format", async () => {
      let receivedData = ""
      const ts = await createTestServer((data) => {
        receivedData = data
        return "OK"
      })

      const logger = createTestLogger()
      const client = new SocketCmuxClient({
        socketPath: ts.socketPath,
        workspaceID,
        logger,
      })

      await client.setStatus("build", {
        text: "compiling",
        icon: "hammer",
        color: "#ff9500",
      })

      await waitFor(() => {
        expect(receivedData).toBe(
          `set_status build compiling --icon=hammer --color=#ff9500 --tab=${workspaceID}\n`,
        )
      })
    })

    test("uses tabID for sidebar text commands when provided", async () => {
      let receivedData = ""
      const ts = await createTestServer((data) => {
        receivedData = data
        return "OK"
      })

      const logger = createTestLogger()
      const client = new SocketCmuxClient({
        socketPath: ts.socketPath,
        workspaceID,
        tabID: "tab-456",
        logger,
      })

      await client.setStatus("build", {
        text: "compiling",
        icon: "hammer",
        color: "#ff9500",
      })

      await waitFor(() => {
        expect(receivedData).toBe(
          "set_status build compiling --icon=hammer --color=#ff9500 --tab=tab-456\n",
        )
      })
    })
  })

  describe("setProgress (text format)", () => {
    test("sends correct text format", async () => {
      let receivedData = ""
      const ts = await createTestServer((data) => {
        receivedData = data
        return "OK"
      })

      const logger = createTestLogger()
      const client = new SocketCmuxClient({
        socketPath: ts.socketPath,
        workspaceID,
        logger,
      })

      await client.setProgress({ value: 0.75, label: "Building..." })

      await waitFor(() => {
        expect(receivedData).toBe(
          `set_progress 0.75 --label=Building... --tab=${workspaceID}\n`,
        )
      })
    })
  })

  describe("log (text format)", () => {
    test("sends correct text format", async () => {
      let receivedData = ""
      const ts = await createTestServer((data) => {
        receivedData = data
        return "OK"
      })

      const logger = createTestLogger()
      const client = new SocketCmuxClient({
        socketPath: ts.socketPath,
        workspaceID,
        logger,
      })

      await client.log({
        level: "error",
        source: "build",
        message: "Compilation failed",
      })

      await waitFor(() => {
        expect(receivedData).toBe(
          `log --level=error --source=build --tab=${workspaceID} -- "Compilation failed"\n`,
        )
      })
    })
  })

  describe("clearStatus (text format)", () => {
    test("sends correct text format", async () => {
      let receivedData = ""
      const ts = await createTestServer((data) => {
        receivedData = data
        return "OK"
      })

      const logger = createTestLogger()
      const client = new SocketCmuxClient({
        socketPath: ts.socketPath,
        workspaceID,
        logger,
      })

      await client.clearStatus("build")

      await waitFor(() => {
        expect(receivedData).toBe(
          `clear_status build --tab=${workspaceID}\n`,
        )
      })
    })
  })

  describe("clearProgress (text format)", () => {
    test("sends correct text format", async () => {
      let receivedData = ""
      const ts = await createTestServer((data) => {
        receivedData = data
        return "OK"
      })

      const logger = createTestLogger()
      const client = new SocketCmuxClient({
        socketPath: ts.socketPath,
        workspaceID,
        logger,
      })

      await client.clearProgress()

      await waitFor(() => {
        expect(receivedData).toBe(
          `clear_progress --tab=${workspaceID}\n`,
        )
      })
    })
  })

  describe("error handling", () => {
    test("handles ENOENT gracefully (no throw)", async () => {
      const logger = createTestLogger()
      const client = new SocketCmuxClient({
        socketPath: "/tmp/nonexistent-cmux-test.sock",
        logger,
      })

      // Should not throw
      await client.setStatus("test", {
        text: "hello",
        icon: "star",
        color: "#fff",
      })

      expect(logger.calls.length).toBeGreaterThanOrEqual(1)
    })

    test("logs connection failure only once for repeated calls", async () => {
      const logger = createTestLogger()
      const client = new SocketCmuxClient({
        socketPath: "/tmp/nonexistent-cmux-test.sock",
        logger,
      })

      await client.setStatus("a", { text: "t", icon: "i", color: "c" })
      await client.setStatus("b", { text: "t", icon: "i", color: "c" })
      await client.setStatus("c", { text: "t", icon: "i", color: "c" })

      // Only one error log for the connection failure (ENOENT logged once)
      const errorCalls = logger.calls.filter((c) => c.level === "error")
      expect(errorCalls).toHaveLength(1)
    })

    test("handles timeout gracefully (no throw)", async () => {
      // Create a server that never responds
      const socketPath = join(
        tmpdir(),
        `cmux-test-hang-${Date.now()}.sock`,
      )
      const sockets = new Set<Parameters<Parameters<typeof createServer>[0]>[0]>()
      const server = createServer((socket) => {
        sockets.add(socket)
        socket.on("close", () => sockets.delete(socket))
        // Hold connection open
      })

      await new Promise<void>((resolve, reject) => {
        server.on("error", reject)
        server.listen(socketPath, resolve)
      })

      const ts: TestServer = {
        server,
        socketPath,
        close: () =>
          new Promise<void>((res) => {
            for (const socket of sockets) socket.destroy()
            server.close(() => {
              try { unlinkSync(socketPath) } catch {}
              res()
            })
          }),
      }
      testServers.push(ts)

      const logger = createTestLogger()
      const client = new SocketCmuxClient({
        socketPath,
        logger,
        timeoutMs: 100,
      })

      // Should not throw
      await client.notify({ title: "hello" })

      const errorCalls = logger.calls.filter((c) => c.level === "error")
      expect(errorCalls.length).toBeGreaterThanOrEqual(1)
      expect(errorCalls[0].extra?.code).toBe("ETIMEDOUT")
    })

    test("does not disable text commands after a response timeout", async () => {
      const socketPath = join(
        tmpdir(),
        `cmux-test-retry-${Date.now()}.sock`,
      )
      let requestCount = 0
      const received: string[] = []
      const sockets = new Set<Parameters<Parameters<typeof createServer>[0]>[0]>()
      const server = createServer((socket) => {
        sockets.add(socket)
        socket.on("close", () => sockets.delete(socket))
        socket.on("data", (chunk) => {
          requestCount += 1
          received.push(chunk.toString())
          if (requestCount > 1) socket.end("OK")
        })
      })

      await new Promise<void>((resolve, reject) => {
        server.on("error", reject)
        server.listen(socketPath, resolve)
      })

      const ts: TestServer = {
        server,
        socketPath,
        close: () =>
          new Promise<void>((res) => {
            for (const socket of sockets) socket.destroy()
            server.close(() => {
              try { unlinkSync(socketPath) } catch {}
              res()
            })
          }),
      }
      testServers.push(ts)

      const logger = createTestLogger()
      const client = new SocketCmuxClient({
        socketPath,
        logger,
        timeoutMs: 100,
      })

      await client.notify({ title: "will timeout" })
      await client.setStatus("test", {
        text: "working",
        icon: "terminal",
        color: "#fff",
      })

      await waitFor(() => {
        expect(received).toHaveLength(2)
        expect(received[1]).toContain("set_status test working")
      })
    })
  })
})
