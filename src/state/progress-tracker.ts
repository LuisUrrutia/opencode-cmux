/**
 * Estimates session progress (0.0–1.0) based on observable signals:
 * tool call count, elapsed time, and todo completion.
 *
 * Progress never goes backwards — a high-water mark is maintained.
 */

/** Base progress value when a session first becomes busy. */
const BASE_PROGRESS = 0.1

/**
 * Maximum progress from the tool-call curve alone.
 * Combined with BASE_PROGRESS, the tool signal can push up to 0.70.
 */
const TOOL_WEIGHT = 0.6

/**
 * Steepness of the logarithmic tool-call curve.
 * Higher = progress ramps faster with fewer tool calls.
 */
const TOOL_STEEPNESS = 0.15

/** Maximum additional progress contributed by elapsed time. */
const TIME_WEIGHT = 0.1

/**
 * Half-life for time-based progress (ms).
 * After this many ms, the time contribution reaches ~50% of TIME_WEIGHT.
 */
const TIME_HALF_LIFE_MS = 120_000 // 2 minutes

/** How much todo completion can influence the estimate (0.0–1.0). */
const TODO_WEIGHT = 0.4

/** Floor for question/permission "waiting" states. */
const WAITING_FLOOR = 0.5

export type ActivityPhase = "working" | "waiting" | "idle"

export class ProgressTracker {
  private toolCalls = 0
  private startedAt?: number
  private todoTotal = 0
  private todoCompleted = 0
  private highWaterMark = 0

  /**
   * Mark the start of a busy session.
   * Call this when the primary session transitions to "busy".
   */
  start(): void {
    this.startedAt = Date.now()
  }

  /** Record that a tool call has completed (or started). */
  recordToolCall(): void {
    this.toolCalls++
  }

  /** Update the current todo state. */
  updateTodos(total: number, completed: number): void {
    this.todoTotal = total
    this.todoCompleted = completed
  }

  /**
   * Produce a progress estimate in the range [0.0, 1.0].
   *
   * @param phase - The current activity phase. "idle" always returns 1.0,
   *   "waiting" clamps the floor to WAITING_FLOOR.
   * @param now - Current timestamp (injectable for tests).
   */
  estimate(phase: ActivityPhase = "working", now: number = Date.now()): number {
    if (phase === "idle") return 1.0

    // Tool-call signal: logarithmic curve that flattens as calls increase.
    // 0 → 0.10, 5 → ~0.41, 10 → ~0.54, 20 → ~0.62, 50 → ~0.68
    const toolSignal =
      BASE_PROGRESS + TOOL_WEIGHT * (1 - 1 / (1 + this.toolCalls * TOOL_STEEPNESS))

    // Time signal: slow asymptotic ramp as a fallback for sessions with few
    // tool calls.  Uses an exponential decay toward TIME_WEIGHT.
    let timeSignal = 0
    if (this.startedAt !== undefined) {
      const elapsed = Math.max(0, now - this.startedAt)
      timeSignal = TIME_WEIGHT * (1 - Math.exp((-elapsed * Math.LN2) / TIME_HALF_LIFE_MS))
    }

    // Todo signal: linear interpolation of completion ratio.
    let todoSignal = 0
    if (this.todoTotal > 0) {
      todoSignal = TODO_WEIGHT * (this.todoCompleted / this.todoTotal)
    }

    // Blend: when todos are present they replace the time signal and partially
    // replace the tool signal.  When absent, tool + time dominate.
    let raw: number
    if (this.todoTotal > 0) {
      // Weighted blend: 50% tool, 50% todo (time is redundant when we have todos)
      raw = toolSignal * 0.5 + todoSignal + BASE_PROGRESS * 0.5
    } else {
      raw = toolSignal + timeSignal
    }

    // Clamp to [0, 0.95] — we never reach 1.0 while working.
    raw = Math.min(0.95, Math.max(0, raw))

    // Waiting states (question/permission) have a floor.
    if (phase === "waiting") {
      raw = Math.max(WAITING_FLOOR, raw)
    }

    // Enforce high-water mark: progress never goes backwards.
    if (raw > this.highWaterMark) {
      this.highWaterMark = raw
    }

    return this.highWaterMark
  }

  /** Reset all state. Call when the session goes idle or is deleted. */
  reset(): void {
    this.toolCalls = 0
    this.startedAt = undefined
    this.todoTotal = 0
    this.todoCompleted = 0
    this.highWaterMark = 0
  }
}
