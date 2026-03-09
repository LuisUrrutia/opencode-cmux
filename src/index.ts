import { loadConfig } from "./config.js"
import { detectCmuxEnvironment } from "./cmux/detect.js"
import { createCmuxClient } from "./cmux/client.js"
import { normalizeEvent } from "./events.js"
import { createPluginLogger } from "./logger.js"
import { OpencodeSessionResolver } from "./opencode/session-resolver.js"
import { resolveProjectContext } from "./state/project-context.js"
import { CmuxStateCoordinator } from "./state/presenter.js"
import type { PermissionAskInput, Plugin } from "./types.js"

function describePermissionRequest(input: PermissionAskInput): string {
  if (typeof input.title === "string" && input.title.trim()) {
    return input.title.trim()
  }

  if (typeof input.tool === "string" && input.tool.trim()) {
    return input.tool.trim()
  }

  return "Permission request"
}

const plugin: Plugin = async (ctx) => {
  const config = loadConfig()
  const logger = createPluginLogger(ctx.client)
  const environment = detectCmuxEnvironment(process.env)

  if (!environment.isManagedWorkspace) {
    await logger.log("debug", "cmux not detected, plugin disabled", {
      socketPath: environment.socketPath,
    })
    return {}
  }

  const cmux = createCmuxClient({
    binary: config.cmuxBin,
    environment,
    logger,
    transport: config.transport,
  })
  const sessionResolver = new OpencodeSessionResolver(ctx.client, logger)
  const project = resolveProjectContext(ctx)
  const coordinator = new CmuxStateCoordinator({
    cmux,
    config,
    logger,
    project,
    sessionResolver,
  })

  await logger.log("info", "Initialized opencode-cmux plugin", {
    project: project.label,
    workspaceID: environment.workspaceID,
    socketPath: environment.socketPath,
    transport: cmux.transport,
    hasSocket: environment.hasSocket,
  })

  /** Best-effort error logging — never throws. */
  function logHookError(hook: string, err: unknown): void {
    try {
      logger.log("error", `Hook "${hook}" failed: ${err}`)
    } catch {
      // Swallow — logger itself may be broken
    }
  }

  return {
    async event({ event }) {
      try {
        const normalized = normalizeEvent(event)
        if (!normalized) return

        switch (normalized.type) {
          case "session.status":
            await coordinator.handleSessionStatus(
              normalized.sessionID,
              normalized.status,
            )
            return

          case "session.idle":
            await coordinator.handleSessionIdle(normalized.sessionID)
            return

          case "session.error":
            await coordinator.handleSessionError(normalized.sessionID)
            return

          case "question.asked":
            await coordinator.handleQuestionAsked(
              normalized.header,
              normalized.sessionID,
            )
            return

          case "question.resolved":
            await coordinator.handleQuestionResolved()
            return

          case "permission.replied":
            await coordinator.handlePermissionResolved()
            return

          case "file.edited":
            await coordinator.handleFileEdited(normalized.filePath, normalized.sessionID)
            return

          case "session.created":
            await coordinator.handleSessionCreated(normalized.sessionID)
            return

          case "session.deleted":
            await coordinator.handleSessionDeleted(normalized.sessionID)
            return

          case "session.compacted":
            await coordinator.handleSessionCompacted(normalized.sessionID)
            return

          case "todo.updated":
            await coordinator.handleTodoUpdated(normalized.items)
            return
        }
      } catch (err) {
        logHookError("event", err)
      }
    },

    async "permission.ask"(input) {
      try {
        await coordinator.handlePermissionAsked(describePermissionRequest(input))
      } catch (err) {
        logHookError("permission.ask", err)
      }
    },

    async "tool.execute.before"(input, output) {
      try {
        await coordinator.handleToolStarted(input.tool, output?.args)
      } catch (err) {
        logHookError("tool.execute.before", err)
      }
    },

    async "tool.execute.after"(input, output) {
      try {
        await coordinator.handleToolCompleted(input.tool, output?.args)
      } catch (err) {
        logHookError("tool.execute.after", err)
      }
    },
  }
}

export default plugin
