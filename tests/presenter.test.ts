import { describe, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { FakeCmuxClient, createCoordinator } from "./helpers/index.ts"

describe("FakeCmuxClient", () => {
  test("has transport property set to cli", () => {
    const client = new FakeCmuxClient()
    expect(client.transport).toBe("cli")
  })
})

describe("CmuxStateCoordinator", () => {
  test("initialize clears stale notifications", async () => {
    const { coordinator, cmux } = createCoordinator({})

    await coordinator.initialize()

    expect(cmux.calls[0]).toEqual({ type: "clearNotifications" })
  })

  test("clears notifications when a tool starts", async () => {
    const { coordinator, cmux } = createCoordinator({
      primary: {
        id: "primary",
        title: "Implement feature",
        kind: "primary",
      },
    })

    await coordinator.handleSessionStatus("primary", "busy")
    cmux.reset()

    await coordinator.handleToolStarted("bash", { command: "npm test" })

    expect(cmux.calls[0]).toEqual({ type: "clearNotifications" })
  })

  test("clears notifications when a session is created", async () => {
    const { coordinator, cmux } = createCoordinator({
      primary: {
        id: "primary",
        title: "Implement feature",
        kind: "primary",
      },
    })

    await coordinator.handleSessionCreated("primary")

    expect(cmux.calls[0]).toEqual({ type: "clearNotifications" })
  })

  test("reports git branch after a git bash command completes", async () => {
    const repoDir = mkdtempSync(join(tmpdir(), "opencode-cmux-git-"))
    try {
      execFileSync("git", ["init", "-b", "main"], { cwd: repoDir })
      writeFileSync(join(repoDir, "dirty.txt"), "dirty\n")

      const { coordinator, cmux } = createCoordinator(
        {
          primary: {
            id: "primary",
            title: "Implement feature",
            kind: "primary",
          },
        },
        { root: repoDir },
      )

      await coordinator.handleToolCompleted("bash", { command: "git status" })

      expect(cmux.calls).toContainEqual({
        type: "reportGitBranch",
        branch: "main",
        dirty: true,
      })
    } finally {
      rmSync(repoDir, { recursive: true, force: true })
    }
  })

  test("syncGitState reports branch metadata on initialization", async () => {
    const repoDir = mkdtempSync(join(tmpdir(), "opencode-cmux-git-init-"))
    try {
      execFileSync("git", ["init", "-b", "main"], { cwd: repoDir })

      const { coordinator, cmux } = createCoordinator(
        {
          primary: {
            id: "primary",
            title: "Implement feature",
            kind: "primary",
          },
        },
        { root: repoDir },
      )

      await coordinator.syncGitState()

      expect(cmux.calls).toContainEqual({
        type: "reportGitBranch",
        branch: "main",
        dirty: false,
      })
    } finally {
      rmSync(repoDir, { recursive: true, force: true })
    }
  })

  test("maps a primary busy -> idle lifecycle to sidebar output", async () => {
    const { coordinator, cmux } = createCoordinator({
      primary: {
        id: "primary",
        title: "Implement feature",
        kind: "primary",
      },
    })

    await coordinator.handleSessionStatus("primary", "busy")

    expect(cmux.calls).toContainEqual({
      type: "setStatus",
      key: "opencode",
      payload: {
        text: "working",
        icon: "terminal",
        color: "#f59e0b",
      },
    })

    // Progress value is time-dependent, so use closeTo for the value
    const busyProgress = cmux.calls.find(
      (c) => c.type === "setProgress" && c.payload.label === "demo: Implement feature",
    )
    expect(busyProgress).toBeDefined()
    expect(busyProgress!.payload.value).toBeCloseTo(0.1, 1)

    cmux.reset()
    await coordinator.handleSessionStatus("primary", "idle")
    await coordinator.flush()

    expect(cmux.calls).toContainEqual({
      type: "notify",
      payload: {
        title: "Done: demo",
        body: "Implement feature",
      },
    })
    expect(cmux.calls).toContainEqual({
      type: "setStatus",
      key: "opencode",
      payload: {
        text: "done",
        icon: "check-circle",
        color: "#22c55e",
      },
    })

    // Progress value at idle is 1.0
    const doneProgress = cmux.calls.find(
      (c) => c.type === "setProgress" && c.payload.label === "demo: done",
    )
    expect(doneProgress).toBeDefined()
    expect(doneProgress!.payload.value).toBeCloseTo(1.0, 1)
  })

  test("overlays question state and restores working status with subagent count", async () => {
    const { coordinator, cmux } = createCoordinator({
      primary: {
        id: "primary",
        title: "Build plugin",
        kind: "primary",
      },
      subagent: {
        id: "subagent",
        title: "Write docs",
        parentID: "primary",
        kind: "subagent",
      },
    })

    await coordinator.handleSessionStatus("primary", "busy")
    await coordinator.handleSessionStatus("subagent", "busy")
    await coordinator.flush()

    expect(cmux.calls).toContainEqual({
      type: "setStatus",
      key: "opencode",
      payload: {
        text: "working · 1 subagent",
        icon: "terminal",
        color: "#f59e0b",
      },
    })

    cmux.reset()
    await coordinator.handleQuestionAsked("Approve release note?", "primary")
    await coordinator.flush()

    expect(cmux.calls).toContainEqual({
      type: "setStatus",
      key: "opencode",
      payload: {
        text: "question",
        icon: "help-circle",
        color: "#a855f7",
      },
    })
    expect(cmux.calls).toContainEqual({
      type: "notify",
      payload: {
        title: "Question: demo",
        subtitle: "Approve release note?",
      },
    })

    cmux.reset()
    await coordinator.handleQuestionResolved()
    await coordinator.flush()

    expect(cmux.calls).toContainEqual({
      type: "setStatus",
      key: "opencode",
      payload: {
        text: "working · 1 subagent",
        icon: "terminal",
        color: "#f59e0b",
      },
    })
  })

  test("tool started during busy session updates status text", async () => {
    const { coordinator, cmux } = createCoordinator({
      primary: {
        id: "primary",
        title: "Implement feature",
        kind: "primary",
      },
    })

    await coordinator.handleSessionStatus("primary", "busy")
    cmux.reset()

    await coordinator.handleToolStarted("bash", { command: "npm test" })
    await coordinator.flush()

    // Status should now show "working: bash"
    expect(cmux.calls).toContainEqual({
      type: "setStatus",
      key: "opencode",
      payload: {
        text: "working: bash",
        icon: "terminal",
        color: "#f59e0b",
      },
    })

    // Should log the tool start
    expect(cmux.calls).toContainEqual({
      type: "log",
      payload: {
        level: "progress",
        source: "opencode",
        message: "demo: running bash: npm test",
      },
    })
  })

  test("tool completed reverts status text to 'working'", async () => {
    const { coordinator, cmux } = createCoordinator({
      primary: {
        id: "primary",
        title: "Implement feature",
        kind: "primary",
      },
    })

    await coordinator.handleSessionStatus("primary", "busy")
    await coordinator.handleToolStarted("bash", { command: "npm test" })
    await coordinator.flush()
    cmux.reset()

    await coordinator.handleToolCompleted("bash", { command: "npm test" })
    await coordinator.flush()

    // Status should revert to just "working" (no tool suffix)
    expect(cmux.calls).toContainEqual({
      type: "setStatus",
      key: "opencode",
      payload: {
        text: "working",
        icon: "terminal",
        color: "#f59e0b",
      },
    })

    // Should log the tool completion
    expect(cmux.calls).toContainEqual({
      type: "log",
      payload: {
        level: "info",
        source: "opencode",
        message: "demo: finished bash: npm test",
      },
    })
  })

  test("multiple concurrent tools show count in status", async () => {
    const { coordinator, cmux } = createCoordinator({
      primary: {
        id: "primary",
        title: "Implement feature",
        kind: "primary",
      },
    })

    await coordinator.handleSessionStatus("primary", "busy")
    await coordinator.handleToolStarted("bash", { command: "npm test" })
    await coordinator.handleToolStarted("read", { filePath: "src/index.ts" })
    cmux.reset()

    // Trigger a re-render by starting a third tool
    await coordinator.handleToolStarted("glob", { pattern: "**/*.ts" })
    await coordinator.flush()

    expect(cmux.calls).toContainEqual({
      type: "setStatus",
      key: "opencode",
      payload: {
        text: "working: 3 tools",
        icon: "terminal",
        color: "#f59e0b",
      },
    })
  })

  test("tool tracking is isolated per invocation (no leaks)", async () => {
    const { coordinator, cmux } = createCoordinator({
      primary: {
        id: "primary",
        title: "Build plugin",
        kind: "primary",
      },
    })

    await coordinator.handleSessionStatus("primary", "busy")

    // Start and complete a bash tool
    await coordinator.handleToolStarted("bash", { command: "npm test" })
    await coordinator.handleToolCompleted("bash", { command: "npm test" })

    // Start a different bash tool
    await coordinator.handleToolStarted("bash", { command: "npm build" })
    await coordinator.flush()
    cmux.reset()

    // Complete it — should only remove one entry
    await coordinator.handleToolCompleted("bash", { command: "npm build" })
    await coordinator.flush()

    // Should show no tools, just "working"
    expect(cmux.calls).toContainEqual({
      type: "setStatus",
      key: "opencode",
      payload: {
        text: "working",
        icon: "terminal",
        color: "#f59e0b",
      },
    })
  })

  test("tool started when session not busy still logs and tracks", async () => {
    const { coordinator, cmux } = createCoordinator({
      primary: {
        id: "primary",
        title: "Implement feature",
        kind: "primary",
      },
    })

    // Don't set session to busy first — tool hook fires anyway
    await coordinator.handleToolStarted("edit", {
      filePath: "/tmp/demo/src/index.ts",
    })

    // Should still log the tool start
    expect(cmux.calls).toContainEqual({
      type: "log",
      payload: {
        level: "progress",
        source: "opencode",
        message: "demo: running edit: src/index.ts",
      },
    })

    // No status update since session isn't busy (snapshot returns {})
    const statusCalls = cmux.calls.filter((c) => c.type === "setStatus")
    expect(statusCalls).toHaveLength(0)
  })

  test("tool with subagent shows combined status", async () => {
    const { coordinator, cmux } = createCoordinator({
      primary: {
        id: "primary",
        title: "Build plugin",
        kind: "primary",
      },
      subagent: {
        id: "subagent",
        title: "Write docs",
        parentID: "primary",
        kind: "subagent",
      },
    })

    await coordinator.handleSessionStatus("primary", "busy")
    await coordinator.handleSessionStatus("subagent", "busy")
    cmux.reset()

    await coordinator.handleToolStarted("bash", { command: "npm test" })
    await coordinator.flush()

    expect(cmux.calls).toContainEqual({
      type: "setStatus",
      key: "opencode",
      payload: {
        text: "working: bash · 1 subagent",
        icon: "terminal",
        color: "#f59e0b",
      },
    })
  })

  test("file edit logged to sidebar with relative path", async () => {
    const { coordinator, cmux } = createCoordinator({
      primary: {
        id: "primary",
        title: "Implement feature",
        kind: "primary",
      },
    })

    await coordinator.handleFileEdited("/tmp/demo/src/components/Button.tsx")

    expect(cmux.calls).toContainEqual({
      type: "log",
      payload: {
        level: "progress",
        source: "opencode",
        message: "demo: edited src/components/Button.tsx",
      },
    })
  })

  test("consecutive edits to same file are deduplicated", async () => {
    const { coordinator, cmux } = createCoordinator({
      primary: {
        id: "primary",
        title: "Implement feature",
        kind: "primary",
      },
    })

    await coordinator.handleFileEdited("/tmp/demo/src/index.ts")
    const firstCallCount = cmux.calls.filter(
      (c) =>
        c.type === "log" &&
        c.payload.message.includes("edited src/index.ts"),
    ).length
    expect(firstCallCount).toBe(1)

    // Second edit to same file within debounce window should be suppressed
    await coordinator.handleFileEdited("/tmp/demo/src/index.ts")
    const secondCallCount = cmux.calls.filter(
      (c) =>
        c.type === "log" &&
        c.payload.message.includes("edited src/index.ts"),
    ).length
    expect(secondCallCount).toBe(1) // Still just 1 — debounced

    // Different file should still be logged
    await coordinator.handleFileEdited("/tmp/demo/src/other.ts")
    expect(cmux.calls).toContainEqual({
      type: "log",
      payload: {
        level: "progress",
        source: "opencode",
        message: "demo: edited src/other.ts",
      },
    })
  })

  test("file edit config toggle suppresses logging", async () => {
    const { coordinator, cmux, config } = createCoordinator({
      primary: {
        id: "primary",
        title: "Implement feature",
        kind: "primary",
      },
    })

    // Disable file edit logging
    config.logFileEdits = false

    await coordinator.handleFileEdited("/tmp/demo/src/index.ts")

    const logCalls = cmux.calls.filter(
      (c) => c.type === "log" && c.payload.message.includes("edited"),
    )
    expect(logCalls).toHaveLength(0)
  })

  test("session created eagerly resolves metadata and logs", async () => {
    const { coordinator, cmux } = createCoordinator({
      primary: {
        id: "primary",
        title: "Implement feature",
        kind: "primary",
      },
    })

    await coordinator.handleSessionCreated("primary")

    expect(cmux.calls).toContainEqual({
      type: "log",
      payload: {
        level: "info",
        source: "opencode",
        message: "demo: session started - Implement feature",
      },
    })
  })

  test("session created logs sessionID when metadata not found", async () => {
    const { coordinator, cmux } = createCoordinator({})

    await coordinator.handleSessionCreated("unknown-session")

    expect(cmux.calls).toContainEqual({
      type: "log",
      payload: {
        level: "info",
        source: "opencode",
        message: "demo: session started - unknown-session",
      },
    })
  })

  test("session created respects logSessionLifecycle config", async () => {
    const { coordinator, cmux, config } = createCoordinator({
      primary: {
        id: "primary",
        title: "Implement feature",
        kind: "primary",
      },
    })

    config.logSessionLifecycle = false
    await coordinator.handleSessionCreated("primary")

    const logCalls = cmux.calls.filter(
      (c) => c.type === "log" && c.payload.message.includes("session started"),
    )
    expect(logCalls).toHaveLength(0)
  })

  test("session deleted cleans up state and logs", async () => {
    const { coordinator, cmux } = createCoordinator({
      primary: {
        id: "primary",
        title: "Build plugin",
        kind: "primary",
      },
    })

    // First make the session busy so it's tracked
    await coordinator.handleSessionStatus("primary", "busy")
    cmux.reset()

    await coordinator.handleSessionDeleted("primary")
    await coordinator.flush()

    expect(cmux.calls).toContainEqual({
      type: "log",
      payload: {
        level: "info",
        source: "opencode",
        message: "demo: session deleted - Build plugin",
      },
    })

    // After deleting primary, status should be cleared (snapshot returns {})
    expect(cmux.calls).toContainEqual({
      type: "clearStatus",
      key: "opencode",
    })
  })

  test("session deleted clears primary state and progress", async () => {
    const { coordinator, cmux } = createCoordinator({
      primary: {
        id: "primary",
        title: "Build plugin",
        kind: "primary",
      },
    })

    await coordinator.handleSessionStatus("primary", "busy")
    cmux.reset()

    await coordinator.handleSessionDeleted("primary")
    await coordinator.flush()

    // Should clear progress since primary is gone
    expect(cmux.calls).toContainEqual({
      type: "clearProgress",
    })
  })

  test("session compacted logs informational message", async () => {
    const { coordinator, cmux } = createCoordinator({
      primary: {
        id: "primary",
        title: "Build plugin",
        kind: "primary",
      },
    })

    await coordinator.handleSessionCompacted("primary")

    expect(cmux.calls).toContainEqual({
      type: "log",
      payload: {
        level: "info",
        source: "opencode",
        message: "demo: session compacted - Build plugin",
      },
    })
  })

  test("session compacted respects logSessionLifecycle config", async () => {
    const { coordinator, cmux, config } = createCoordinator({
      primary: {
        id: "primary",
        title: "Build plugin",
        kind: "primary",
      },
    })

    config.logSessionLifecycle = false
    await coordinator.handleSessionCompacted("primary")

    const logCalls = cmux.calls.filter(
      (c) => c.type === "log" && c.payload.message.includes("compacted"),
    )
    expect(logCalls).toHaveLength(0)
  })

  test("todo updated tracks state and logs summary", async () => {
    const { coordinator, cmux } = createCoordinator({
      primary: {
        id: "primary",
        title: "Build plugin",
        kind: "primary",
      },
    })

    await coordinator.handleTodoUpdated([
      { text: "Write tests", completed: true },
      { text: "Fix bug", completed: false },
      { text: "Deploy", completed: true },
      { text: "Review", completed: false },
      { text: "Document", completed: false },
    ])

    expect(cmux.calls).toContainEqual({
      type: "log",
      payload: {
        level: "progress",
        source: "opencode",
        message: "demo: todos: 2/5 complete",
      },
    })
  })

  test("todo updated with empty list logs 0/0", async () => {
    const { coordinator, cmux } = createCoordinator({
      primary: {
        id: "primary",
        title: "Build plugin",
        kind: "primary",
      },
    })

    await coordinator.handleTodoUpdated([])

    expect(cmux.calls).toContainEqual({
      type: "log",
      payload: {
        level: "progress",
        source: "opencode",
        message: "demo: todos: 0/0 complete",
      },
    })
  })

  test("todo updated respects logTodos config", async () => {
    const { coordinator, cmux, config } = createCoordinator({
      primary: {
        id: "primary",
        title: "Build plugin",
        kind: "primary",
      },
    })

    config.logTodos = false
    await coordinator.handleTodoUpdated([
      { text: "Write tests", completed: true },
    ])

    const logCalls = cmux.calls.filter(
      (c) => c.type === "log" && c.payload.message.includes("todos"),
    )
    expect(logCalls).toHaveLength(0)
  })

  // --- Phase 6: Resilience tests ---

  test("render throttle coalesces rapid renders into one", async () => {
    const { coordinator, cmux } = createCoordinator({
      primary: {
        id: "primary",
        title: "Build plugin",
        kind: "primary",
      },
    })

    // First handler: render fires immediately (no prior render)
    await coordinator.handleSessionStatus("primary", "busy")

    const statusCallsAfterFirst = cmux.calls.filter(
      (c) => c.type === "setStatus",
    ).length

    // Fire several rapid tool starts — renders should be deferred
    await coordinator.handleToolStarted("bash", { command: "npm test" })
    await coordinator.handleToolStarted("read", { filePath: "src/index.ts" })
    await coordinator.handleToolStarted("glob", { pattern: "**/*.ts" })

    // Before flush, only the first render's setStatus should exist
    // (subsequent renders are pending)
    const statusCallsBeforeFlush = cmux.calls.filter(
      (c) => c.type === "setStatus",
    ).length
    expect(statusCallsBeforeFlush).toBe(statusCallsAfterFirst)

    // Flush forces the deferred render — only ONE additional setStatus
    await coordinator.flush()

    const statusCallsAfterFlush = cmux.calls.filter(
      (c) => c.type === "setStatus",
    ).length
    expect(statusCallsAfterFlush).toBe(statusCallsAfterFirst + 1)

    // The final status should reflect 3 active tools
    const lastStatus = cmux.calls
      .filter((c) => c.type === "setStatus")
      .pop()!
    expect(lastStatus).toEqual({
      type: "setStatus",
      key: "opencode",
      payload: {
        text: "working: 3 tools",
        icon: "terminal",
        color: "#f59e0b",
      },
    })
  })

  test("sidebar log rate limiter drops excess messages", async () => {
    const { coordinator, cmux } = createCoordinator({
      primary: {
        id: "primary",
        title: "Build plugin",
        kind: "primary",
      },
    })

    // Fire many rapid tool starts — each generates a log via throttledLog
    // Rate limit is 5 per 1000ms, so logs 6+ should be dropped
    for (let i = 0; i < 10; i++) {
      await coordinator.handleToolStarted("bash", { command: `cmd-${i}` })
    }

    const logCalls = cmux.calls.filter((c) => c.type === "log")
    // Should have at most 5 log calls (rate limit), not 10
    expect(logCalls.length).toBeLessThanOrEqual(5)
    expect(logCalls.length).toBeGreaterThan(0)
  })

  test("stale session watchdog fires after timeout", async () => {
    const { coordinator, cmux, config } = createCoordinator({
      primary: {
        id: "primary",
        title: "Build plugin",
        kind: "primary",
      },
    })

    // Enable stale session timeout at 50ms for fast test
    config.staleSessionTimeoutMs = 50

    await coordinator.handleSessionStatus("primary", "busy")
    await coordinator.flush()

    // Confirm we're in "working" state
    expect(cmux.calls).toContainEqual({
      type: "setStatus",
      key: "opencode",
      payload: {
        text: "working",
        icon: "terminal",
        color: "#f59e0b",
      },
    })

    cmux.reset()

    // Wait for the stale timer to fire
    await new Promise((resolve) => setTimeout(resolve, 100))

    // Should have logged a stale warning
    const staleLogs = cmux.calls.filter(
      (c) =>
        c.type === "log" &&
        c.payload.message.includes("stale session cleared"),
    )
    expect(staleLogs.length).toBe(1)

    // Should have rendered — session should now be idle/done
    const statusCalls = cmux.calls.filter((c) => c.type === "setStatus")
    expect(statusCalls.length).toBeGreaterThan(0)
    const lastStatus = statusCalls.pop()!
    expect(lastStatus).toEqual({
      type: "setStatus",
      key: "opencode",
      payload: {
        text: "done",
        icon: "check-circle",
        color: "#22c55e",
      },
    })

    await coordinator.dispose()
  })

  test("stale session watchdog does not fire when disabled", async () => {
    const { coordinator, cmux } = createCoordinator({
      primary: {
        id: "primary",
        title: "Build plugin",
        kind: "primary",
      },
    })

    // staleSessionTimeoutMs defaults to 0 (disabled) in createCoordinator

    await coordinator.handleSessionStatus("primary", "busy")
    await coordinator.flush()
    cmux.reset()

    // Wait a bit — no stale timer should fire
    await new Promise((resolve) => setTimeout(resolve, 100))

    const staleLogs = cmux.calls.filter(
      (c) =>
        c.type === "log" &&
        c.payload.message.includes("stale session cleared"),
    )
    expect(staleLogs.length).toBe(0)

    await coordinator.dispose()
  })

  test("stale session watchdog resets on new events", async () => {
    const { coordinator, cmux, config } = createCoordinator({
      primary: {
        id: "primary",
        title: "Build plugin",
        kind: "primary",
      },
    })

    // Enable stale session timeout at 80ms
    config.staleSessionTimeoutMs = 80

    await coordinator.handleSessionStatus("primary", "busy")
    await coordinator.flush()

    // Wait 50ms, then send another event to reset the timer
    await new Promise((resolve) => setTimeout(resolve, 50))
    await coordinator.handleToolStarted("bash", { command: "npm test" })

    // Wait another 50ms — total 100ms from start, but only 50ms from last event
    // Timer should NOT have fired yet (80ms from last event)
    await new Promise((resolve) => setTimeout(resolve, 50))

    const staleLogs = cmux.calls.filter(
      (c) =>
        c.type === "log" &&
        c.payload.message.includes("stale session cleared"),
    )
    expect(staleLogs.length).toBe(0)

    await coordinator.dispose()
  })

  test("dispose cancels pending timers", async () => {
    const { coordinator, cmux, config } = createCoordinator({
      primary: {
        id: "primary",
        title: "Build plugin",
        kind: "primary",
      },
    })

    config.staleSessionTimeoutMs = 50

    await coordinator.handleSessionStatus("primary", "busy")
    await coordinator.flush()
    cmux.reset()

    // Dispose before the stale timer would fire
    await coordinator.dispose()

    // Wait past the stale timeout
    await new Promise((resolve) => setTimeout(resolve, 100))

    // No stale warning should have been logged
    const staleLogs = cmux.calls.filter(
      (c) =>
        c.type === "log" &&
        c.payload.message.includes("stale session cleared"),
    )
    expect(staleLogs.length).toBe(0)
  })

  // ---------------------------------------------------------------------------
  // handleSessionError
  // ---------------------------------------------------------------------------

  test("handleSessionError sets error status and sends notification for primary session", async () => {
    const { coordinator, cmux } = createCoordinator({
      primary: {
        id: "primary",
        title: "Implement feature",
        kind: "primary",
      },
    })

    await coordinator.handleSessionStatus("primary", "busy")
    cmux.reset()

    await coordinator.handleSessionError("primary")
    await coordinator.flush()

    expect(cmux.calls).toContainEqual({
      type: "setStatus",
      key: "opencode",
      payload: {
        text: "error",
        icon: "alert-circle",
        color: "#ef4444",
      },
    })

    expect(cmux.calls).toContainEqual({
      type: "notify",
      payload: {
        title: "Error: demo",
        body: "Implement feature",
      },
    })

    expect(cmux.calls).toContainEqual({
      type: "log",
      payload: {
        level: "error",
        source: "opencode",
        message: "demo: error in Implement feature",
      },
    })
  })

  test("handleSessionError clears pending permission and question", async () => {
    const { coordinator, cmux } = createCoordinator({
      primary: {
        id: "primary",
        title: "Build",
        kind: "primary",
      },
    })

    await coordinator.handleSessionStatus("primary", "busy")
    await coordinator.handlePermissionAsked("Run bash?")
    cmux.reset()

    // Error should clear the pending permission
    await coordinator.handleSessionError("primary")
    await coordinator.flush()

    // Status should be "error", not "waiting" (permission should be cleared)
    expect(cmux.calls).toContainEqual({
      type: "setStatus",
      key: "opencode",
      payload: {
        text: "error",
        icon: "alert-circle",
        color: "#ef4444",
      },
    })
  })

  test("handleSessionError does nothing for unknown session", async () => {
    const { coordinator, cmux } = createCoordinator({
      primary: {
        id: "primary",
        title: "Build",
        kind: "primary",
      },
    })

    cmux.reset()
    await coordinator.handleSessionError("nonexistent")
    await coordinator.flush()

    // No calls should be made for an unknown session
    expect(cmux.calls.length).toBe(0)
  })

  // ---------------------------------------------------------------------------
  // handleSessionIdle (dedicated event, vs. handleSessionStatus("idle"))
  // ---------------------------------------------------------------------------

  test("handleSessionIdle transitions primary to done status", async () => {
    const { coordinator, cmux } = createCoordinator({
      primary: {
        id: "primary",
        title: "Implement feature",
        kind: "primary",
      },
    })

    await coordinator.handleSessionStatus("primary", "busy")
    cmux.reset()

    await coordinator.handleSessionIdle("primary")
    await coordinator.flush()

    expect(cmux.calls).toContainEqual({
      type: "setStatus",
      key: "opencode",
      payload: {
        text: "done",
        icon: "check-circle",
        color: "#22c55e",
      },
    })
  })

  // ---------------------------------------------------------------------------
  // handlePermissionAsked / handlePermissionResolved
  // ---------------------------------------------------------------------------

  test("handlePermissionAsked sets waiting status with lock icon", async () => {
    const { coordinator, cmux } = createCoordinator({
      primary: {
        id: "primary",
        title: "Build plugin",
        kind: "primary",
      },
    })

    await coordinator.handleSessionStatus("primary", "busy")
    cmux.reset()

    await coordinator.handlePermissionAsked("Execute bash command")
    await coordinator.flush()

    expect(cmux.calls).toContainEqual({
      type: "setStatus",
      key: "opencode",
      payload: {
        text: "waiting",
        icon: "lock",
        color: "#ef4444",
      },
    })

    // Should send a notification
    expect(cmux.calls).toContainEqual({
      type: "notify",
      payload: {
        title: "Permission needed: demo",
        subtitle: "Execute bash command",
      },
    })

    // Should log
    expect(cmux.calls).toContainEqual({
      type: "log",
      payload: {
        level: "warning",
        source: "opencode",
        message: "demo: waiting for permission - Execute bash command",
      },
    })
  })

  test("handlePermissionAsked deduplicates identical requests", async () => {
    const { coordinator, cmux } = createCoordinator({
      primary: {
        id: "primary",
        title: "Build",
        kind: "primary",
      },
    })

    await coordinator.handleSessionStatus("primary", "busy")
    await coordinator.handlePermissionAsked("Run bash?")
    await coordinator.flush()
    cmux.reset()

    // Ask same permission again — should be a no-op
    await coordinator.handlePermissionAsked("Run bash?")
    await coordinator.flush()

    const notifications = cmux.calls.filter((c) => c.type === "notify")
    expect(notifications.length).toBe(0)
  })

  test("handlePermissionResolved clears waiting status back to working", async () => {
    const { coordinator, cmux } = createCoordinator({
      primary: {
        id: "primary",
        title: "Build plugin",
        kind: "primary",
      },
    })

    await coordinator.handleSessionStatus("primary", "busy")
    await coordinator.handlePermissionAsked("Execute bash command")
    await coordinator.flush()
    cmux.reset()

    await coordinator.handlePermissionResolved()
    await coordinator.flush()

    // Should revert to working status since primary is still busy
    expect(cmux.calls).toContainEqual({
      type: "setStatus",
      key: "opencode",
      payload: expect.objectContaining({
        text: expect.stringContaining("working"),
        icon: "terminal",
        color: "#f59e0b",
      }),
    })
  })

  test("handlePermissionResolved is no-op when no permission is pending", async () => {
    const { coordinator, cmux } = createCoordinator({
      primary: {
        id: "primary",
        title: "Build",
        kind: "primary",
      },
    })

    cmux.reset()
    await coordinator.handlePermissionResolved()
    await coordinator.flush()

    expect(cmux.calls.length).toBe(0)
  })

  test("permission takes priority over question in status display", async () => {
    const { coordinator, cmux } = createCoordinator({
      primary: {
        id: "primary",
        title: "Build",
        kind: "primary",
      },
    })

    await coordinator.handleSessionStatus("primary", "busy")
    await coordinator.handleQuestionAsked("Which format?", "primary")
    cmux.reset()

    // Permission should override question
    await coordinator.handlePermissionAsked("Run bash?")
    await coordinator.flush()

    expect(cmux.calls).toContainEqual({
      type: "setStatus",
      key: "opencode",
      payload: {
        text: "waiting",
        icon: "lock",
        color: "#ef4444",
      },
    })
  })

  // ---------------------------------------------------------------------------
  // Done timeout auto-clear
  // ---------------------------------------------------------------------------

  test("done timeout clears sidebar after idle", async () => {
    const { coordinator, cmux, config } = createCoordinator({
      primary: {
        id: "primary",
        title: "Build plugin",
        kind: "primary",
      },
    })

    config.doneTimeoutMs = 50

    await coordinator.handleSessionStatus("primary", "busy")
    await coordinator.handleSessionStatus("primary", "idle")
    await coordinator.flush()

    // Should show "done" immediately
    expect(cmux.calls).toContainEqual({
      type: "setStatus",
      key: "opencode",
      payload: {
        text: "done",
        icon: "check-circle",
        color: "#22c55e",
      },
    })

    cmux.reset()

    // Wait for the done timer to fire
    await new Promise((resolve) => setTimeout(resolve, 100))

    // Sidebar should now be cleared
    expect(cmux.calls).toContainEqual({
      type: "clearStatus",
      key: "opencode",
    })
    expect(cmux.calls).toContainEqual({
      type: "clearProgress",
    })

    await coordinator.dispose()
  })

  test("done timeout is cancelled when session becomes busy again", async () => {
    const { coordinator, cmux, config } = createCoordinator({
      primary: {
        id: "primary",
        title: "Build plugin",
        kind: "primary",
      },
    })

    config.doneTimeoutMs = 80

    await coordinator.handleSessionStatus("primary", "busy")
    await coordinator.handleSessionStatus("primary", "idle")
    await coordinator.flush()

    // Start a new message before the done timer fires
    await new Promise((resolve) => setTimeout(resolve, 30))
    await coordinator.handleSessionStatus("primary", "busy")
    await coordinator.flush()
    cmux.reset()

    // Wait past the original done timeout
    await new Promise((resolve) => setTimeout(resolve, 100))

    // Sidebar should NOT have been cleared — still showing "working"
    const clearCalls = cmux.calls.filter((c) => c.type === "clearStatus")
    expect(clearCalls.length).toBe(0)

    await coordinator.dispose()
  })

  test("done timeout disabled when doneTimeoutMs is 0", async () => {
    const { coordinator, cmux } = createCoordinator({
      primary: {
        id: "primary",
        title: "Build plugin",
        kind: "primary",
      },
    })

    // doneTimeoutMs defaults to 0 in test config (disabled)

    await coordinator.handleSessionStatus("primary", "busy")
    await coordinator.handleSessionStatus("primary", "idle")
    await coordinator.flush()

    // Should show "done"
    expect(cmux.calls).toContainEqual({
      type: "setStatus",
      key: "opencode",
      payload: {
        text: "done",
        icon: "check-circle",
        color: "#22c55e",
      },
    })

    cmux.reset()

    // Wait a bit — no timer should fire
    await new Promise((resolve) => setTimeout(resolve, 100))

    // Sidebar should NOT have been cleared
    const clearCalls = cmux.calls.filter((c) => c.type === "clearStatus")
    expect(clearCalls.length).toBe(0)

    await coordinator.dispose()
  })

  test("done timeout skipped when keepDoneStatus is false", async () => {
    const { coordinator, cmux, config } = createCoordinator({
      primary: {
        id: "primary",
        title: "Build plugin",
        kind: "primary",
      },
    })

    config.keepDoneStatus = false
    config.doneTimeoutMs = 50

    await coordinator.handleSessionStatus("primary", "busy")
    await coordinator.handleSessionStatus("primary", "idle")
    await coordinator.flush()

    // With keepDoneStatus=false, sidebar is cleared immediately (no "done" pill)
    expect(cmux.calls).toContainEqual({
      type: "clearStatus",
      key: "opencode",
    })

    // The notification should still have been sent
    expect(cmux.calls).toContainEqual({
      type: "notify",
      payload: {
        title: "Done: demo",
        body: "Build plugin",
      },
    })

    await coordinator.dispose()
  })

  test("dispose cancels done timer", async () => {
    const { coordinator, cmux, config } = createCoordinator({
      primary: {
        id: "primary",
        title: "Build plugin",
        kind: "primary",
      },
    })

    config.doneTimeoutMs = 50

    await coordinator.handleSessionStatus("primary", "busy")
    await coordinator.handleSessionStatus("primary", "idle")
    await coordinator.flush()
    cmux.reset()

    // Dispose before the done timer fires
    await coordinator.dispose()

    // Wait past the done timeout
    await new Promise((resolve) => setTimeout(resolve, 100))

    // Sidebar should NOT have been cleared by the timer
    const clearCalls = cmux.calls.filter((c) => c.type === "clearStatus")
    expect(clearCalls.length).toBe(0)
  })
})
