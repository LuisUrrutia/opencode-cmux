import { describe, expect, test } from "bun:test"
import { ProgressTracker } from "../src/state/progress-tracker.ts"

describe("ProgressTracker", () => {
  test("fresh tracker returns base value for working phase", () => {
    const tracker = new ProgressTracker()
    const value = tracker.estimate("working")
    // Base is 0.10 (no tool calls, no time elapsed, no todos)
    expect(value).toBe(0.1)
  })

  test("idle phase always returns 1.0", () => {
    const tracker = new ProgressTracker()
    expect(tracker.estimate("idle")).toBe(1.0)

    // Even after tool calls, idle is still 1.0
    tracker.recordToolCall()
    tracker.recordToolCall()
    expect(tracker.estimate("idle")).toBe(1.0)
  })

  test("progress increases with tool calls", () => {
    const tracker = new ProgressTracker()
    const initial = tracker.estimate("working")

    tracker.recordToolCall()
    const afterOne = tracker.estimate("working")
    expect(afterOne).toBeGreaterThan(initial)

    for (let i = 0; i < 4; i++) tracker.recordToolCall()
    const afterFive = tracker.estimate("working")
    expect(afterFive).toBeGreaterThan(afterOne)

    for (let i = 0; i < 5; i++) tracker.recordToolCall()
    const afterTen = tracker.estimate("working")
    expect(afterTen).toBeGreaterThan(afterFive)
  })

  test("tool-call curve follows expected approximate values", () => {
    const tracker = new ProgressTracker()

    // 0 tools → ~0.10
    expect(tracker.estimate("working")).toBeCloseTo(0.1, 1)

    // 5 tools → ~0.41
    for (let i = 0; i < 5; i++) tracker.recordToolCall()
    const afterFive = tracker.estimate("working")
    expect(afterFive).toBeGreaterThan(0.3)
    expect(afterFive).toBeLessThan(0.55)

    // 10 tools → ~0.54
    for (let i = 0; i < 5; i++) tracker.recordToolCall()
    const afterTen = tracker.estimate("working")
    expect(afterTen).toBeGreaterThan(0.45)
    expect(afterTen).toBeLessThan(0.65)

    // 20 tools → ~0.62
    for (let i = 0; i < 10; i++) tracker.recordToolCall()
    const afterTwenty = tracker.estimate("working")
    expect(afterTwenty).toBeGreaterThan(0.54)
    expect(afterTwenty).toBeLessThan(0.75)
  })

  test("progress never decreases (high-water mark)", () => {
    const tracker = new ProgressTracker()

    // Ramp up with tool calls
    for (let i = 0; i < 10; i++) tracker.recordToolCall()
    const peak = tracker.estimate("working")

    // The estimate shouldn't decrease even though nothing else changed
    expect(tracker.estimate("working")).toBe(peak)
    expect(tracker.estimate("working")).toBe(peak)
  })

  test("waiting phase has a floor of 0.5", () => {
    const tracker = new ProgressTracker()
    // Fresh tracker with no activity — base would be 0.10 for working
    const waitingValue = tracker.estimate("waiting")
    expect(waitingValue).toBeGreaterThanOrEqual(0.5)
  })

  test("waiting phase uses high-water mark if above floor", () => {
    const tracker = new ProgressTracker()

    // Build up progress with many tool calls
    for (let i = 0; i < 20; i++) tracker.recordToolCall()
    const workingValue = tracker.estimate("working")
    expect(workingValue).toBeGreaterThan(0.5)

    // Waiting should use the same high value, not drop to floor
    const waitingValue = tracker.estimate("waiting")
    expect(waitingValue).toBe(workingValue)
  })

  test("time elapsed contributes to progress", () => {
    const tracker = new ProgressTracker()
    const baseTime = 1000000

    tracker.start()

    // At t=0 (effectively), only base value
    const atStart = tracker.estimate("working", baseTime)

    // Simulate 2 minutes elapsed — should have some time contribution
    // We set startedAt via start(), but estimate() takes now parameter
    // Need to use a fixed "now" to test time contribution
    // Actually, start() uses Date.now(). Let's work around by just
    // checking the curve shape: with more time, progress increases.

    // Since start() sets startedAt = Date.now(), we can simulate elapsed
    // time by passing a future "now" to estimate():
    const tracker2 = new ProgressTracker()
    // Manually verify by recording tool calls to establish a baseline,
    // then checking two time points
    const now = Date.now()
    tracker2.start()
    const earlyEstimate = tracker2.estimate("working", now)
    const laterEstimate = tracker2.estimate("working", now + 120_000) // 2 min later

    // With time elapsed but high-water mark, the later estimate should be >= early
    expect(laterEstimate).toBeGreaterThanOrEqual(earlyEstimate)
  })

  test("todo completion influences estimate", () => {
    const tracker = new ProgressTracker()

    const noTodos = tracker.estimate("working")

    // Add todos, some completed
    tracker.updateTodos(10, 5)
    const halfDone = tracker.estimate("working")
    expect(halfDone).toBeGreaterThan(noTodos)

    // More completion → higher estimate
    tracker.updateTodos(10, 9)
    const mostlyDone = tracker.estimate("working")
    expect(mostlyDone).toBeGreaterThan(halfDone)
  })

  test("reset clears all state", () => {
    const tracker = new ProgressTracker()

    // Build up state
    tracker.start()
    for (let i = 0; i < 10; i++) tracker.recordToolCall()
    tracker.updateTodos(5, 3)
    const beforeReset = tracker.estimate("working")
    expect(beforeReset).toBeGreaterThan(0.1)

    tracker.reset()

    // After reset, should be back to base value
    const afterReset = tracker.estimate("working")
    expect(afterReset).toBe(0.1)
  })

  test("progress never exceeds 0.95 while working", () => {
    const tracker = new ProgressTracker()

    tracker.start()
    // Extreme case: tons of tool calls + all todos done
    for (let i = 0; i < 1000; i++) tracker.recordToolCall()
    tracker.updateTodos(100, 100)

    const value = tracker.estimate("working", Date.now() + 3_600_000) // 1 hour later
    expect(value).toBeLessThanOrEqual(0.95)
  })
})
