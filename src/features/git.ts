import { spawnSync } from "node:child_process"

export interface GitInfo {
  branch: string | null
  dirty: boolean
}

function runGit(cwd: string, args: string[]): { ok: boolean; stdout: string } {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    timeout: 500,
  })

  if (result.error || result.status !== 0) {
    return { ok: false, stdout: "" }
  }

  return { ok: true, stdout: typeof result.stdout === "string" ? result.stdout : "" }
}

export function detectGitInfo(cwd: string): GitInfo {
  const branchResult = runGit(cwd, ["branch", "--show-current"])
  if (!branchResult.ok) return { branch: null, dirty: false }

  const branch = branchResult.stdout.trim()
  if (!branch) return { branch: null, dirty: false }

  const dirtyResult = runGit(cwd, ["status", "--porcelain"])
  const dirty = dirtyResult.ok && dirtyResult.stdout.trim().length > 0

  return { branch, dirty }
}

export function isGitCommand(command: string): boolean {
  return /\bgit(\s|$)/.test(command.trim())
}
