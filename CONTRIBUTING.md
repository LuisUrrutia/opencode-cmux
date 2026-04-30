# Contributing

Thanks for improving `opencode-cmux`. Keep changes small, tested, and focused on
one behavior at a time.

## Development setup

Use Bun for local checks:

```bash
bun test
bun run build
npm pack --dry-run
```

For local OpenCode testing, build the package and point `opencode.json` at the
generated entrypoint:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["file:///absolute/path/to/opencode-cmux/dist/index.js"]
}
```

## Pull requests

- Explain the behavior change and why it is needed.
- Add or update tests for event normalization, hook wiring, and presenter state
  changes when applicable.
- Keep raw OpenCode payload parsing in `src/events.ts`; do not pass unstable
  host shapes directly into the presenter.
- Wrap hook and timer failures so plugin errors do not crash OpenCode.
- Do not add production dependencies without discussing the tradeoff first.

## Release process

Maintainers publish releases from version tags such as `v1.0.0`. The tag must
match `package.json` exactly. The release workflow runs tests, builds `dist`,
packs the npm tarball, publishes to npm, and creates a GitHub release.

Configure npm Trusted Publishing for this repository before publishing. The
workflow uses GitHub OIDC and does not accept a long-lived npm token fallback.
