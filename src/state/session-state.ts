import type { SessionMetadata } from "../types.js"

export type SessionActivity = "busy" | "idle" | "error"

export interface SessionRuntime {
  metadata: SessionMetadata
  activity: SessionActivity
}

export function formatSessionLabel(session: SessionMetadata): string {
  const title = session.title.trim()
  return title || session.id
}

export function getBusySubagentCount(
  sessions: Iterable<SessionRuntime>,
): number {
  let count = 0

  for (const session of sessions) {
    if (session.metadata.kind === "subagent" && session.activity === "busy") {
      count += 1
    }
  }

  return count
}
