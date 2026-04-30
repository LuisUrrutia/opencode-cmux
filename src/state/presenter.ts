import type { PluginConfig } from "../config.js"
import { describeToolCall, toRelativePath, type TodoItem } from "../events.js"
import { detectGitInfo, isGitCommand } from "../features/git.js"
import type {
  CmuxClient,
  PluginLogger,
  SessionMetadata,
  SessionResolver,
} from "../types.js"
import type { ProjectContext } from "./project-context.js"
import { ProgressTracker } from "./progress-tracker.js"
import {
  formatSessionLabel,
  getBusySubagentCount,
  type SessionActivity,
  type SessionRuntime,
} from "./session-state.js"

interface CoordinatorOptions {
  cmux: CmuxClient
  config: PluginConfig
  logger: PluginLogger
  project: ProjectContext
  sessionResolver: SessionResolver
}

interface PresentationSnapshot {
  status?: {
    text: string
    icon: string
    color: string
  }
  progress?: {
    value: number
    label: string
  }
}

interface QuestionState {
  header: string
  sessionID?: string
}

interface PermissionState {
  title: string
}

interface ActiveTool {
  tool: string
  startedAt: number
  args?: Record<string, unknown>
}

/** Minimum interval (ms) between sidebar logs for the same file. */
const FILE_EDIT_DEBOUNCE_MS = 500

/** Maximum number of recently edited files to track. */
const MAX_RECENT_FILES = 10

/** Minimum interval (ms) between render() calls to cmux. */
const RENDER_THROTTLE_MS = 200

/** Maximum sidebar log calls per second. */
const LOG_RATE_LIMIT = 5

/** Window size (ms) for the log rate limiter. */
const LOG_RATE_WINDOW_MS = 1000

export class CmuxStateCoordinator {
  private readonly sessions = new Map<string, SessionRuntime>()
  private primaryState?: SessionRuntime
  private pendingQuestion?: QuestionState
  private pendingPermission?: PermissionState
  private currentSnapshot: PresentationSnapshot = {}
  private readonly activeTools = new Map<string, ActiveTool>()
  private toolCallCount = 0
  private readonly recentFiles: string[] = []
  private readonly lastFileEditAt = new Map<string, number>()
  private todoState?: { total: number; completed: number }
  private readonly progressTracker = new ProgressTracker()

  /** Render throttle state */
  private lastRenderAt = 0
  private renderTimer?: ReturnType<typeof setTimeout>
  private renderPending = false

  /** Sidebar log rate limiter — timestamps of recent log calls */
  private readonly logTimestamps: number[] = []

  /** Stale session watchdog */
  private lastEventAt = 0
  private staleTimer?: ReturnType<typeof setTimeout>

  /** Done status auto-clear timer */
  private doneTimer?: ReturnType<typeof setTimeout>

  public constructor(private readonly options: CoordinatorOptions) {}

  public async initialize(): Promise<void> {
    await this.clearPresentationBestEffort()
  }

  public async cleanup(): Promise<void> {
    await this.flush()
    this.primaryState = undefined
    this.pendingQuestion = undefined
    this.pendingPermission = undefined
    this.activeTools.clear()
    this.todoState = undefined
    this.progressTracker.reset()
    if (this.staleTimer) {
      clearTimeout(this.staleTimer)
      this.staleTimer = undefined
    }
    if (this.doneTimer) {
      clearTimeout(this.doneTimer)
      this.doneTimer = undefined
    }
    await this.clearPresentationBestEffort()
    this.currentSnapshot = {}
  }

  /** Call this from every public handler to keep the watchdog alive. */
  private touchEventTimestamp(): void {
    this.lastEventAt = Date.now()
    this.resetStaleTimer()
  }

  public async handleSessionStatus(
    sessionID: string,
    status: string,
  ): Promise<void> {
    this.touchEventTimestamp()
    if (status === "busy") {
      await this.markBusy(sessionID)
      return
    }

    if (status === "idle") {
      await this.markIdle(sessionID)
    }
  }

  public async handleSessionIdle(sessionID: string): Promise<void> {
    this.touchEventTimestamp()
    await this.markIdle(sessionID)
  }

  public async handleSessionError(sessionID?: string): Promise<void> {
    this.touchEventTimestamp()
    const metadata = await this.resolveSession(sessionID ?? "unknown-session", true)
    if (!metadata) return

    this.setSessionActivity(metadata, "error")
    this.primaryState = metadata.kind === "primary" ? this.sessions.get(metadata.id) : this.primaryState

    if (metadata.kind === "primary") {
      this.pendingPermission = undefined
      this.pendingQuestion = undefined
      await this.options.cmux.notify({
        title: `Error: ${this.options.project.label}`,
        body: formatSessionLabel(metadata),
      })
    } else if (this.options.config.notifySubagents) {
      await this.options.cmux.notify({
        title: `Subagent error: ${this.options.project.label}`,
        body: formatSessionLabel(metadata),
      })
    }

    await this.throttledLog({
      level: "error",
      source: "opencode",
      message: `${this.options.project.label}: error in ${formatSessionLabel(metadata)}`,
    })

    await this.render()
  }

  public async handleQuestionAsked(
    header: string,
    sessionID?: string,
  ): Promise<void> {
    this.touchEventTimestamp()
    const nextQuestion = { header, sessionID }
    if (
      this.pendingQuestion?.header === nextQuestion.header &&
      this.pendingQuestion?.sessionID === nextQuestion.sessionID
    ) {
      return
    }

    this.pendingQuestion = nextQuestion

    await this.throttledLog({
      level: "info",
      source: "opencode",
      message: `${this.options.project.label}: question - ${header}`,
    })

    if (this.options.config.notifyQuestions) {
      await this.options.cmux.notify({
        title: `Question: ${this.options.project.label}`,
        subtitle: header,
      })
    }

    await this.render()
  }

  public async handleQuestionResolved(): Promise<void> {
    this.touchEventTimestamp()
    if (!this.pendingQuestion) return
    this.pendingQuestion = undefined
    await this.render()
  }

  public async handlePermissionAsked(title: string): Promise<void> {
    this.touchEventTimestamp()
    if (this.pendingPermission?.title === title) return

    this.pendingPermission = { title }

    await this.throttledLog({
      level: "warning",
      source: "opencode",
      message: `${this.options.project.label}: waiting for permission - ${title}`,
    })

    if (this.options.config.notifyPermissions) {
      await this.options.cmux.notify({
        title: `Permission needed: ${this.options.project.label}`,
        subtitle: title,
      })
    }

    await this.render()
  }

  public async handlePermissionResolved(): Promise<void> {
    this.touchEventTimestamp()
    if (!this.pendingPermission) return
    this.pendingPermission = undefined
    await this.render()
  }

  public async handleToolStarted(
    tool: string,
    args?: Record<string, unknown>,
  ): Promise<void> {
    this.touchEventTimestamp()
    await this.clearNotificationsBestEffort()
    const callID = `${tool}-${++this.toolCallCount}`
    this.activeTools.set(callID, {
      tool,
      startedAt: Date.now(),
      args,
    })
    this.progressTracker.recordToolCall()

    if (this.options.config.logToolCalls) {
      const label = describeToolCall(tool, args)
      const verbose = this.options.config.logToolCallsVerbose && args
        ? ` ${JSON.stringify(args)}`
        : ""
      await this.throttledLog({
        level: "progress",
        source: "opencode",
        message: `${this.options.project.label}: running ${label}${verbose}`,
      })
    }

    await this.render()
  }

  public async handleToolCompleted(
    tool: string,
    args?: Record<string, unknown>,
  ): Promise<void> {
    this.touchEventTimestamp()
    // Remove the oldest matching active tool entry
    for (const [callID, active] of this.activeTools) {
      if (active.tool === tool) {
        this.activeTools.delete(callID)
        break
      }
    }

    if (this.options.config.logToolCalls) {
      const label = describeToolCall(tool, args)
      const verbose = this.options.config.logToolCallsVerbose && args
        ? ` ${JSON.stringify(args)}`
        : ""
      await this.throttledLog({
        level: "info",
        source: "opencode",
        message: `${this.options.project.label}: finished ${label}${verbose}`,
      })
    }

    await this.refreshGitStateIfNeeded(tool, args)

    await this.render()
  }

  public async handleFileEdited(filePath: string, _sessionID?: string): Promise<void> {
    this.touchEventTimestamp()
    const relative = toRelativePath(filePath, this.options.project.root)

    // Debounce: skip if we logged the same file very recently
    const now = Date.now()
    const lastEdit = this.lastFileEditAt.get(relative)
    if (lastEdit !== undefined && now - lastEdit < FILE_EDIT_DEBOUNCE_MS) {
      return
    }
    this.lastFileEditAt.set(relative, now)

    // Maintain ring buffer of recently edited files
    const existingIndex = this.recentFiles.indexOf(relative)
    if (existingIndex !== -1) {
      this.recentFiles.splice(existingIndex, 1)
    }
    this.recentFiles.push(relative)
    if (this.recentFiles.length > MAX_RECENT_FILES) {
      const evicted = this.recentFiles.shift()
      if (evicted !== undefined) this.lastFileEditAt.delete(evicted)
    }

    if (this.options.config.logFileEdits) {
      await this.throttledLog({
        level: "progress",
        source: "opencode",
        message: `${this.options.project.label}: edited ${relative}`,
      })
    }
  }

  public async handleSessionCreated(sessionID: string): Promise<void> {
    this.touchEventTimestamp()
    // Eagerly resolve and cache session metadata so subsequent events are faster
    const metadata = await this.resolveSession(sessionID, true)
    if (metadata?.kind === "primary") {
      await this.clearPresentationBestEffort()
      this.currentSnapshot = {}
    } else {
      await this.clearNotificationsBestEffort()
    }

    if (this.options.config.logSessionLifecycle) {
      const label = metadata ? formatSessionLabel(metadata) : sessionID
      await this.throttledLog({
        level: "info",
        source: "opencode",
        message: `${this.options.project.label}: session started - ${label}`,
      })
    }
  }

  public async handleSessionUpdated(sessionID: string): Promise<void> {
    this.touchEventTimestamp()
    const metadata = await this.resolveSession(sessionID, true)
    if (!metadata) return

    const existing = this.sessions.get(sessionID)
    if (existing) {
      this.setSessionActivity(metadata, existing.activity)
      if (metadata.kind === "primary") {
        this.primaryState = this.sessions.get(sessionID)
        if (existing.activity === "busy" && this.options.config.logSessionLifecycle) {
          await this.clearLogBestEffort()
          await this.throttledLog({
            level: "progress",
            source: "opencode",
            message: `${this.options.project.label}: working on ${formatSessionLabel(metadata)}`,
          })
        }
      }
      await this.render()
    }
  }

  public async handleSessionDeleted(sessionID: string): Promise<void> {
    this.touchEventTimestamp()
    const existing = this.sessions.get(sessionID)
    const metadata = await this.resolveSession(sessionID, true) ?? existing?.metadata
    this.sessions.delete(sessionID)

    // If the deleted session was the primary, clear primary state
    if (metadata?.kind === "primary") {
      this.primaryState = undefined
      this.pendingQuestion = undefined
      this.pendingPermission = undefined
      this.activeTools.clear()
      this.todoState = undefined
      this.progressTracker.reset()
      if (this.doneTimer) {
        clearTimeout(this.doneTimer)
        this.doneTimer = undefined
      }
    }

    if (this.options.config.logSessionLifecycle) {
      const label = metadata
        ? formatSessionLabel(metadata)
        : sessionID
      await this.throttledLog({
        level: "info",
        source: "opencode",
        message: `${this.options.project.label}: session deleted - ${label}`,
      })
    }

    if (metadata?.kind === "primary") {
      await this.cleanup()
      return
    }

    await this.render()
  }

  public async handleSessionCompacted(sessionID: string): Promise<void> {
    this.touchEventTimestamp()
    if (this.options.config.logSessionLifecycle) {
      const metadata = await this.resolveSession(sessionID, true)
      const label = metadata ? formatSessionLabel(metadata) : sessionID
      await this.throttledLog({
        level: "info",
        source: "opencode",
        message: `${this.options.project.label}: session compacted - ${label}`,
      })
    }
  }

  public async handleTodoUpdated(items: TodoItem[]): Promise<void> {
    this.touchEventTimestamp()
    const total = items.length
    const completed = items.filter((item) => item.completed).length
    this.todoState = { total, completed }
    this.progressTracker.updateTodos(total, completed)

    if (this.options.config.logTodos) {
      await this.throttledLog({
        level: "progress",
        source: "opencode",
        message: `${this.options.project.label}: todos: ${completed}/${total} complete`,
      })
    }
  }

  public async syncGitState(): Promise<void> {
    if (!this.options.config.gitIntegration) return
    const root = this.options.project.root
    if (!root) return

    try {
      const gitInfo = detectGitInfo(root)
      if (!gitInfo.branch) return
      await this.options.cmux.reportGitBranch(gitInfo.branch, gitInfo.dirty)
    } catch {
      // Best effort only.
    }
  }

  private async markBusy(sessionID: string): Promise<void> {
    const metadata = await this.resolveSession(sessionID, true)
    if (!metadata) return

    const previous = this.sessions.get(sessionID)
    this.setSessionActivity(metadata, "busy")

    if (metadata.kind === "primary") {
      this.primaryState = this.sessions.get(sessionID)
      this.resetStaleTimer()
      if (this.doneTimer) {
        clearTimeout(this.doneTimer)
        this.doneTimer = undefined
      }
      if (previous?.activity !== "busy") {
        this.progressTracker.start()
        await this.throttledLog({
          level: "progress",
          source: "opencode",
          message: `${this.options.project.label}: working on ${formatSessionLabel(metadata)}`,
        })
      }
    } else if (this.options.config.logSubagents && previous?.activity !== "busy") {
      await this.throttledLog({
        level: "info",
        source: "opencode",
        message: `${this.options.project.label}: subagent started - ${formatSessionLabel(metadata)}`,
      })
    }

    await this.render()
  }

  private async markIdle(sessionID: string): Promise<void> {
    const metadata = await this.resolveSession(sessionID, true)
    if (!metadata) return

    const previous = this.sessions.get(sessionID)
    this.setSessionActivity(metadata, "idle")

    if (metadata.kind === "primary") {
      this.primaryState = this.sessions.get(sessionID)
      this.pendingPermission = undefined
      if (this.pendingQuestion?.sessionID === undefined || this.pendingQuestion?.sessionID === sessionID) {
        this.pendingQuestion = undefined
      }

      if (previous?.activity === "busy") {
        this.progressTracker.reset()
        await this.throttledLog({
          level: "success",
          source: "opencode",
          message: `${this.options.project.label}: done - ${formatSessionLabel(metadata)}`,
        })
        await this.options.cmux.notify({
          title: `Done: ${this.options.project.label}`,
          body: formatSessionLabel(metadata),
        })
      }
    } else {
      if (this.options.config.logSubagents && previous?.activity === "busy") {
        await this.throttledLog({
          level: "success",
          source: "opencode",
          message: `${this.options.project.label}: subagent finished - ${formatSessionLabel(metadata)}`,
        })
      }

      if (this.options.config.notifySubagents && previous?.activity === "busy") {
        await this.options.cmux.notify({
          title: `Subagent done: ${this.options.project.label}`,
          body: formatSessionLabel(metadata),
        })
      }
    }

    await this.render()
    this.resetDoneTimer()
  }

  private async resolveSession(
    sessionID: string,
    fresh = false,
  ): Promise<SessionMetadata | null> {
    return this.options.sessionResolver.getSessionMetadata(sessionID, { fresh })
  }

  private async clearNotificationsBestEffort(): Promise<void> {
    try {
      await this.options.cmux.clearNotifications()
    } catch {
      // Best effort only.
    }
  }

  private async clearLogBestEffort(): Promise<void> {
    try {
      await this.options.cmux.clearLog()
    } catch {
      // Best effort only.
    }
  }

  private async clearPresentationBestEffort(): Promise<void> {
    await Promise.allSettled([
      this.options.cmux.clearNotifications(),
      this.options.cmux.clearStatus(this.options.config.statusKey),
      this.options.cmux.clearProgress(),
      this.options.cmux.clearLog(),
    ])
  }

  private async refreshGitStateIfNeeded(
    tool: string,
    args?: Record<string, unknown>,
  ): Promise<void> {
    if (tool !== "bash") return
    if (!this.options.config.gitIntegration) return

    const command = this.extractBashCommand(args)
    if (!command || !isGitCommand(command)) return

    await this.syncGitState()
  }

  private extractBashCommand(args?: Record<string, unknown>): string | undefined {
    if (!args) return undefined
    const command = args.command
    if (typeof command === "string" && command.trim()) return command
    const cmd = args.cmd
    if (typeof cmd === "string" && cmd.trim()) return cmd
    return undefined
  }

  /**
   * Pick the most relevant active tool to display in the status pill.
   * Returns e.g. "bash" for a single tool, "2 tools" for multiple,
   * or undefined if no tools are active.
   */
  private describeToolActivity(): string | undefined {
    if (this.activeTools.size === 0) return undefined
    if (this.activeTools.size === 1) {
      const [active] = this.activeTools.values()
      return active.tool
    }

    return `${this.activeTools.size} tools`
  }

  private setSessionActivity(
    metadata: SessionMetadata,
    activity: SessionActivity,
  ): void {
    this.sessions.set(metadata.id, {
      metadata,
      activity,
    })
  }

  /**
   * Builds the next presentation snapshot by evaluating state in priority order.
   *
   * Priority (highest to lowest):
   * 1. Permission pending → show "waiting" with lock icon (#ef4444)
   * 2. Question pending → show "question" with help-circle icon (#a855f7)
   * 3. Session busy → show "working: <tool>" with terminal icon (#f59e0b)
   * 4. Session error → show "error" with alert-circle icon (#ef4444)
   * 5. Session idle (keepDoneStatus) → show "done" with check-circle icon (#22c55e)
   *
   * Progress bar is independent of status — it tracks estimated completion
   * when the session is busy/waiting and clears when idle/error/done.
   *
   * IMPORTANT: Changes to this priority order affect all sidebar behavior.
   * Update AGENTS.md if the priority changes.
   */
  private buildSnapshot(): PresentationSnapshot {
    const subagentCount = getBusySubagentCount(this.sessions.values())

    if (this.pendingPermission) {
      return {
        status: {
          text: "waiting",
          icon: "lock",
          color: "#ef4444",
        },
        progress: this.options.config.progressEnabled
          ? {
              value: this.progressTracker.estimate("waiting"),
              label: `${this.options.project.label}: ${this.pendingPermission.title}`,
            }
          : undefined,
      }
    }

    if (this.pendingQuestion) {
      return {
        status: {
          text: "question",
          icon: "help-circle",
          color: "#a855f7",
        },
        progress: this.options.config.progressEnabled
          ? {
              value: this.progressTracker.estimate("waiting"),
              label: `${this.options.project.label}: ${this.pendingQuestion.header}`,
            }
          : undefined,
      }
    }

    if (this.primaryState?.activity === "busy") {
      const toolSuffix = this.describeToolActivity()
      const subagentSuffix =
        subagentCount > 0
          ? ` · ${subagentCount} subagent${subagentCount === 1 ? "" : "s"}`
          : ""

      const statusText = toolSuffix
        ? `working: ${toolSuffix}${subagentSuffix}`
        : `working${subagentSuffix}`

      const todoSuffix =
        this.todoState && this.todoState.total > 0
          ? ` · ${this.todoState.completed}/${this.todoState.total} todos`
          : ""

      return {
        status: {
          text: statusText,
          icon: "terminal",
          color: "#f59e0b",
        },
        progress: this.options.config.progressEnabled
          ? {
              value: this.progressTracker.estimate("working"),
              label: `${this.options.project.label}: ${formatSessionLabel(this.primaryState.metadata)}${todoSuffix}`,
            }
          : undefined,
      }
    }

    if (this.primaryState?.activity === "error") {
      return {
        status: {
          text: "error",
          icon: "alert-circle",
          color: "#ef4444",
        },
      }
    }

    if (this.primaryState?.activity === "idle" && this.options.config.keepDoneStatus) {
      return {
        status: {
          text: "done",
          icon: "check-circle",
          color: "#22c55e",
        },
        progress: this.options.config.progressEnabled
          ? {
              value: this.progressTracker.estimate("idle"),
              label: `${this.options.project.label}: done`,
            }
          : undefined,
      }
    }

    return {}
  }

  private async render(): Promise<void> {
    const now = Date.now()
    const elapsed = now - this.lastRenderAt

    if (elapsed >= RENDER_THROTTLE_MS) {
      // Enough time has passed — render immediately
      await this.renderNow()
    } else if (!this.renderPending) {
      // Schedule a deferred render
      this.renderPending = true
      this.renderTimer = setTimeout(async () => {
        try {
          this.renderPending = false
          this.renderTimer = undefined
          await this.renderNow()
        } catch (err) {
          this.renderPending = false
          this.renderTimer = undefined
          this.options.logger.log("error", `Deferred render failed: ${err}`)
        }
      }, RENDER_THROTTLE_MS - elapsed)
    }
    // If renderPending is already true, do nothing — the timer will pick up the latest state
  }

  private async renderNow(): Promise<void> {
    this.lastRenderAt = Date.now()
    const next = this.buildSnapshot()
    await this.applyStatus(next)
    await this.applyProgress(next)
    this.currentSnapshot = next
  }

  /**
   * Rate-limited sidebar log. Drops messages that exceed the rate limit.
   * Returns true if the message was sent, false if it was rate-limited.
   */
  private async throttledLog(payload: Parameters<CmuxClient["log"]>[0]): Promise<boolean> {
    const now = Date.now()
    const cutoff = now - LOG_RATE_WINDOW_MS

    // Evict old timestamps
    while (this.logTimestamps.length > 0 && this.logTimestamps[0] <= cutoff) {
      this.logTimestamps.shift()
    }

    if (this.logTimestamps.length >= LOG_RATE_LIMIT) {
      return false
    }

    this.logTimestamps.push(now)
    await this.options.cmux.log(payload)
    return true
  }

  /**
   * Stale session watchdog. If enabled and the primary session is busy,
   * clears stuck "working" state after the configured timeout.
   */
  private resetStaleTimer(): void {
    if (this.staleTimer) {
      clearTimeout(this.staleTimer)
      this.staleTimer = undefined
    }

    const timeoutMs = this.options.config.staleSessionTimeoutMs
    if (!timeoutMs || timeoutMs <= 0) return
    if (this.primaryState?.activity !== "busy") return

    this.staleTimer = setTimeout(async () => {
      try {
        // Only act if the primary session is still busy and no events have arrived
        if (
          this.primaryState?.activity === "busy" &&
          Date.now() - this.lastEventAt >= timeoutMs
        ) {
          const metadata = this.primaryState.metadata
          this.setSessionActivity(metadata, "idle")
          this.primaryState = this.sessions.get(metadata.id)
          this.pendingQuestion = undefined
          this.pendingPermission = undefined
          this.progressTracker.reset()

          await this.options.cmux.log({
            level: "warning",
            source: "opencode",
            message: `${this.options.project.label}: stale session cleared - ${formatSessionLabel(metadata)} (no events for ${Math.round(timeoutMs / 1000)}s)`,
          })

          await this.renderNow()
        }
      } catch (err) {
        this.options.logger.log("error", `Stale session timer failed: ${err}`)
      }
    }, timeoutMs)
  }

  /**
   * Done status auto-clear. When the primary session is idle and
   * `keepDoneStatus` is true, arms a timer that clears the sidebar
   * after `doneTimeoutMs`. Skipped when `keepDoneStatus` is false
   * (sidebar is already cleared immediately) or `doneTimeoutMs` is 0.
   */
  private resetDoneTimer(): void {
    if (this.doneTimer) {
      clearTimeout(this.doneTimer)
      this.doneTimer = undefined
    }

    const timeoutMs = this.options.config.doneTimeoutMs
    if (!timeoutMs || timeoutMs <= 0) return
    if (!this.options.config.keepDoneStatus) return
    if (this.primaryState?.activity !== "idle") return

    this.doneTimer = setTimeout(async () => {
      try {
        // Guard: only clear if primary is still idle
        if (this.primaryState?.activity === "idle") {
          this.primaryState = undefined
          this.progressTracker.reset()
          await this.renderNow()
        }
      } catch (err) {
        this.options.logger.log("error", `Done timer failed: ${err}`)
      }
    }, timeoutMs)
  }

  /**
   * Immediately execute any pending deferred render.
   * Useful for cleanup and for tests that need to assert after rapid state changes.
   */
  public async flush(): Promise<void> {
    if (this.renderPending && this.renderTimer) {
      clearTimeout(this.renderTimer)
      this.renderTimer = undefined
      this.renderPending = false
      await this.renderNow()
    }
  }

  /**
   * Cancel pending timers and flush any queued render.
   *
   * Note: OpenCode's plugin API does not expose a shutdown/dispose lifecycle
   * hook, so this method cannot be called automatically when the host process
   * exits. All timers are one-shot `setTimeout`s wrapped in try/catch (see
   * Phase 2a), so they are harmless if they fire after shutdown. This method
   * exists primarily for deterministic cleanup in tests.
   */
  public async dispose(): Promise<void> {
    await this.cleanup()
  }

  private async applyStatus(next: PresentationSnapshot): Promise<void> {
    const currentStatus = this.currentSnapshot.status
    const nextStatus = next.status

    if (!nextStatus) {
      if (currentStatus) {
        await this.options.cmux.clearStatus(this.options.config.statusKey)
      }
      return
    }

    if (
      currentStatus?.text === nextStatus.text &&
      currentStatus.icon === nextStatus.icon &&
      currentStatus.color === nextStatus.color
    ) {
      return
    }

    await this.options.cmux.setStatus(this.options.config.statusKey, nextStatus)
  }

  private async applyProgress(next: PresentationSnapshot): Promise<void> {
    const currentProgress = this.currentSnapshot.progress
    const nextProgress = next.progress

    if (!nextProgress) {
      if (currentProgress) {
        await this.options.cmux.clearProgress()
      }
      return
    }

    if (
      currentProgress?.value === nextProgress.value &&
      currentProgress.label === nextProgress.label
    ) {
      return
    }

    await this.options.cmux.setProgress(nextProgress)
  }
}
