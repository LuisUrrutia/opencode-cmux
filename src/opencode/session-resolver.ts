import type {
  PluginClient,
  PluginLogger,
  SessionMetadata,
  SessionResolver,
} from "../types.js"

/** How long to suppress retries after a failed session lookup. */
const NEGATIVE_CACHE_TTL_MS = 5_000

export class OpencodeSessionResolver implements SessionResolver {
  private cache = new Map<string, SessionMetadata>()
  private failedAt = new Map<string, number>()

  public constructor(
    private readonly client: PluginClient,
    private readonly logger: PluginLogger,
  ) {}

  public async getSessionMetadata(sessionID: string): Promise<SessionMetadata> {
    const cached = this.cache.get(sessionID)
    if (cached) return cached

    // Don't retry too quickly after a transient failure
    const lastFail = this.failedAt.get(sessionID)
    if (lastFail && Date.now() - lastFail < NEGATIVE_CACHE_TTL_MS) {
      return { id: sessionID, title: sessionID, kind: "primary" }
    }

    if (!this.client.session?.get) {
      this.failedAt.set(sessionID, Date.now())
      await this.logger.log("warn", "Session client unavailable; using fallback metadata", {
        sessionID,
      })
      return { id: sessionID, title: sessionID, kind: "primary" }
    }

    try {
      const result = await this.client.session.get({ path: { id: sessionID } })
      const summary = result.data
      const metadata: SessionMetadata = {
        id: sessionID,
        title: summary?.title?.trim() || sessionID,
        parentID: summary?.parentID,
        kind: summary?.parentID ? "subagent" : "primary",
      }
      this.cache.set(sessionID, metadata)
      // Clear any previous failure record on success
      this.failedAt.delete(sessionID)
      return metadata
    } catch (error) {
      this.failedAt.set(sessionID, Date.now())
      await this.logger.log("warn", "Failed to resolve session metadata; using fallback", {
        sessionID,
        error: error instanceof Error ? error.message : String(error),
      })
      return { id: sessionID, title: sessionID, kind: "primary" }
    }
  }
}
