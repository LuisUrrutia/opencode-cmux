import { describe, expect, test } from "bun:test"
import {
  // CLI builders
  buildNotifyCommand,
  buildSetStatusCommand,
  buildClearStatusCommand,
  buildSetProgressCommand,
  buildClearProgressCommand,
  buildLogCommand,
  // Socket text-format builders
  buildSocketSetStatus,
  buildSocketClearStatus,
  buildSocketSetProgress,
  buildSocketClearProgress,
  buildSocketLog,
  // Socket JSON-RPC builders
  buildJsonRpc,
  buildSocketNotify,
  // Response parser
  parseCmuxResponse,
} from "../src/cmux/commands.ts"

// ---------------------------------------------------------------------------
// CLI command builders (regression tests)
// ---------------------------------------------------------------------------

describe("CLI command builders", () => {
  test("buildNotifyCommand with title only", () => {
    const result = buildNotifyCommand({ title: "Build done" })
    expect(result).toEqual(["notify", "--title", "Build done"])
  })

  test("buildNotifyCommand with all fields", () => {
    const result = buildNotifyCommand({
      title: "Build done",
      subtitle: "opencode",
      body: "All tests passed",
    })
    expect(result).toEqual([
      "notify",
      "--title",
      "Build done",
      "--subtitle",
      "opencode",
      "--body",
      "All tests passed",
    ])
  })

  test("buildSetStatusCommand with workspace", () => {
    const result = buildSetStatusCommand(
      "build",
      { text: "compiling", icon: "hammer", color: "#ff9500" },
      "ws-123",
    )
    expect(result).toEqual([
      "set-status",
      "build",
      "compiling",
      "--icon",
      "hammer",
      "--color",
      "#ff9500",
      "--workspace",
      "ws-123",
    ])
  })

  test("buildSetStatusCommand without workspace", () => {
    const result = buildSetStatusCommand("build", {
      text: "compiling",
      icon: "hammer",
      color: "#ff9500",
    })
    expect(result).toEqual([
      "set-status",
      "build",
      "compiling",
      "--icon",
      "hammer",
      "--color",
      "#ff9500",
    ])
  })

  test("buildClearStatusCommand with workspace", () => {
    const result = buildClearStatusCommand("build", "ws-123")
    expect(result).toEqual(["clear-status", "build", "--workspace", "ws-123"])
  })

  test("buildSetProgressCommand with workspace", () => {
    const result = buildSetProgressCommand(
      { value: 0.5, label: "Building..." },
      "ws-123",
    )
    expect(result).toEqual([
      "set-progress",
      "0.50",
      "--label",
      "Building...",
      "--workspace",
      "ws-123",
    ])
  })

  test("buildClearProgressCommand with workspace", () => {
    const result = buildClearProgressCommand("ws-123")
    expect(result).toEqual(["clear-progress", "--workspace", "ws-123"])
  })

  test("buildLogCommand with workspace", () => {
    const result = buildLogCommand(
      { level: "error", source: "build", message: "Compilation failed" },
      "ws-123",
    )
    expect(result).toEqual([
      "log",
      "--level",
      "error",
      "--source",
      "build",
      "--",
      "Compilation failed",
      "--workspace",
      "ws-123",
    ])
  })
})

// ---------------------------------------------------------------------------
// Socket text-format builders
// ---------------------------------------------------------------------------

describe("Socket text-format builders", () => {
  const workspaceID = "C741C8F0-DD75-4BF2-83BF-2CC032234753"

  describe("buildSocketSetStatus", () => {
    test("produces correct format with icon, color, and tab", () => {
      const result = buildSocketSetStatus(
        "build",
        { text: "compiling", icon: "hammer", color: "#ff9500" },
        workspaceID,
      )
      expect(result).toBe(
        `set_status build compiling --icon=hammer --color=#ff9500 --tab=${workspaceID}\n`,
      )
    })

    test("omits --tab= when workspaceID is undefined", () => {
      const result = buildSocketSetStatus("build", {
        text: "compiling",
        icon: "hammer",
        color: "#ff9500",
      })
      expect(result).toBe(
        "set_status build compiling --icon=hammer --color=#ff9500\n",
      )
    })

    test("is newline-terminated", () => {
      const result = buildSocketSetStatus("build", {
        text: "done",
        icon: "check",
        color: "#00ff00",
      })
      expect(result.endsWith("\n")).toBe(true)
    })
  })

  describe("buildSocketClearStatus", () => {
    test("produces correct format with tab", () => {
      const result = buildSocketClearStatus("build", workspaceID)
      expect(result).toBe(`clear_status build --tab=${workspaceID}\n`)
    })

    test("omits --tab= when workspaceID is undefined", () => {
      const result = buildSocketClearStatus("build")
      expect(result).toBe("clear_status build\n")
    })
  })

  describe("buildSocketSetProgress", () => {
    test("formats value to 2 decimal places", () => {
      const result = buildSocketSetProgress(
        { value: 0.5, label: "Building..." },
        workspaceID,
      )
      expect(result).toBe(
        `set_progress 0.50 --label=Building... --tab=${workspaceID}\n`,
      )
    })

    test("formats precise values correctly", () => {
      const result = buildSocketSetProgress(
        { value: 0.333, label: "Working" },
        workspaceID,
      )
      expect(result).toContain("0.33")
    })

    test("omits --tab= when workspaceID is undefined", () => {
      const result = buildSocketSetProgress({
        value: 0.75,
        label: "Almost done",
      })
      expect(result).toBe("set_progress 0.75 --label=Almost done\n")
    })
  })

  describe("buildSocketClearProgress", () => {
    test("produces correct format with tab", () => {
      const result = buildSocketClearProgress(workspaceID)
      expect(result).toBe(`clear_progress --tab=${workspaceID}\n`)
    })

    test("omits --tab= when workspaceID is undefined", () => {
      const result = buildSocketClearProgress()
      expect(result).toBe("clear_progress\n")
    })
  })

  describe("buildSocketLog", () => {
    test("produces correct format with -- separator for message", () => {
      const result = buildSocketLog(
        { level: "error", source: "build", message: "Compilation failed" },
        workspaceID,
      )
      expect(result).toBe(
        `log --level=error --source=build --tab=${workspaceID} -- Compilation failed\n`,
      )
    })

    test("handles messages with special characters", () => {
      const result = buildSocketLog(
        {
          level: "info",
          source: "test",
          message: 'File "main.ts" has 3 errors & 2 warnings',
        },
        workspaceID,
      )
      expect(result).toContain(
        '-- File "main.ts" has 3 errors & 2 warnings',
      )
    })

    test("omits --tab= when workspaceID is undefined", () => {
      const result = buildSocketLog({
        level: "info",
        source: "test",
        message: "Hello",
      })
      expect(result).toBe("log --level=info --source=test -- Hello\n")
    })
  })

  test("all socket text builders produce newline-terminated strings", () => {
    const builders = [
      buildSocketSetStatus("k", { text: "t", icon: "i", color: "c" }),
      buildSocketClearStatus("k"),
      buildSocketSetProgress({ value: 0.5, label: "l" }),
      buildSocketClearProgress(),
      buildSocketLog({ level: "info", source: "s", message: "m" }),
    ]
    for (const result of builders) {
      expect(result.endsWith("\n")).toBe(true)
      // Should have exactly one trailing newline
      expect(result.endsWith("\n\n")).toBe(false)
    }
  })
})

// ---------------------------------------------------------------------------
// Socket JSON-RPC builders
// ---------------------------------------------------------------------------

describe("Socket JSON-RPC builders", () => {
  describe("buildJsonRpc", () => {
    test("produces valid JSON-RPC structure", () => {
      const result = buildJsonRpc(
        "system.ping",
        {},
        "req-1",
      )
      const parsed = JSON.parse(result.trim())
      expect(parsed).toEqual({
        id: "req-1",
        method: "system.ping",
        params: {},
      })
    })

    test("strips undefined param values", () => {
      const result = buildJsonRpc(
        "notification.create",
        { title: "Hello", subtitle: undefined, body: "World" },
        "req-2",
      )
      const parsed = JSON.parse(result.trim())
      expect(parsed.params).toEqual({ title: "Hello", body: "World" })
      expect("subtitle" in parsed.params).toBe(false)
    })

    test("preserves null param values", () => {
      const result = buildJsonRpc(
        "test.method",
        { value: null },
        "req-3",
      )
      const parsed = JSON.parse(result.trim())
      expect(parsed.params).toEqual({ value: null })
    })

    test("is newline-terminated", () => {
      const result = buildJsonRpc("test.method", {}, "req-1")
      expect(result.endsWith("\n")).toBe(true)
    })
  })

  describe("buildSocketNotify", () => {
    test("produces valid JSON-RPC with all fields", () => {
      const result = buildSocketNotify(
        { title: "Build Done", subtitle: "opencode", body: "All tests passed" },
        "req-5",
      )
      const parsed = JSON.parse(result.trim())
      expect(parsed).toEqual({
        id: "req-5",
        method: "notification.create",
        params: {
          title: "Build Done",
          subtitle: "opencode",
          body: "All tests passed",
        },
      })
    })

    test("omits undefined optional fields", () => {
      const result = buildSocketNotify(
        { title: "Build Done" },
        "req-6",
      )
      const parsed = JSON.parse(result.trim())
      expect(parsed.params).toEqual({ title: "Build Done" })
      expect("subtitle" in parsed.params).toBe(false)
      expect("body" in parsed.params).toBe(false)
    })

    test("is newline-terminated", () => {
      const result = buildSocketNotify({ title: "Test" }, "req-7")
      expect(result.endsWith("\n")).toBe(true)
    })
  })
})

// ---------------------------------------------------------------------------
// Response parser
// ---------------------------------------------------------------------------

describe("parseCmuxResponse", () => {
  test("parses valid ok:true response", () => {
    const raw = '{"id":"req-1","ok":true,"result":{"pong":true}}'
    const result = parseCmuxResponse(raw)
    expect(result).toEqual({
      id: "req-1",
      ok: true,
      result: { pong: true },
    })
  })

  test("parses valid ok:false response", () => {
    const raw = '{"id":"req-2","ok":false,"error":"not found"}'
    const result = parseCmuxResponse(raw)
    expect(result).toEqual({
      id: "req-2",
      ok: false,
      error: "not found",
    })
  })

  test("parses response with extra whitespace", () => {
    const raw = '  {"id":"req-3","ok":true,"result":{}}  \n'
    const result = parseCmuxResponse(raw)
    expect(result).not.toBeNull()
    expect(result!.ok).toBe(true)
  })

  test("returns null for empty string", () => {
    expect(parseCmuxResponse("")).toBeNull()
  })

  test("returns null for whitespace-only string", () => {
    expect(parseCmuxResponse("   \n  ")).toBeNull()
  })

  test("returns null for non-JSON text like OK", () => {
    expect(parseCmuxResponse("OK")).toBeNull()
  })

  test("returns null for non-JSON text with newline", () => {
    expect(parseCmuxResponse("OK\n")).toBeNull()
  })

  test("returns null for malformed JSON", () => {
    expect(parseCmuxResponse("{invalid json}")).toBeNull()
  })

  test("returns null for JSON without ok field", () => {
    expect(parseCmuxResponse('{"id":"req-1","result":"hi"}')).toBeNull()
  })

  test("returns null for JSON array", () => {
    expect(parseCmuxResponse("[1,2,3]")).toBeNull()
  })
})
