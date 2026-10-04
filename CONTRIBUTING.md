# Contributing to agent-tree

Thanks for the interest. agent-tree is small and opinionated; the bar for accepting changes is "doesn't make the tool worse." Here's the loop.

## Dev setup

```bash
git clone https://github.com/lifrary/agent-tree
cd agent-tree
npm install
npm test         # Vitest 5 — must stay green
```

Requirements:

- **Node.js ≥22.13.0** for the upcoming 0.2.0 release.
- **macOS or Linux** for the full smoke loop. Windows works for the CLI; clipboard / git subprocess paths are platform-shimmed but less exercised.
- CI covers **Node 22, 24, and 26 on Linux and macOS**.
- **ESLint 10** uses flat config; **Vitest 5** runs the tests.
- **TypeScript 6.0.3** is deliberately held below 6.1 for typescript-eslint
  peer compatibility. TypeScript 7 is the latest major but is not supported
  by this toolchain; do not upgrade TypeScript independently of its peers.

## The check chain

Run the full local check chain before opening a PR:

```bash
npm run lint        # ESLint 10, flat config
npm run typecheck   # tsc --noEmit, strict
npm test            # vitest
npm run build       # esbuild → dist/cli.js + dist/mcp-server.js
```

`npm publish` re-runs all four via the `prepublishOnly` hook — so a green local run is a strong signal you can ship.

CI also audits dependencies with `npm audit` and checks the bundled CLI help
and portable JSON export across the Node/OS matrix.

## What we care about

### Tests are not optional for security-sensitive paths

If you touch any of these, add a test in `tests/security-hardening.test.ts` (or extend `tests/integration.test.ts`):

- `src/utils/redact.ts` — adding/changing patterns
- `src/cli/modes.ts:dumpArtifacts` — anything that writes to disk
- `src/utils/picks.ts` — concurrency / atomicity changes
- `src/utils/safe_path.ts` — path-trust hardening
- `src/mcp/server.ts` — any new tool, session resolution, or analysis cache change
- `src/utils/session_path.ts` / `src/reader/jsonl.ts` — discovery, portable imports, or malformed-input handling
- `src/config/loader.ts` / `src/config/schema.ts` — precedence, per-field validation, or security settings
- `src/llm/labeler.ts` / `src/llm/anthropic.ts` — input reservations, token counting, or paid-request handling

The reason: redaction and path-safety bugs are silent failures that bypass every test that doesn't specifically look for them. We learned this the hard way during the v0.1.0 audit (see `CHANGELOG.md` "Post-rebrand audit hardening").

### Routing through canonical helpers

If you add a new code path that analyzes a session, route it through `runPipeline` (MCP uses the analysis/cache helper inside `createServer`). Do **not** call `buildMindMap` directly — it bypasses the pipeline's redaction policy. v0.1.0 had this exact bug for three MCP tools. Catalog discovery is intentionally parse-free, but catalog strings still need redaction before output.

### Keep the public contracts aligned

- Update CLI validation and MCP schemas together where capabilities overlap.
  There are six tools: `agent_tree_sessions`, `agent_tree_list`,
  `agent_tree_snapshot`, `agent_tree_picks`, `agent_tree_diff`, and
  `agent_tree_unstar`. All per-session tools accept `file` or `sessionId`,
  never both; picks takes `{}`. MCP remains heuristic-only.
- Cover portable exports, `CLAUDE_CONFIG_DIR`, UUID-only regular-file
  discovery (no agent/subagent or symlink entries), strict parse failures,
  JSON redaction/no stdout banners, and incompatible CLI flags (exit 2).
  JSON is the complete mindmap, not a filtered text view.
- Verify defaults < user < project < environment < explicit CLI precedence,
  valid sibling fields surviving invalid overrides, and warnings that do not
  echo rejected values. Redaction cannot be disabled; only the Anthropic
  provider and disabled telemetry are supported.
- Mock Anthropic requests in tests. Exact `messages.countTokens` preflight
  must reserve input before paid calls, including under parallelism; failed
  counts must not issue a paid call. Input reservations are not a monetary
  spending cap, and failed requests must not refund reservations.
- Keep `README.md`, `skills/agent-tree/SKILL.md`, release smoke assertions,
  and `.claude/commands/` aligned with observable behavior. CLI and MCP
  versions derive from `package.json` through `src/version.ts`, not separate
  hard-coded version strings.

### Commit message style

Conventional-ish but pragmatic. The first line is what people see in `git log --oneline`:

```
<type>: <imperative summary, ≤72 chars>

<body explaining why, not what — wrap at 72>

<footer if needed>
```

Common `<type>` values: `feat`, `fix`, `chore`, `docs`, `test`, `refactor`, `release`. No strict rule — match the surrounding history (see `git log --oneline`).

### Pull request flow

1. Branch from `main`.
2. Push your branch and open a PR against `main`.
3. Make sure CI is green (`.github/workflows/ci.yml` runs on `main` pushes and PRs).
4. Reviewer merges into `main`. Publishing is a separate maintainer action
   (see `RELEASING.md`); a preparation commit does not imply an npm release.

Small PRs > big PRs. If a change touches more than ~5 files, write a one-paragraph summary in the PR description explaining the shape.

## What we _don't_ care about

- Fancy abstraction. Three similar lines is fine; a "ContextSnapshotFactoryAdapter" is not.
- 100% test coverage. Aim for "the security-sensitive paths are locked in, and a future regression turns CI red."
- Backwards compatibility for pre-1.0 internal APIs. Once we hit 1.0 we'll care; until then, breaking changes between minor versions are explicit but not banned.

## Reporting bugs / requesting features

Open an issue on GitHub. The templates in `.github/ISSUE_TEMPLATE/` cover the minimum info we need to triage.

For sensitive security findings (e.g. a redactor pattern that leaks a real-world key in the wild), email the author directly rather than filing a public issue. See `package.json#author`.

## License

By submitting a contribution you agree it ships under the project's MIT license (see `LICENSE`).
