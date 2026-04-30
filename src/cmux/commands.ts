import type {
  NotificationPayload,
  ProgressPayload,
  SidebarLogPayload,
  SidebarStatusPayload,
} from "../types.js"

// ---------------------------------------------------------------------------
// CLI command builders (spawn-based transport)
// ---------------------------------------------------------------------------

function withWorkspace(args: string[], workspaceID?: string): string[] {
  return workspaceID ? [...args, "--workspace", workspaceID] : args
}

export function buildNotifyCommand(
  payload: NotificationPayload,
  workspaceID?: string,
): string[] {
  const args = ["notify", "--title", payload.title]
  if (payload.subtitle) args.push("--subtitle", payload.subtitle)
  if (payload.body) args.push("--body", payload.body)
  return withWorkspace(args, workspaceID)
}

export function buildClearNotificationsCommand(workspaceID?: string): string[] {
  return withWorkspace(["clear-notifications"], workspaceID)
}

export function buildReportGitBranchCommand(
  branch: string,
  dirty: boolean,
  workspaceID?: string,
): string[] {
  const args = ["report-git-branch", branch]
  if (dirty) args.push("--status", "dirty")
  return withWorkspace(args, workspaceID)
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

// ---------------------------------------------------------------------------
// Socket command builders (text format — sidebar metadata commands)
// ---------------------------------------------------------------------------

/** Quote a value for the socket text protocol if it contains spaces. */
function quote(value: string): string {
  if (!value.includes(" ")) return value
  // Escape any embedded double quotes, then wrap in double quotes
  return `"${value.replace(/"/g, '\\"')}"`
}

function withTab(command: string, workspaceID?: string): string {
  const base = workspaceID ? `${command} --tab=${workspaceID}` : command
  return `${base}\n`
}

export function buildSocketSetStatus(
  key: string,
  payload: SidebarStatusPayload,
  workspaceID?: string,
): string {
  const command = `set_status ${key} ${quote(payload.text)} --icon=${payload.icon} --color=${payload.color}`
  return withTab(command, workspaceID)
}

export function buildSocketClearStatus(
  key: string,
  workspaceID?: string,
): string {
  return withTab(`clear_status ${key}`, workspaceID)
}

export function buildSocketClearNotifications(workspaceID?: string): string {
  return withTab("clear_notifications", workspaceID)
}

export function buildSocketReportGitBranch(
  branch: string,
  dirty: boolean,
  workspaceID?: string,
): string {
  const command = `report_git_branch ${quote(branch)}${dirty ? " --status=dirty" : ""}`
  return withTab(command, workspaceID)
}

export function buildSocketSetProgress(
  payload: ProgressPayload,
  workspaceID?: string,
): string {
  const command = `set_progress ${payload.value.toFixed(2)} --label=${quote(payload.label)}`
  return withTab(command, workspaceID)
}

export function buildSocketClearProgress(workspaceID?: string): string {
  return withTab("clear_progress", workspaceID)
}

export function buildSocketLog(
  payload: SidebarLogPayload,
  workspaceID?: string,
): string {
  let command = `log --level=${payload.level} --source=${payload.source}`
  if (workspaceID) command += ` --tab=${workspaceID}`
  command += ` -- ${quote(payload.message)}`
  return `${command}\n`
}

// ---------------------------------------------------------------------------
// Socket command builders (JSON-RPC — notification commands)
// ---------------------------------------------------------------------------

/**
 * Build a generic JSON-RPC request string for the cmux socket.
 * Returns a newline-terminated JSON string. Undefined param values are stripped.
 */
export function buildJsonRpc(
  method: string,
  params: Record<string, unknown>,
  requestID: string,
): string {
  const cleanParams: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      cleanParams[key] = value
    }
  }
  return JSON.stringify({ id: requestID, method, params: cleanParams }) + "\n"
}

/**
 * Build a JSON-RPC notification.create request for the cmux socket.
 */
export function buildSocketNotify(
  payload: NotificationPayload,
  requestID: string,
  workspaceID?: string,
): string {
  return buildJsonRpc(
    "notification.create",
    {
      title: payload.title,
      subtitle: payload.subtitle,
      body: payload.body,
      workspace_id: workspaceID,
    },
    requestID,
  )
}

// ---------------------------------------------------------------------------
// Response parser
// ---------------------------------------------------------------------------

export interface CmuxResponse {
  id: string
  ok: boolean
  result?: unknown
  error?: string
}

/**
 * Parse a cmux socket response.
 *
 * - Valid JSON with `ok` field → parsed CmuxResponse
 * - Empty string → null
 * - Non-JSON text (e.g. "OK") → null
 * - Malformed JSON → null
 */
export function parseCmuxResponse(raw: string): CmuxResponse | null {
  const trimmed = raw.trim()
  if (!trimmed) return null

  // Quick check: must start with { to be JSON
  if (trimmed[0] !== "{") return null

  try {
    const parsed = JSON.parse(trimmed)
    if (typeof parsed === "object" && parsed !== null && "ok" in parsed) {
      return parsed as CmuxResponse
    }
    return null
  } catch {
    return null
  }
}
