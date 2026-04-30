import { afterAll, describe, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { detectGitInfo, isGitCommand } from "../src/features/git.ts"

const tempDirs: string[] = []

afterAll(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe("git detector", () => {
  test("returns null branch outside a git repo", () => {
    const dir = mkdtempSync(join(tmpdir(), "opencode-cmux-no-git-"))
    tempDirs.push(dir)

    expect(detectGitInfo(dir)).toEqual({ branch: null, dirty: false })
  })

  test("detects branch and dirty state inside a repo", () => {
    const dir = mkdtempSync(join(tmpdir(), "opencode-cmux-git-"))
    tempDirs.push(dir)

    execFileSync("git", ["init", "-b", "main"], { cwd: dir })
    writeFileSync(join(dir, "file.txt"), "dirty\n")

    expect(detectGitInfo(dir)).toEqual({ branch: "main", dirty: true })
  })

  test("isGitCommand detects simple git invocations", () => {
    expect(isGitCommand("git status")).toBe(true)
    expect(isGitCommand("echo git status")).toBe(true)
    expect(isGitCommand("npm test")).toBe(false)
  })
})
