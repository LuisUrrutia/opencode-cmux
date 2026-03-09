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
  const cmux = createCmuxClient({
    binary: config.cmuxBin,
    environment,
    logger,
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
    managedWorkspace: environment.isManagedWorkspace,
    socketPath: environment.socketPath,
  })

  return {
    async event({ event }) {
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
          await coordinator.handleFileEdited(normalized.filePath)
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
    },

    async "permission.ask"(input) {
      await coordinator.handlePermissionAsked(describePermissionRequest(input))
    },

    async "tool.execute.before"(input, output) {
      await coordinator.handleToolStarted(input.tool, output?.args)
    },

    async "tool.execute.after"(input, output) {
      await coordinator.handleToolCompleted(input.tool, output?.args)
    },
  }
}

export default plugin
