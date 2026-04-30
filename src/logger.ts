import type { PluginClient, PluginLogger } from "./types.js"

const SERVICE = "opencode-cmux"

export function createPluginLogger(client: PluginClient): PluginLogger {
  return {
    async log(level, message, extra) {
      if (!client.app?.log) return

      try {
        await client.app.log({
          body: {
            service: SERVICE,
            level,
            message,
            extra,
          },
        })
      } catch (error) {
        console.warn("[opencode-cmux] failed to write plugin log", error)
      }
    },
  }
}
