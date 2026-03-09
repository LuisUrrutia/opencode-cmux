export type LogLevel = "debug" | "info" | "warn" | "error"

export interface ProjectInfo {
  id?: string
  worktree?: string
  vcs?: string
}

export interface SessionSummary {
  title?: string
  parentID?: string
}

export interface SessionGetClient {
  get(input: { path: { id: string } }): Promise<{ data?: SessionSummary }>
}

export interface AppLogClient {
  log(input: {
    body: {
      service: string
      level: LogLevel
      message: string
      extra?: Record<string, unknown>
    }
  }): Promise<unknown>
}

export interface PluginClient {
  app?: AppLogClient
  session?: SessionGetClient
}

export interface PluginContext {
  project?: ProjectInfo
  directory?: string
  worktree?: string
  client: PluginClient
  $?: unknown
}

export interface UnknownEvent {
  type: string
  properties?: Record<string, unknown>
}

export interface PermissionAskInput {
  title?: string
  tool?: string
  [key: string]: unknown
}

export interface PermissionAskOutput {
  status?: "allow" | "deny" | "ask"
  [key: string]: unknown
}

export interface ToolExecuteInput {
  tool: string
  [key: string]: unknown
}

export interface ToolExecuteOutput {
  args?: Record<string, unknown>
  [key: string]: unknown
}

export interface PluginHooks {
  event?: (input: { event: UnknownEvent }) => Promise<void>
  "permission.ask"?: (
    input: PermissionAskInput,
    output?: PermissionAskOutput,
  ) => Promise<void>
  "tool.execute.before"?: (
    input: ToolExecuteInput,
    output?: ToolExecuteOutput,
  ) => Promise<void>
  "tool.execute.after"?: (
    input: ToolExecuteInput,
    output?: ToolExecuteOutput,
  ) => Promise<void>
}

export type Plugin = (ctx: PluginContext) => Promise<PluginHooks>

export interface SessionMetadata {
  id: string
  title: string
  parentID?: string
  kind: "primary" | "subagent"
}

export interface SidebarStatusPayload {
  text: string
  icon: string
  color: string
}

export interface ProgressPayload {
  value: number
  label: string
}

export interface NotificationPayload {
  title: string
  subtitle?: string
  body?: string
}

export interface SidebarLogPayload {
  level: "info" | "progress" | "success" | "warning" | "error"
  source: string
  message: string
}

export interface CmuxClient {
  readonly available: boolean
  readonly transport: "cli" | "socket"
  readonly workspaceID?: string
  notify(payload: NotificationPayload): Promise<void>
  setStatus(key: string, payload: SidebarStatusPayload): Promise<void>
  clearStatus(key: string): Promise<void>
  setProgress(payload: ProgressPayload): Promise<void>
  clearProgress(): Promise<void>
  log(payload: SidebarLogPayload): Promise<void>
}

export interface PluginLogger {
  log(
    level: LogLevel,
    message: string,
    extra?: Record<string, unknown>,
  ): Promise<void>
}

export interface SessionResolver {
  getSessionMetadata(sessionID: string): Promise<SessionMetadata | null>
}
