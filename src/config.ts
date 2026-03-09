export interface PluginConfig {
  cmuxBin: string
  statusKey: string
  notifySubagents: boolean
  logSubagents: boolean
  progressEnabled: boolean
  keepDoneStatus: boolean
  notifyQuestions: boolean
  notifyPermissions: boolean
  logToolCalls: boolean
  logToolCallsVerbose: boolean
  logFileEdits: boolean
  logSessionLifecycle: boolean
  logTodos: boolean
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

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
): PluginConfig {
  return {
    cmuxBin: env.OPENCODE_CMUX_BIN?.trim() || "cmux",
    statusKey: env.OPENCODE_CMUX_STATUS_KEY?.trim() || "opencode",
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
