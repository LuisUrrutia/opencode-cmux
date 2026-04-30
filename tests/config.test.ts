import { describe, expect, test } from "bun:test"
import { loadConfig } from "../src/config.ts"

describe("loadConfig", () => {
  test("applies defaults", () => {
    const config = loadConfig({})

    expect(config.cmuxBin).toBe("cmux")
    expect(config.statusKey).toBe("opencode")
    expect(config.notifySubagents).toBe(false)
    expect(config.logSubagents).toBe(true)
    expect(config.progressEnabled).toBe(true)
    expect(config.keepDoneStatus).toBe(true)
    expect(config.notifyQuestions).toBe(true)
    expect(config.notifyPermissions).toBe(true)
    expect(config.logToolCalls).toBe(true)
    expect(config.logToolCallsVerbose).toBe(false)
    expect(config.logFileEdits).toBe(true)
    expect(config.logSessionLifecycle).toBe(true)
    expect(config.logTodos).toBe(true)
    expect(config.gitIntegration).toBe(true)
    expect(config.staleSessionTimeoutMs).toBe(0)
  })

  test("parses boolean overrides", () => {
    const config = loadConfig({
      OPENCODE_CMUX_NOTIFY_SUBAGENTS: "yes",
      OPENCODE_CMUX_LOG_SUBAGENTS: "off",
      OPENCODE_CMUX_PROGRESS: "0",
      OPENCODE_CMUX_KEEP_DONE_STATUS: "false",
      OPENCODE_CMUX_NOTIFY_QUESTIONS: "no",
      OPENCODE_CMUX_NOTIFY_PERMISSIONS: "1",
      OPENCODE_CMUX_LOG_TOOLS: "0",
      OPENCODE_CMUX_LOG_TOOLS_VERBOSE: "yes",
      OPENCODE_CMUX_LOG_FILE_EDITS: "no",
      OPENCODE_CMUX_LOG_SESSION_LIFECYCLE: "0",
      OPENCODE_CMUX_LOG_TODOS: "off",
      OPENCODE_CMUX_GIT: "false",
    })

    expect(config.notifySubagents).toBe(true)
    expect(config.logSubagents).toBe(false)
    expect(config.progressEnabled).toBe(false)
    expect(config.keepDoneStatus).toBe(false)
    expect(config.notifyQuestions).toBe(false)
    expect(config.notifyPermissions).toBe(true)
    expect(config.logToolCalls).toBe(false)
    expect(config.logToolCallsVerbose).toBe(true)
    expect(config.logFileEdits).toBe(false)
    expect(config.logSessionLifecycle).toBe(false)
    expect(config.logTodos).toBe(false)
    expect(config.gitIntegration).toBe(false)
  })

  test("parses staleSessionTimeoutMs from env", () => {
    const config = loadConfig({
      OPENCODE_CMUX_STALE_TIMEOUT: "30000",
    })

    expect(config.staleSessionTimeoutMs).toBe(30000)
  })

  test("staleSessionTimeoutMs falls back on invalid number", () => {
    const config = loadConfig({
      OPENCODE_CMUX_STALE_TIMEOUT: "not-a-number",
    })

    expect(config.staleSessionTimeoutMs).toBe(0)
  })

  test("staleSessionTimeoutMs handles empty string", () => {
    const config = loadConfig({
      OPENCODE_CMUX_STALE_TIMEOUT: "",
    })

    expect(config.staleSessionTimeoutMs).toBe(0)
  })

  describe("transport", () => {
    test("defaults to auto when not set", () => {
      const config = loadConfig({})
      expect(config.transport).toBe("auto")
    })

    test("parses 'socket'", () => {
      const config = loadConfig({ OPENCODE_CMUX_TRANSPORT: "socket" })
      expect(config.transport).toBe("socket")
    })

    test("parses 'cli'", () => {
      const config = loadConfig({ OPENCODE_CMUX_TRANSPORT: "cli" })
      expect(config.transport).toBe("cli")
    })

    test("parses 'auto'", () => {
      const config = loadConfig({ OPENCODE_CMUX_TRANSPORT: "auto" })
      expect(config.transport).toBe("auto")
    })

    test("trims and lowercases input", () => {
      const config = loadConfig({ OPENCODE_CMUX_TRANSPORT: "  Socket  " })
      expect(config.transport).toBe("socket")
    })

    test("defaults to auto on invalid value", () => {
      const config = loadConfig({ OPENCODE_CMUX_TRANSPORT: "websocket" })
      expect(config.transport).toBe("auto")
    })

    test("defaults to auto on empty string", () => {
      const config = loadConfig({ OPENCODE_CMUX_TRANSPORT: "" })
      expect(config.transport).toBe("auto")
    })
  })
})
