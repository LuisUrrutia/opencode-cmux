import { describe, expect, test } from "bun:test"
import {
  describeToolCall,
  normalizeEvent,
  toRelativePath,
} from "../src/events.ts"

describe("describeToolCall", () => {
  test("returns tool name when no args provided", () => {
    expect(describeToolCall("bash")).toBe("bash")
    expect(describeToolCall("read")).toBe("read")
    expect(describeToolCall("unknown-tool")).toBe("unknown-tool")
  })

  test("bash: includes truncated command", () => {
    expect(describeToolCall("bash", { command: "npm test" })).toBe(
      "bash: npm test",
    )
    expect(describeToolCall("bash", { cmd: "git status" })).toBe(
      "bash: git status",
    )
  })

  test("bash: truncates long commands", () => {
    const longCommand = "a".repeat(80)
    const result = describeToolCall("bash", { command: longCommand })
    expect(result).toBe(`bash: ${"a".repeat(57)}...`)
    expect(result.length).toBeLessThanOrEqual(66) // "bash: " + 57 + "..."
  })

  test("bash: returns just 'bash' when no command arg", () => {
    expect(describeToolCall("bash", {})).toBe("bash")
    expect(describeToolCall("bash", { other: "value" })).toBe("bash")
  })

  test("edit/write/read: shows last path segments", () => {
    expect(
      describeToolCall("edit", { filePath: "/home/user/project/src/index.ts" }),
    ).toBe("edit: src/index.ts")

    expect(describeToolCall("write", { path: "src/foo.ts" })).toBe(
      "write: src/foo.ts",
    )

    expect(describeToolCall("read", { filePath: "README.md" })).toBe(
      "read: README.md",
    )
  })

  test("glob: includes pattern", () => {
    expect(describeToolCall("glob", { pattern: "**/*.ts" })).toBe(
      "glob: **/*.ts",
    )
    expect(describeToolCall("glob", {})).toBe("glob")
  })

  test("grep: includes pattern", () => {
    expect(describeToolCall("grep", { pattern: "TODO" })).toBe("grep: TODO")
    expect(describeToolCall("grep", { query: "fixme" })).toBe("grep: fixme")
    expect(describeToolCall("grep", {})).toBe("grep")
  })

  test("unknown tools return just the tool name", () => {
    expect(describeToolCall("custom-tool", { foo: "bar" })).toBe("custom-tool")
  })
})

describe("normalizeEvent", () => {
  test("normalizes session.status with nested status object", () => {
    const result = normalizeEvent({
      type: "session.status",
      properties: {
        sessionID: "abc",
        status: { type: "busy" },
      },
    })

    expect(result).toEqual({
      type: "session.status",
      sessionID: "abc",
      status: "busy",
    })
  })

  test("normalizes session.status with string status", () => {
    const result = normalizeEvent({
      type: "session.status",
      properties: {
        sessionID: "abc",
        status: "idle",
      },
    })

    expect(result).toEqual({
      type: "session.status",
      sessionID: "abc",
      status: "idle",
    })
  })

  test("returns null for session.status without sessionID", () => {
    expect(
      normalizeEvent({
        type: "session.status",
        properties: { status: "busy" },
      }),
    ).toBeNull()
  })

  test("normalizes session.idle", () => {
    const result = normalizeEvent({
      type: "session.idle",
      properties: { sessionID: "abc" },
    })

    expect(result).toEqual({ type: "session.idle", sessionID: "abc" })
  })

  test("normalizes session.error", () => {
    const result = normalizeEvent({
      type: "session.error",
      properties: { sessionID: "abc" },
    })

    expect(result).toEqual({ type: "session.error", sessionID: "abc" })
  })

  test("normalizes question.asked with header", () => {
    const result = normalizeEvent({
      type: "question.asked",
      properties: { header: "Approve?", sessionID: "abc" },
    })

    expect(result).toEqual({
      type: "question.asked",
      header: "Approve?",
      sessionID: "abc",
    })
  })

  test("normalizes question.asked with questions array", () => {
    const result = normalizeEvent({
      type: "question.asked",
      properties: {
        questions: [{ header: "Pick one" }],
      },
    })

    expect(result).toEqual({
      type: "question.asked",
      header: "Pick one",
      sessionID: undefined,
    })
  })

  test("returns null for question.asked with no header", () => {
    expect(
      normalizeEvent({
        type: "question.asked",
        properties: {},
      }),
    ).toBeNull()
  })

  test("normalizes question.replied to question.resolved", () => {
    expect(
      normalizeEvent({ type: "question.replied", properties: {} }),
    ).toEqual({ type: "question.resolved" })
  })

  test("normalizes permission.replied", () => {
    expect(
      normalizeEvent({ type: "permission.replied", properties: {} }),
    ).toEqual({ type: "permission.replied" })
  })

  test("returns null for unknown event types", () => {
    expect(normalizeEvent({ type: "unknown.event", properties: {} })).toBeNull()
  })

  test("normalizes file.edited with filePath", () => {
    const result = normalizeEvent({
      type: "file.edited",
      properties: { filePath: "/tmp/demo/src/index.ts", sessionID: "abc" },
    })

    expect(result).toEqual({
      type: "file.edited",
      filePath: "/tmp/demo/src/index.ts",
      sessionID: "abc",
    })
  })

  test("normalizes file.edited with path alias", () => {
    const result = normalizeEvent({
      type: "file.edited",
      properties: { path: "src/foo.ts" },
    })

    expect(result).toEqual({
      type: "file.edited",
      filePath: "src/foo.ts",
      sessionID: undefined,
    })
  })

  test("returns null for file.edited without filePath", () => {
    expect(
      normalizeEvent({ type: "file.edited", properties: {} }),
    ).toBeNull()
  })

  test("normalizes session.created", () => {
    const result = normalizeEvent({
      type: "session.created",
      properties: { sessionID: "abc" },
    })
    expect(result).toEqual({ type: "session.created", sessionID: "abc" })
  })

  test("returns null for session.created without sessionID", () => {
    expect(
      normalizeEvent({ type: "session.created", properties: {} }),
    ).toBeNull()
  })

  test("normalizes session.deleted", () => {
    const result = normalizeEvent({
      type: "session.deleted",
      properties: { sessionID: "abc" },
    })
    expect(result).toEqual({ type: "session.deleted", sessionID: "abc" })
  })

  test("returns null for session.deleted without sessionID", () => {
    expect(
      normalizeEvent({ type: "session.deleted", properties: {} }),
    ).toBeNull()
  })

  test("normalizes session.compacted", () => {
    const result = normalizeEvent({
      type: "session.compacted",
      properties: { sessionID: "abc" },
    })
    expect(result).toEqual({ type: "session.compacted", sessionID: "abc" })
  })

  test("returns null for session.compacted without sessionID", () => {
    expect(
      normalizeEvent({ type: "session.compacted", properties: {} }),
    ).toBeNull()
  })

  test("normalizes todo.updated with items", () => {
    const result = normalizeEvent({
      type: "todo.updated",
      properties: {
        items: [
          { text: "Write tests", completed: true },
          { text: "Fix bug", completed: false },
        ],
      },
    })

    expect(result).toEqual({
      type: "todo.updated",
      items: [
        { text: "Write tests", completed: true },
        { text: "Fix bug", completed: false },
      ],
    })
  })

  test("normalizes todo.updated with 'todos' key alias", () => {
    const result = normalizeEvent({
      type: "todo.updated",
      properties: {
        todos: [{ content: "Deploy", done: true }],
      },
    })

    expect(result).toEqual({
      type: "todo.updated",
      items: [{ text: "Deploy", completed: true }],
    })
  })

  test("normalizes todo.updated with 'status' completed variant", () => {
    const result = normalizeEvent({
      type: "todo.updated",
      properties: {
        items: [{ text: "Ship it", status: "completed" }],
      },
    })

    expect(result).toEqual({
      type: "todo.updated",
      items: [{ text: "Ship it", completed: true }],
    })
  })

  test("normalizes todo.updated with empty/missing items to empty array", () => {
    expect(
      normalizeEvent({ type: "todo.updated", properties: {} }),
    ).toEqual({ type: "todo.updated", items: [] })

    expect(
      normalizeEvent({ type: "todo.updated", properties: { items: [] } }),
    ).toEqual({ type: "todo.updated", items: [] })
  })

  test("normalizes todo.updated skips malformed items", () => {
    const result = normalizeEvent({
      type: "todo.updated",
      properties: {
        items: [
          { text: "Valid", completed: false },
          "not-an-object",
          { noTextProperty: true },
          null,
          { text: "Also valid", completed: true },
        ],
      },
    })

    expect(result).toEqual({
      type: "todo.updated",
      items: [
        { text: "Valid", completed: false },
        { text: "Also valid", completed: true },
      ],
    })
  })
})

describe("toRelativePath", () => {
  test("strips project root prefix", () => {
    expect(toRelativePath("/tmp/demo/src/index.ts", "/tmp/demo")).toBe(
      "src/index.ts",
    )
  })

  test("strips project root with trailing slash", () => {
    expect(toRelativePath("/tmp/demo/src/index.ts", "/tmp/demo/")).toBe(
      "src/index.ts",
    )
  })

  test("returns original path when root doesn't match", () => {
    expect(toRelativePath("/other/path/file.ts", "/tmp/demo")).toBe(
      "/other/path/file.ts",
    )
  })

  test("returns original path when no root provided", () => {
    expect(toRelativePath("/tmp/demo/src/index.ts")).toBe(
      "/tmp/demo/src/index.ts",
    )
    expect(toRelativePath("/tmp/demo/src/index.ts", undefined)).toBe(
      "/tmp/demo/src/index.ts",
    )
  })

  test("handles already-relative paths", () => {
    expect(toRelativePath("src/index.ts", "/tmp/demo")).toBe("src/index.ts")
  })
})
