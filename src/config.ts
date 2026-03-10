export interface PluginConfig {
  /** Path to the cmux binary. Env: `OPENCODE_CMUX_BIN`. Default: `"cmux"` */
  cmuxBin: string

  /** Sidebar status key for set_status/clear_status calls. Env: `OPENCODE_CMUX_STATUS_KEY`. Default: `"opencode"` */
  statusKey: string

  /** Transport selection: `"cli"` (spawn), `"socket"` (Unix socket), or `"auto"` (prefer socket). Env: `OPENCODE_CMUX_TRANSPORT`. Default: `"auto"` */
  transport: "cli" | "socket" | "auto"

  /** Send desktop notifications for subagent session events. Env: `OPENCODE_CMUX_NOTIFY_SUBAGENTS`. Default: `false` */
  notifySubagents: boolean

  /** Log subagent activity to the sidebar. Env: `OPENCODE_CMUX_LOG_SUBAGENTS`. Default: `true` */
  logSubagents: boolean

  /** Show a progress bar while the session is busy. Env: `OPENCODE_CMUX_PROGRESS`. Default: `true` */
  progressEnabled: boolean

  /** Keep the "done" status pill visible after the session goes idle. Env: `OPENCODE_CMUX_KEEP_DONE_STATUS`. Default: `true` */
  keepDoneStatus: boolean

  /** Send a desktop notification when the agent asks a question. Env: `OPENCODE_CMUX_NOTIFY_QUESTIONS`. Default: `true` */
  notifyQuestions: boolean

  /** Send a desktop notification when the agent requests permission. Env: `OPENCODE_CMUX_NOTIFY_PERMISSIONS`. Default: `true` */
  notifyPermissions: boolean

  /** Log tool start/complete events to the sidebar. Env: `OPENCODE_CMUX_LOG_TOOLS`. Default: `true` */
  logToolCalls: boolean

  /** Include tool arguments in sidebar log messages. Env: `OPENCODE_CMUX_LOG_TOOLS_VERBOSE`. Default: `false` */
  logToolCallsVerbose: boolean

  /** Log file edit events to the sidebar. Env: `OPENCODE_CMUX_LOG_FILE_EDITS`. Default: `true` */
  logFileEdits: boolean

  /** Log session created/deleted/compacted events to the sidebar. Env: `OPENCODE_CMUX_LOG_SESSION_LIFECYCLE`. Default: `true` */
  logSessionLifecycle: boolean

  /** Log todo progress changes to the sidebar. Env: `OPENCODE_CMUX_LOG_TODOS`. Default: `true` */
  logTodos: boolean

  /** Auto-clear a stuck "working" state after this many ms. 0 = disabled. Env: `OPENCODE_CMUX_STALE_TIMEOUT`. Default: `0` */
  staleSessionTimeoutMs: number
}

const TRUE_VALUES = new Set(["1", "true", "yes", "on"])
const FALSE_VALUES = new Set(["0", "false", "no", "off"])

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (!value) return fallback

  const normalized = value.trim().toLowerCase()
  if (TRUE_VALUES.has(normalized)) return true
  if (FALSE_VALUES.has(normalized)) return false
  return fallback
}

function parseNumber(value: string | undefined, fallback: number): number {
  if (!value) return fallback

  const parsed = Number(value.trim())
  return Number.isFinite(parsed) ? parsed : fallback
}

function parseTransport(
  value: string | undefined,
  fallback: "cli" | "socket" | "auto",
): "cli" | "socket" | "auto" {
  if (!value) return fallback
  const normalized = value.trim().toLowerCase()
  if (normalized === "cli" || normalized === "socket" || normalized === "auto")
    return normalized
  return fallback
}

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
): PluginConfig {
  return {
    cmuxBin: env.OPENCODE_CMUX_BIN?.trim() || "cmux",
    statusKey: env.OPENCODE_CMUX_STATUS_KEY?.trim() || "opencode",
    transport: parseTransport(env.OPENCODE_CMUX_TRANSPORT, "auto"),
    notifySubagents: parseBoolean(env.OPENCODE_CMUX_NOTIFY_SUBAGENTS, false),
    logSubagents: parseBoolean(env.OPENCODE_CMUX_LOG_SUBAGENTS, true),
    progressEnabled: parseBoolean(env.OPENCODE_CMUX_PROGRESS, true),
    keepDoneStatus: parseBoolean(env.OPENCODE_CMUX_KEEP_DONE_STATUS, true),
    notifyQuestions: parseBoolean(env.OPENCODE_CMUX_NOTIFY_QUESTIONS, true),
    notifyPermissions: parseBoolean(env.OPENCODE_CMUX_NOTIFY_PERMISSIONS, true),
    logToolCalls: parseBoolean(env.OPENCODE_CMUX_LOG_TOOLS, true),
    logToolCallsVerbose: parseBoolean(env.OPENCODE_CMUX_LOG_TOOLS_VERBOSE, false),
    logFileEdits: parseBoolean(env.OPENCODE_CMUX_LOG_FILE_EDITS, true),
    logSessionLifecycle: parseBoolean(env.OPENCODE_CMUX_LOG_SESSION_LIFECYCLE, true),
    logTodos: parseBoolean(env.OPENCODE_CMUX_LOG_TODOS, true),
    staleSessionTimeoutMs: parseNumber(env.OPENCODE_CMUX_STALE_TIMEOUT, 0),
  }
}
