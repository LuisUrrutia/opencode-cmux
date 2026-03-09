import { basename } from "node:path"
import type { PluginContext } from "../types.js"

export interface ProjectContext {
  id: string
  label: string
  root?: string
}

export function resolveProjectContext(ctx: PluginContext): ProjectContext {
  const root = ctx.worktree ?? ctx.project?.worktree ?? ctx.directory
  const label = root ? basename(root) : ctx.project?.id ?? "project"

  return {
    id: ctx.project?.id ?? label,
    label,
    root,
  }
}
