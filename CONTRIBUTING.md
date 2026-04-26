# Contributing to agent-tree

Thanks for the interest. agent-tree is small and opinionated; the bar for accepting changes is "doesn't make the tool worse." Here's the loop.

## Dev setup

```bash
git clone https://github.com/lifrary/agent-tree
cd agent-tree
npm install
npm test         # 134 / 12 files at last green — must stay green
```

Requirements:
- **Node.js ≥ 20** (native `fetch`, top-level await in build script)
- **macOS or Linux** for the full smoke loop. Windows works for the CLI; clipboard / git subprocess paths are platform-shimmed but less exercised.

## The check chain

Every PR must pass these four, in this order:

```bash
npm run lint        # eslint
npm run typecheck   # tsc --noEmit, strict
npm test            # vitest
npm run build       # esbuild → dist/cli.js + dist/mcp-server.js
```

`npm publish` re-runs all four via the `prepublishOnly` hook — so a green local run is a strong signal you can ship.

## What we care about

### Tests are not optional for security-sensitive paths

If you touch any of these, add a test in `tests/security-hardening.test.ts` (or extend `tests/integration.test.ts`):

- `src/utils/redact.ts` — adding/changing patterns
- `src/cli/modes.ts:dumpArtifacts` — anything that writes to disk
- `src/utils/picks.ts` — concurrency / atomicity changes
- `src/utils/safe_path.ts` — path-trust hardening
- `src/mcp/server.ts` — any new tool, or change to `pipelineFor` / `resolveMatchSafe`

The reason: redaction and path-safety bugs are silent failures that bypass every test that doesn't specifically look for them. We learned this the hard way during the v0.1.0 audit (see `CHANGELOG.md` "Post-rebrand audit hardening").

### Routing through canonical helpers

If you add a new code path that consumes a session, route it through `runPipeline` (CLI) or `pipelineFor` (MCP). Do **not** call `buildMindMap` directly — it bypasses the redactor. v0.1.0 had this exact bug for three MCP tools.

### Commit message style

Conventional-ish but pragmatic. The first line is what people see in `git log --oneline`:

```
<type>: <imperative summary, ≤72 chars>

<body explaining why, not what — wrap at 72>

<footer if needed>
```

Common `<type>` values: `feat`, `fix`, `chore`, `docs`, `test`, `refactor`, `release`. No strict rule — match the surrounding history (see `git log --oneline`).

### Pull request flow

1. Branch from `dev` (not `main` — `main` only moves at release time).
2. Push your branch, open a PR against `dev`.
3. Make sure CI is green (the four-step check chain runs in `.github/workflows/ci.yml`).
4. Reviewer merges into `dev`. `main` only fast-forwards from `dev` during a release (see `RELEASING.md`).

Small PRs > big PRs. If a change touches more than ~5 files, write a one-paragraph summary in the PR description explaining the shape.

## What we *don't* care about

- Fancy abstraction. Three similar lines is fine; a "ContextSnapshotFactoryAdapter" is not.
- 100% test coverage. Aim for "the security-sensitive paths are locked in, and a future regression turns CI red."
- Backwards compatibility for pre-1.0 internal APIs. Once we hit 1.0 we'll care; until then, breaking changes between minor versions are explicit but not banned.

## Reporting bugs / requesting features

Open an issue on GitHub. The templates in `.github/ISSUE_TEMPLATE/` cover the minimum info we need to triage.

For sensitive security findings (e.g. a redactor pattern that leaks a real-world key in the wild), email the author directly rather than filing a public issue. See `package.json#author`.

## License

By submitting a contribution you agree it ships under the project's MIT license (see `LICENSE`).
