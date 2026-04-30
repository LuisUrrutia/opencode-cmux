import type { UnknownEvent } from "./types.js"

export type NormalizedEvent =
  | { type: "session.status"; sessionID: string; status: string }
  | { type: "session.idle"; sessionID: string }
  | { type: "session.error"; sessionID?: string }
  | { type: "question.asked"; sessionID?: string; header: string }
  | { type: "question.resolved" }
  | { type: "permission.replied" }
  | { type: "file.edited"; filePath: string; sessionID?: string }
  | { type: "session.created"; sessionID: string }
  | { type: "session.updated"; sessionID: string }
  | { type: "session.deleted"; sessionID: string }
  | { type: "session.compacted"; sessionID: string }
  | { type: "todo.updated"; items: TodoItem[] }

export interface TodoItem {
  text: string
  completed: boolean
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined
}

function getString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === "string" && value.trim()) {
      return value.trim()
    }
  }

  return undefined
}

function readSessionID(properties: Record<string, unknown>): string | undefined {
  const direct = getString(properties, ["sessionID", "sessionId", "id"])
  if (direct) return direct

  for (const key of ["session", "info", "data"]) {
    const record = asRecord(properties[key])
    if (!record) continue
    const nested = getString(record, ["sessionID", "sessionId", "id"])
    if (nested) return nested
  }

  return undefined
}

/**
 * Build a short human-readable label for a tool invocation.
 * Returns e.g. "bash: npm test" or "edit: src/index.ts" or just "read".
 */
export function describeToolCall(
  tool: string,
  args?: Record<string, unknown>,
): string {
  if (!args) return tool

  switch (tool) {
    case "bash": {
      const cmd = getString(args, ["command", "cmd"])
      if (cmd) {
        // Truncate long commands for sidebar display
        const short = cmd.length > 60 ? `${cmd.slice(0, 57)}...` : cmd
        return `bash: ${short}`
      }
      return "bash"
    }

    case "edit":
    case "write":
    case "read": {
      const path = getString(args, ["filePath", "path", "file"])
      if (path) {
        // Show just the filename or last path segments
        const segments = path.split("/")
        const short =
          segments.length > 2
            ? segments.slice(-2).join("/")
            : segments.join("/")
        return `${tool}: ${short}`
      }
      return tool
    }

    case "glob": {
      const pattern = getString(args, ["pattern", "glob"])
      return pattern ? `glob: ${pattern}` : "glob"
    }

    case "grep": {
      const pattern = getString(args, ["pattern", "query"])
      return pattern ? `grep: ${pattern}` : "grep"
    }

    default:
      return tool
  }
}

/**
 * Strip a project root prefix from an absolute path to produce a relative path.
 * Returns the original path if it doesn't start with the root.
 */
export function toRelativePath(
  filePath: string,
  projectRoot?: string,
): string {
  if (!projectRoot) return filePath

  const root = projectRoot.endsWith("/") ? projectRoot : `${projectRoot}/`
  if (filePath.startsWith(root)) {
    return filePath.slice(root.length)
  }

  return filePath
}

export function normalizeEvent(event: UnknownEvent): NormalizedEvent | null {
  const properties = event.properties ?? {}

  switch (event.type) {
    case "session.status": {
      const sessionID = readSessionID(properties)
      const statusValue = properties.status
      const statusRecord = asRecord(statusValue)
      const status =
        (typeof statusValue === "string" && statusValue.trim()) ||
        (statusRecord && getString(statusRecord, ["type"]))

      if (!sessionID || !status) return null
      return { type: "session.status", sessionID, status }
    }

    case "session.idle": {
      const sessionID = readSessionID(properties)
      if (!sessionID) return null
      return { type: "session.idle", sessionID }
    }

    case "session.error": {
      return { type: "session.error", sessionID: readSessionID(properties) }
    }

    case "question.asked": {
      const header =
        getString(properties, ["header", "title", "message"]) ??
        (() => {
          const questions = properties.questions
          if (!Array.isArray(questions)) return undefined

          for (const question of questions) {
            const record = asRecord(question)
            if (!record) continue
            const value = getString(record, ["header", "title", "message"])
            if (value) return value
          }

          return undefined
        })()

      if (!header) return null
      return {
        type: "question.asked",
        header,
        sessionID: readSessionID(properties),
      }
    }

    case "question.replied":
    case "question.rejected":
      return { type: "question.resolved" }

    case "permission.replied":
      return { type: "permission.replied" }

    case "file.edited": {
      const filePath = getString(properties, ["filePath", "path", "file"])
      if (!filePath) return null
      return {
        type: "file.edited",
        filePath,
        sessionID: readSessionID(properties),
      }
    }

    case "session.created": {
      const sessionID = readSessionID(properties)
      if (!sessionID) return null
      return { type: "session.created", sessionID }
    }

    case "session.updated": {
      const sessionID = readSessionID(properties)
      if (!sessionID) return null
      return { type: "session.updated", sessionID }
    }

    case "session.deleted": {
      const sessionID = readSessionID(properties)
      if (!sessionID) return null
      return { type: "session.deleted", sessionID }
    }

    case "session.compacted": {
      const sessionID = readSessionID(properties)
      if (!sessionID) return null
      return { type: "session.compacted", sessionID }
    }

    case "todo.updated": {
      const rawItems =
        properties.items ?? properties.todos ?? properties.list
      const items: TodoItem[] = []

      if (Array.isArray(rawItems)) {
        for (const raw of rawItems) {
          const record = asRecord(raw)
          if (!record) continue
          const text = getString(record, ["text", "content", "title"])
          if (!text) continue
          items.push({
            text,
            completed: record.completed === true || record.status === "completed" || record.done === true,
          })
        }
      }

      return { type: "todo.updated", items }
    }

    default:
      return null
  }
}
