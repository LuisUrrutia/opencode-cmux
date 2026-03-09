import type {
  NotificationPayload,
  ProgressPayload,
  SidebarLogPayload,
  SidebarStatusPayload,
} from "../types.js"

function withWorkspace(args: string[], workspaceID?: string): string[] {
  return workspaceID ? [...args, "--workspace", workspaceID] : args
}

export function buildNotifyCommand(payload: NotificationPayload): string[] {
  const args = ["notify", "--title", payload.title]
  if (payload.subtitle) args.push("--subtitle", payload.subtitle)
  if (payload.body) args.push("--body", payload.body)
  return args
}

export function buildSetStatusCommand(
  key: string,
  payload: SidebarStatusPayload,
  workspaceID?: string,
): string[] {
  const args = [
    "set-status",
    key,
    payload.text,
    "--icon",
    payload.icon,
    "--color",
    payload.color,
  ]
  return withWorkspace(args, workspaceID)
}

export function buildClearStatusCommand(
  key: string,
  workspaceID?: string,
): string[] {
  return withWorkspace(["clear-status", key], workspaceID)
}

export function buildSetProgressCommand(
  payload: ProgressPayload,
  workspaceID?: string,
): string[] {
  return withWorkspace(
    ["set-progress", payload.value.toFixed(2), "--label", payload.label],
    workspaceID,
  )
}

export function buildClearProgressCommand(workspaceID?: string): string[] {
  return withWorkspace(["clear-progress"], workspaceID)
}

export function buildLogCommand(
  payload: SidebarLogPayload,
  workspaceID?: string,
): string[] {
  const args = [
    "log",
    "--level",
    payload.level,
    "--source",
    payload.source,
  ]
  return withWorkspace([...args, "--", payload.message], workspaceID)
}
