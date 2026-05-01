import { describe, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { FakeCmuxClient, createCoordinator, type FakeCall } from "./helpers/index.ts"

const DEFAULT_LOCAL_STATUS_KEY = "opencode:workspace-1-tab-1-surface-1"

function primaryStatusColor(calls: FakeCall[]): string | undefined {
  return calls.find(
    (call) => call.type === "setStatus" && call.key.startsWith("opencode:"),
  )?.payload.color
}

describe("FakeCmuxClient", () => {
  test("has transport property set to cli", () => {
    const client = new FakeCmuxClient()
    expect(client.transport).toBe("cli")
  })
})

describe("CmuxStateCoordinator", () => {
  test("initialize clears stale cmux presentation", async () => {
    const { coordinator, cmux } = createCoordinator({})

    await coordinator.initialize()

    expect(cmux.calls).toEqual([
      { type: "clearNotifications" },
      { type: "clearStatus", key: DEFAULT_LOCAL_STATUS_KEY },
      { type: "clearStatus", key: "opencode" },
      { type: "clearStatus", key: "opencode:tools" },
      { type: "clearStatus", key: "opencode:subagents" },
      { type: "clearStatus", key: "opencode:todos" },
    ])
  })

  test("initialize does not clear shared progress or logs", async () => {
    const { coordinator, cmux } = createCoordinator({})

    await coordinator.initialize()

    expect(cmux.calls.some((call) => call.type === "clearProgress")).toBe(false)
    expect(cmux.calls.some((call) => call.type === "clearLog")).toBe(false)
  })

  test("initialize skips stale cleanup without precise tab targeting", async () => {
    const cmux = new FakeCmuxClient({ preciseTabTargeting: false })
    const { coordinator } = createCoordinator({}, { cmux })

    await coordinator.initialize()

    expect(cmux.calls).toEqual([])
  })

  test("late startup cleanup does not clear live progress", async () => {
    const { coordinator, cmux } = createCoordinator({
      primary: {
        id: "primary",
        title: "Implement feature",
        kind: "primary",
      },
    })

    await coordinator.handleSessionStatus("primary", "busy")
    await coordinator.flush()
    cmux.reset()

    await coordinator.initialize()

    expect(cmux.calls).toEqual([])
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

  test("clears stale cmux presentation when a primary session is created", async () => {
    const { coordinator, cmux } = createCoordinator({
      primary: {
        id: "primary",
        title: "Implement feature",
        kind: "primary",
      },
    })

    await coordinator.handleSessionCreated("primary")

    expect(cmux.calls).toContainEqual({ type: "clearNotifications" })
    expect(cmux.calls).toContainEqual({ type: "clearStatus", key: DEFAULT_LOCAL_STATUS_KEY })
    expect(cmux.calls).toContainEqual({ type: "clearStatus", key: "opencode:tools" })
    expect(cmux.calls).toContainEqual({ type: "clearStatus", key: "opencode:subagents" })
    expect(cmux.calls).toContainEqual({ type: "clearStatus", key: "opencode:todos" })
    expect(cmux.calls.some((call) => call.type === "clearProgress")).toBe(false)
    expect(cmux.calls.some((call) => call.type === "clearLog")).toBe(false)
  })

  test("primary session start only clears local status resources", async () => {
    const firstTab = new FakeCmuxClient({ workspaceID: "workspace:1", tabID: "tab:1", surfaceID: "surface:1" })
    const secondTab = new FakeCmuxClient({ workspaceID: "workspace:1", tabID: "tab:1", surfaceID: "surface:2" })
    const first = createCoordinator({
      primary: {
        id: "primary",
        title: "Build plugin",
        kind: "primary",
      },
    }, { cmux: firstTab })
    const second = createCoordinator({
      primary: {
        id: "primary",
        title: "Build plugin",
        kind: "primary",
      },
    }, { cmux: secondTab })

    await first.coordinator.handleSessionStatus("primary", "busy")
    await first.coordinator.flush()
    firstTab.reset()

    await second.coordinator.handleSessionCreated("primary")

    expect(secondTab.calls).toContainEqual({
      type: "clearStatus",
      key: "opencode:workspace-1-tab-1-surface-2",
    })
    expect(secondTab.calls).not.toContainEqual({
      type: "clearStatus",
      key: "opencode:workspace-1-tab-1-surface-1",
    })
    expect(secondTab.calls.some((call) => call.type === "clearProgress")).toBe(false)
    expect(secondTab.calls.some((call) => call.type === "clearLog")).toBe(false)
    expect(firstTab.calls).toEqual([])
  })

  test("does not clear stale presentation on session start without precise tab targeting", async () => {
    const cmux = new FakeCmuxClient({ preciseTabTargeting: false })
    const { coordinator } = createCoordinator({
      primary: {
        id: "primary",
        title: "Implement feature",
        kind: "primary",
      },
    }, { cmux })

    await coordinator.handleSessionCreated("primary")

    expect(cmux.calls).not.toContainEqual({ type: "clearNotifications" })
    expect(cmux.calls).not.toContainEqual({ type: "clearStatus", key: DEFAULT_LOCAL_STATUS_KEY })
    expect(cmux.calls).not.toContainEqual({ type: "clearStatus", key: "opencode:tools" })
    expect(cmux.calls).not.toContainEqual({ type: "clearStatus", key: "opencode:subagents" })
    expect(cmux.calls).not.toContainEqual({ type: "clearStatus", key: "opencode:todos" })
    expect(cmux.calls).not.toContainEqual({ type: "clearProgress" })
    expect(cmux.calls).not.toContainEqual({ type: "clearLog" })
  })

  test("cleans cmux presentation when a primary session is deleted", async () => {
    const { coordinator, cmux } = createCoordinator({
      primary: {
        id: "primary",
        title: "Implement feature",
        kind: "primary",
      },
    })

    await coordinator.handleSessionStatus("primary", "busy")
    await coordinator.flush()
    cmux.reset()

    await coordinator.handleSessionDeleted("primary")

    expect(cmux.calls).toContainEqual({ type: "clearNotifications" })
    expect(cmux.calls).toContainEqual({ type: "clearStatus", key: DEFAULT_LOCAL_STATUS_KEY })
    expect(cmux.calls).toContainEqual({ type: "clearStatus", key: "opencode:tools" })
    expect(cmux.calls).toContainEqual({ type: "clearStatus", key: "opencode:subagents" })
    expect(cmux.calls).toContainEqual({ type: "clearStatus", key: "opencode:todos" })
    expect(cmux.calls.some((call) => call.type === "clearProgress")).toBe(false)
    expect(cmux.calls.some((call) => call.type === "clearLog")).toBe(false)
  })

  test("session.updated refreshes renamed session metadata", async () => {
    const { coordinator, cmux, sessionResolver } = createCoordinator({
      primary: {
        id: "primary",
        title: "Old title",
        kind: "primary",
      },
    })

    await coordinator.handleSessionStatus("primary", "busy")
    await coordinator.flush()
    cmux.reset()
    sessionResolver.setSession("primary", {
      id: "primary",
      title: "Renamed title",
      kind: "primary",
    })

    await coordinator.handleSessionUpdated("primary")
    await coordinator.flush()

    expect(cmux.calls).toContainEqual({
      type: "setProgress",
      payload: {
        value: expect.any(Number),
        label: "demo: Renamed title",
      },
    })

    await coordinator.handleSessionStatus("primary", "idle")
    await coordinator.flush()

    expect(cmux.calls).toContainEqual({
      type: "notify",
      payload: {
        title: "Done: demo",
        body: "Renamed title",
      },
    })
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
      key: DEFAULT_LOCAL_STATUS_KEY,
      payload: {
        text: "working",
        icon: "terminal",
        color: expect.any(String),
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

    expect(cmux.calls.map((call) => call.type)).toEqual([
      "setStatus",
      "setProgress",
      "log",
      "notify",
      "clearProgress",
    ])
    expect(cmux.calls).toEqual([
      {
        type: "setStatus",
        key: DEFAULT_LOCAL_STATUS_KEY,
        payload: {
          text: "done",
          icon: "check-circle",
          color: "#22c55e",
        },
      },
      {
        type: "setProgress",
        payload: {
          value: 1,
          label: "demo: done",
        },
      },
      {
        type: "log",
        payload: {
          level: "success",
          source: "opencode",
          message: "demo: done - Implement feature",
        },
      },
      {
        type: "notify",
        payload: {
          title: "Done: demo",
          body: "Implement feature",
        },
      },
      {
        type: "clearProgress",
      },
    ])
  })

  test("working status key and color are stable per cmux workspace/surface", async () => {
    const firstTab = new FakeCmuxClient({ workspaceID: "workspace:1", tabID: "tab:1", surfaceID: "surface:1" })
    const secondTab = new FakeCmuxClient({ workspaceID: "workspace:1", tabID: "tab:1", surfaceID: "surface:2" })
    const first = createCoordinator({
      primary: {
        id: "primary",
        title: "Build plugin",
        kind: "primary",
      },
    }, { cmux: firstTab })
    const second = createCoordinator({
      primary: {
        id: "primary",
        title: "Build plugin",
        kind: "primary",
      },
    }, { cmux: secondTab })

    await first.coordinator.handleSessionStatus("primary", "busy")
    await second.coordinator.handleSessionStatus("primary", "busy")

    const firstColor = primaryStatusColor(firstTab.calls)
    const secondColor = primaryStatusColor(secondTab.calls)

    expect(firstColor).toEqual(expect.any(String))
    expect(secondColor).toEqual(expect.any(String))
    expect(secondColor).not.toBe(firstColor)

    expect(firstTab.calls).toContainEqual(expect.objectContaining({
      type: "setStatus",
      key: "opencode:workspace-1-tab-1-surface-1",
    }))
    expect(secondTab.calls).toContainEqual(expect.objectContaining({
      type: "setStatus",
      key: "opencode:workspace-1-tab-1-surface-2",
    }))

    const firstTabAgain = new FakeCmuxClient({ workspaceID: "workspace:1", tabID: "tab:1", surfaceID: "surface:1" })
    const firstAgain = createCoordinator({
      primary: {
        id: "primary",
        title: "Build plugin",
        kind: "primary",
      },
    }, { cmux: firstTabAgain })

    await firstAgain.coordinator.handleSessionStatus("primary", "busy")

    expect(primaryStatusColor(firstTabAgain.calls)).toBe(firstColor)
  })

  test("status key fallback includes project and process when surface id is missing", async () => {
    const cmux = new FakeCmuxClient({
      workspaceID: "workspace:1",
      tabID: "tab:1",
      surfaceID: undefined,
    })
    const { coordinator } = createCoordinator({
      primary: {
        id: "primary",
        title: "Build plugin",
        kind: "primary",
      },
    }, { cmux, root: "/tmp/demo-app", label: "demo-app" })

    await coordinator.handleSessionStatus("primary", "busy")

    expect(cmux.calls).toContainEqual(expect.objectContaining({
      type: "setStatus",
      key: `opencode:workspace-1-tab-1-primary-demo-tmp-demo-app-pid-${process.pid}`,
    }))
  })

  test("subagent idle does not complete the primary session", async () => {
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
    cmux.reset()

    await coordinator.handleSessionStatus("subagent", "idle")
    await coordinator.flush()

    expect(cmux.calls.some((call) => call.type === "notify")).toBe(false)
    expect(
      cmux.calls.some(
        (call) => call.type === "setStatus" && call.payload.text === "done",
      ),
    ).toBe(false)
    expect(
      cmux.calls.some(
        (call) => call.type === "setProgress" && call.payload.label === "demo: done",
      ),
    ).toBe(false)
    expect(cmux.calls).toContainEqual({
      type: "setStatus",
      key: DEFAULT_LOCAL_STATUS_KEY,
      payload: {
        text: "working",
        icon: "terminal",
        color: expect.any(String),
      },
    })
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
      key: DEFAULT_LOCAL_STATUS_KEY,
      payload: {
        text: "working",
        icon: "terminal",
        color: expect.any(String),
      },
    })
    expect(cmux.calls).toContainEqual({
      type: "setStatus",
      key: DEFAULT_LOCAL_STATUS_KEY,
      payload: {
        text: "working - 1 subagent",
        icon: "terminal",
        color: expect.any(String),
      },
    })

    cmux.reset()
    await coordinator.handleQuestionAsked("Approve release note?", "primary")
    await coordinator.flush()

    expect(cmux.calls).toContainEqual({
      type: "setStatus",
      key: DEFAULT_LOCAL_STATUS_KEY,
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
        body: "Approve release note?",
      },
    })

    cmux.reset()
    await coordinator.handleQuestionResolved()
    await coordinator.flush()

    expect(cmux.calls).toContainEqual({
      type: "setStatus",
      key: DEFAULT_LOCAL_STATUS_KEY,
      payload: {
        text: "working - 1 subagent",
        icon: "terminal",
        color: expect.any(String),
      },
    })
  })

  test("tool started during busy session updates tab summary status", async () => {
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

    expect(cmux.calls).toContainEqual({
      type: "setStatus",
      key: DEFAULT_LOCAL_STATUS_KEY,
      payload: {
        text: "working - 1 tool",
        icon: "terminal",
        color: expect.any(String),
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

    // Tool count is folded back into the tab summary status.
    expect(cmux.calls).toContainEqual({
      type: "setStatus",
      key: DEFAULT_LOCAL_STATUS_KEY,
      payload: {
        text: "working",
        icon: "terminal",
        color: expect.any(String),
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

  test("primary idle clears active counts from the tab summary", async () => {
    const { coordinator, cmux } = createCoordinator({
      primary: {
        id: "primary",
        title: "Implement feature",
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
    await coordinator.handleToolStarted("bash", { command: "npm test" })
    await coordinator.handleTodoUpdated([
      { text: "Write tests", completed: false },
    ])
    await coordinator.flush()
    cmux.reset()

    await coordinator.handleSessionStatus("primary", "idle")
    await coordinator.flush()

    expect(cmux.calls).toContainEqual({
      type: "setStatus",
      key: DEFAULT_LOCAL_STATUS_KEY,
      payload: {
        text: "done",
        icon: "check-circle",
        color: "#22c55e",
      },
    })
  })

  test("multiple concurrent tools show count in tab summary status", async () => {
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
      key: DEFAULT_LOCAL_STATUS_KEY,
      payload: {
        text: "working - 3 tools",
        icon: "terminal",
        color: expect.any(String),
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

    // Should remove the active tool from the tab summary.
    expect(cmux.calls).toContainEqual({
      type: "setStatus",
      key: DEFAULT_LOCAL_STATUS_KEY,
      payload: {
        text: "working",
        icon: "terminal",
        color: expect.any(String),
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

    // Local tool activity should still mark this tab as working even if the
    // primary busy event has not arrived yet.
    expect(cmux.calls).toContainEqual({
      type: "setStatus",
      key: DEFAULT_LOCAL_STATUS_KEY,
      payload: {
        text: "working - 1 tool",
        icon: "terminal",
        color: expect.any(String),
      },
    })
  })

  test("subagent activity without primary busy still marks tab working", async () => {
    const { coordinator, cmux } = createCoordinator({
      subagent: {
        id: "subagent",
        title: "Write docs",
        parentID: "primary",
        kind: "subagent",
      },
    })

    await coordinator.handleSessionStatus("subagent", "busy")
    await coordinator.flush()

    expect(cmux.calls).toContainEqual({
      type: "setStatus",
      key: DEFAULT_LOCAL_STATUS_KEY,
      payload: {
        text: "working - 1 subagent",
        icon: "terminal",
        color: expect.any(String),
      },
    })
  })

  test("tool with subagent shows combined tab summary status", async () => {
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
      key: DEFAULT_LOCAL_STATUS_KEY,
      payload: {
        text: "working - 1 tool - 1 subagent",
        icon: "terminal",
        color: expect.any(String),
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
      key: DEFAULT_LOCAL_STATUS_KEY,
    })
  })

  test("session deleted clears primary state without clearing shared progress", async () => {
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

    // Progress is a shared cmux workspace resource, so local cleanup should not
    // clear it and risk wiping another OpenCode surface's live progress.
    expect(cmux.calls.some((call) => call.type === "clearProgress")).toBe(false)
  })

  test("local done timeout does not clear shared progress", async () => {
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

    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(cmux.calls).toContainEqual({
      type: "clearStatus",
      key: DEFAULT_LOCAL_STATUS_KEY,
    })
    expect(cmux.calls.some((call) => call.type === "clearProgress")).toBe(false)
  })

  test("local error transition does not clear shared progress", async () => {
    const { coordinator, cmux } = createCoordinator({
      primary: {
        id: "primary",
        title: "Build plugin",
        kind: "primary",
      },
    })

    await coordinator.handleSessionStatus("primary", "busy")
    await coordinator.flush()
    cmux.reset()

    await coordinator.handleSessionError("primary")
    await coordinator.flush()

    expect(cmux.calls).toContainEqual({
      type: "setStatus",
      key: DEFAULT_LOCAL_STATUS_KEY,
      payload: {
        text: "error",
        icon: "alert-circle",
        color: "#ef4444",
      },
    })
    expect(cmux.calls.some((call) => call.type === "clearProgress")).toBe(false)
  })

  test("primary completion clears progress after rendering 100 percent", async () => {
    const { coordinator, cmux } = createCoordinator({
      primary: {
        id: "primary",
        title: "Build plugin",
        kind: "primary",
      },
    })

    await coordinator.handleSessionStatus("primary", "busy")
    cmux.reset()

    await coordinator.handleSessionStatus("primary", "idle")
    await coordinator.flush()

    const progressIndex = cmux.calls.findIndex((call) => (
      call.type === "setProgress" && call.payload.value === 1
    ))
    const clearIndex = cmux.calls.findIndex((call) => call.type === "clearProgress")

    expect(progressIndex).toBeGreaterThanOrEqual(0)
    expect(clearIndex).toBeGreaterThan(progressIndex)
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

  test("todo updated no longer renders a separate todo status", async () => {
    const { coordinator, cmux } = createCoordinator({
      primary: {
        id: "primary",
        title: "Build plugin",
        kind: "primary",
      },
    })

    await coordinator.handleTodoUpdated([
      { text: "Write tests", completed: true },
      { text: "Fix bug", completed: true },
    ])

    expect(cmux.calls.some((c) => c.type === "setStatus")).toBe(false)
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

  test("todo updated with empty list does not render status changes", async () => {
    const { coordinator, cmux } = createCoordinator({
      primary: {
        id: "primary",
        title: "Build plugin",
        kind: "primary",
      },
    })

    await coordinator.handleTodoUpdated([
      { text: "Write tests", completed: false },
    ])
    await coordinator.flush()
    cmux.reset()

    await coordinator.handleTodoUpdated([])
    await coordinator.flush()

    expect(cmux.calls.some((c) => c.type === "clearStatus")).toBe(false)
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

    // Flush forces the deferred render. The tab summary is updated once with
    // the final tool count.
    await coordinator.flush()

    const statusCallsAfterFlush = cmux.calls.filter(
      (c) => c.type === "setStatus",
    ).length
    expect(statusCallsAfterFlush).toBe(statusCallsAfterFirst + 1)

    expect(cmux.calls).toContainEqual({
      type: "setStatus",
      key: DEFAULT_LOCAL_STATUS_KEY,
      payload: {
        text: "working - 3 tools",
        icon: "terminal",
        color: expect.any(String),
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
      key: DEFAULT_LOCAL_STATUS_KEY,
      payload: {
        text: "working",
        icon: "terminal",
        color: expect.any(String),
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
      key: DEFAULT_LOCAL_STATUS_KEY,
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
      key: DEFAULT_LOCAL_STATUS_KEY,
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
      key: DEFAULT_LOCAL_STATUS_KEY,
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
      key: DEFAULT_LOCAL_STATUS_KEY,
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
      key: DEFAULT_LOCAL_STATUS_KEY,
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
      key: DEFAULT_LOCAL_STATUS_KEY,
      payload: expect.objectContaining({
        text: expect.stringContaining("working"),
        icon: "terminal",
        color: expect.any(String),
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
      key: DEFAULT_LOCAL_STATUS_KEY,
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

  test("done timeout clears per-tab status after idle", async () => {
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
      key: DEFAULT_LOCAL_STATUS_KEY,
      payload: {
        text: "done",
        icon: "check-circle",
        color: "#22c55e",
      },
    })

    cmux.reset()

    // Wait for the done timer to fire
    await new Promise((resolve) => setTimeout(resolve, 100))

    // The per-tab status should now be cleared, but workspace progress is shared.
    expect(cmux.calls).toContainEqual({
      type: "clearStatus",
      key: DEFAULT_LOCAL_STATUS_KEY,
    })
    expect(cmux.calls.some((call) => call.type === "clearProgress")).toBe(false)

    await coordinator.dispose()
  })

  test("done timeout clears per-tab status created while done is visible", async () => {
    const { coordinator, cmux, config } = createCoordinator({
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

    config.doneTimeoutMs = 50

    await coordinator.handleSessionStatus("primary", "busy")
    await coordinator.handleSessionStatus("primary", "idle")
    await coordinator.handleSessionStatus("subagent", "busy")
    await coordinator.handleTodoUpdated([
      { text: "Document release", completed: false },
    ])
    await coordinator.flush()
    cmux.reset()

    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(cmux.calls).toContainEqual({
      type: "clearStatus",
      key: DEFAULT_LOCAL_STATUS_KEY,
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
      key: DEFAULT_LOCAL_STATUS_KEY,
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
      key: DEFAULT_LOCAL_STATUS_KEY,
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

    // Dispose should clear the primary status once immediately, and the
    // cancelled timer should not clear it again. Auxiliary status keys are also
    // cleared as part of cleanup.
    const clearCalls = cmux.calls.filter((c) => c.type === "clearStatus")
    expect(clearCalls.filter((c) => c.key === "opencode")).toHaveLength(1)
  })
})
