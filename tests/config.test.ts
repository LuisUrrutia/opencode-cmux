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
  })
})
