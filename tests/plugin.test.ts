import { afterEach, describe, expect, test } from "bun:test"
import plugin from "../src/index.ts"
import type { PluginContext } from "../src/types.ts"

function createFakeContext(): PluginContext {
  return {
    directory: "/tmp/demo",
    client: {
      app: {
        async log() {},
      },
      session: {
        async get() {
          return { data: undefined }
        },
      },
    },
  }
}

describe("plugin initialization", () => {
  const originalWorkspaceID = process.env.CMUX_WORKSPACE_ID

  afterEach(() => {
    // Restore original env
    if (originalWorkspaceID !== undefined) {
      process.env.CMUX_WORKSPACE_ID = originalWorkspaceID
    } else {
      delete process.env.CMUX_WORKSPACE_ID
    }
  })

  test("returns empty hooks when CMUX_WORKSPACE_ID is not set", async () => {
    delete process.env.CMUX_WORKSPACE_ID

    const hooks = await plugin(createFakeContext())

    expect(hooks).toEqual({})
    expect(hooks.event).toBeUndefined()
    expect(hooks["permission.ask"]).toBeUndefined()
    expect(hooks["tool.execute.before"]).toBeUndefined()
    expect(hooks["tool.execute.after"]).toBeUndefined()
  })

  test("returns hooks when CMUX_WORKSPACE_ID is set", async () => {
    process.env.CMUX_WORKSPACE_ID = "workspace:test"

    const hooks = await plugin(createFakeContext())

    expect(hooks.event).toBeFunction()
    expect(hooks["permission.ask"]).toBeFunction()
    expect(hooks["tool.execute.before"]).toBeFunction()
    expect(hooks["tool.execute.after"]).toBeFunction()
  })

  test("event hook does not throw on malformed events", async () => {
    process.env.CMUX_WORKSPACE_ID = "workspace:test"

    const hooks = await plugin(createFakeContext())

    // These should not throw — the try/catch wrapping swallows errors
    await expect(
      hooks.event!({ event: null as any }),
    ).resolves.toBeUndefined()

    await expect(
      hooks.event!({ event: { type: undefined } as any }),
    ).resolves.toBeUndefined()
  })

  test("tool hooks do not throw on unexpected input", async () => {
    process.env.CMUX_WORKSPACE_ID = "workspace:test"

    const hooks = await plugin(createFakeContext())

    // tool.execute.before / after should not throw even with odd input
    await expect(
      hooks["tool.execute.before"]!({ tool: "bash" } as any, undefined as any),
    ).resolves.toBeUndefined()

    await expect(
      hooks["tool.execute.after"]!({ tool: "bash" } as any, undefined as any),
    ).resolves.toBeUndefined()
  })
})
