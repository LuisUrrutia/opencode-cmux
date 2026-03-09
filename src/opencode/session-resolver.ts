import type {
  PluginClient,
  PluginLogger,
  SessionMetadata,
  SessionResolver,
} from "../types.js"

export class OpencodeSessionResolver implements SessionResolver {
  private cache = new Map<string, SessionMetadata>()

  public constructor(
    private readonly client: PluginClient,
    private readonly logger: PluginLogger,
  ) {}

  public async getSessionMetadata(sessionID: string): Promise<SessionMetadata> {
    const cached = this.cache.get(sessionID)
    if (cached) return cached

    if (!this.client.session?.get) {
      const fallback = {
        id: sessionID,
        title: sessionID,
        kind: "primary" as const,
      }
      this.cache.set(sessionID, fallback)
      await this.logger.log("warn", "Session client unavailable; using fallback metadata", {
        sessionID,
      })
      return fallback
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
      return metadata
    } catch (error) {
      const fallback = {
        id: sessionID,
        title: sessionID,
        kind: "primary" as const,
      }
      this.cache.set(sessionID, fallback)
      await this.logger.log("warn", "Failed to resolve session metadata; using fallback", {
        sessionID,
        error: error instanceof Error ? error.message : String(error),
      })
      return fallback
    }
  }
}
