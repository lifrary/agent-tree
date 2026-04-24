# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/) and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### dist/*.js now committed (2026-04-24)

`dist/*.js` is no longer gitignored, so `claude plugin marketplace add
github:lifrary/agent-tree` followed by `claude plugin install` works without
a local build step. Source-maps (`dist/*.map`) stay ignored. The commit
adds `.gitattributes` marking the bundled JS as `binary
linguist-generated=true` so git log and GitHub code review don't drown in
minified diff noise.

Before: github-URL marketplace installs would `git clone` the repo,
`dist/` was empty, `${CLAUDE_PLUGIN_ROOT}/dist/mcp-server.js` was missing,
MCP spawn failed silently.

Release flow change: each release's `npm run build` regenerates
`dist/*.js`; the existing `git add -A && git commit -m "release: vX.Y.Z"`
in step 4 picks them up automatically — no new manual step.

### Plugin install path fixed (2026-04-24)

Empirical verification after v0.1.0 publish revealed that Claude Code's
`~/.claude/plugins/local/` directory is **not** auto-scanned for plugin
registration — MCP servers and skills from symlinked plugins there do not
surface in-session (confirmed against `claude-code-achievements`, whose
commands only appear because `~/.claude/commands/*.md` were symlinked by
hand, not because local/ scan loaded them).

The CLI-sanctioned install path is `claude plugin marketplace add + claude
plugin install`, which writes to `installed_plugins.json` and
`settings.json#enabledPlugins` — those entries are what trigger MCP spawn at
Claude Code startup.

- **Added** — `.claude-plugin/marketplace.json` — single-plugin marketplace
  manifest (ouroboros / openai-codex style). Enables
  `claude plugin marketplace add <path-or-github-url>` followed by
  `claude plugin install agent-tree@agent-tree`.
- **Verified** — path-based marketplace install copies the entire plugin
  directory (including un-gitted `dist/`) into
  `~/.claude/plugins/cache/agent-tree/agent-tree/0.1.0/`. So local-path
  installs work without committing build artifacts. GitHub-URL installs
  (`claude plugin marketplace add github:lifrary/agent-tree`) would
  `git clone` and skip `dist/` — that pathway still needs a
  built-artifact-in-git story (deferred to v0.1.1+).
- **Docs** — `RELEASING.md` Step 8 rewritten. Old instructions assumed a
  `~/.claude/plugins/local/` symlink would register the plugin; it does not.

### Post-rebrand audit hardening (2026-04-23)

The rebrand-and-publish prep audit landed 19 fixes across security, UX,
packaging, and code quality. Severity-rated below; everything compiles + 112
tests pass. No public CLI flag changed; npm package version bumped 0.0.1 → 0.1.0
to align with the plugin manifest, MCP server, and skill (all already 0.1.0).

#### Security
- **HIGH** — `--dump-json <dir>` rewrote: now threads the redactor over every
  payload (`raw-events.json` was previously dumping the full pre-redaction
  JSONL stream), refuses well-known sensitive paths (`/etc`, `/var/log`,
  `/var/db`, `/bin`, `/sbin`, `/usr/{bin,sbin}`, `/System`,
  `/Library/Launch{Daemons,Agents}`), creates dir at `0o700`, writes files at
  `0o600` with `flag: 'wx'` so a second dump into the same dir fails loudly
  instead of silently clobbering. (`src/cli/modes.ts`)
- **MAJOR** — MCP `agent_tree_snapshot/diff/unstar` were bypassing
  `runPipeline` (called `buildMindMap` directly without a redactor) → snapshot
  clipboard markdown could leak secrets the builder-stage redactor was
  designed to catch. All 5 MCP tools now route through a shared
  `pipelineFor(match)` helper. (`src/mcp/server.ts`)
- **MEDIUM** — Path-traversal-via-git CVE-2022-24765 mitigation: extracted
  `safeGitCwd` to `src/utils/safe_path.ts` (realpath + `isAbsolute` + null-byte
  reject); MCP snapshot tool feeds resolved cwd to `getGitContext` instead of
  the raw JSONL `cwd` field.
- **MEDIUM** — Verbose-mode aux cache writes (`graph.json`, `segments.json`)
  now run through `redactDeep` before hitting disk.
- **MEDIUM** — `picksFileFor` rejects `sessionId` not matching
  `/^[0-9a-f-]{4,40}$/i` so the picks store never composes a path from
  untrusted input. `removePicksForNode` now writes via `${file}.tmp-{pid}-{ts}`
  + `rename` so concurrent `recordPick` writes between the read and rewrite
  aren't silently lost. (`src/utils/picks.ts`)
- **MEDIUM** — Added 5 missing redaction patterns: `gcp_oauth_token`
  (`ya29.…`), `github_pat_finegrained` (`github_pat_…` ≥82 chars),
  `openai_project_key` (`sk-(proj|svcacct|admin)-…`), `stripe_secret_key`
  (`sk_(live|test)_…`), `huggingface_token` (`hf_…`). (`src/utils/redact.ts`)

#### UX
- **MAJOR** — `looksLikeSystemNoise` expanded to catch `Stop hook …` /
  `Base directory for this skill: …` / shell-prompt prefixes (`❯ `, `> `,
  `$ `, `# `) — these were leaking into phase headers as full-text labels.
  (`src/tree/builder.ts`)
- **MAJOR** — First-noise mega-phase fixed: leading-noise segments are now
  held until the first significant user prompt arrives, then become its
  children. Phase 1 always carries a real user-intent label. Fallback
  preserves data when no significant segment ever appears. (`src/tree/builder.ts`)
- **MAJOR** — Root label (`mindmap.root.label`) skips noise too — finds the
  first significant user message rather than the literal first user turn.
- **MINOR** — ⭐ pick marker no longer overrides label color — bold instead.
  Starred critical-error rows now stay red; starred user prompts stay cyan.
  (`src/render/text.ts`)

#### Packaging
- **MAJOR** — `package.json` `files[]` was shipping only `dist/` + 2 docs;
  npm install gave you the CLI but no plugin manifest, no MCP wiring, no
  skill. Added `.claude-plugin/`, `skills/`, `CHANGELOG.md`. Dropped the
  reference to nonexistent `README.ko.md`. Tarball: 7 → 11 files.
- **MAJOR** — Version aligned: `package.json` 0.0.1 → 0.1.0 (matches
  `.claude-plugin/plugin.json`, `src/mcp/server.ts`, `skills/agent-tree/SKILL.md`).
- **MINOR** — `agent_tree_picks` MCP tool accepts an optional `cwd` arg
  (currently unused) for symmetry with the other 4 tools.
- **MINOR** — Structured error response for "ambiguous session prefix" via
  new `resolveMatchSafe` wrapper — every MCP tool now returns
  `{isError:true, content}` instead of a JSON-RPC fault.

#### Code quality
- **MINOR** — Dead config keys removed: `output.{dir,format,open_browser}`,
  `render.{collapse_depth,node_size_scale,default_branch_mode}`, `BranchMode`
  type. The HTML renderer was deleted in the post-M5 pivot; these survived as
  zero-referenced clutter. (`src/config/{schema,loader}.ts`)
- **MINOR** — Removed redundant `sectionDecisions` (returned
  `inp.llm.summary`, identical to `sectionContext`). (`src/tree/context_snapshot.ts`)
- **MINOR** — `treeDepth` now uses `MindMap['root']` directly instead of triple
  `as unknown as` casts. (`src/cli/pipeline.ts`)
- **MINOR** — `displayWidth` accounts for ZWJ (U+200D) and variation
  selectors (U+FE00–FE0F, U+E0100–E01EF) — emoji ZWJ sequences (`👨‍💻`) no
  longer over-count by 2-4 cells. (`src/render/text.ts`)
- **MINOR** — `extractFileKey` regex tightened to require a real extension
  dot — `"foo (Bar)"` user-prompt strings no longer get grouped as if they
  were file rows.
- **MINOR** — `computePhaseMeta` dropped unused `events` parameter; updated
  caller. (`src/tree/builder.ts`)
- **MINOR** — Misc stale comments / docstrings: `redact.ts` (drop OMCM
  reference, list current sinks), `picks.ts` (✓/🌿 → ⭐), `tui.ts` (drop
  `--html`).

#### Tests
- New `tests/security-hardening.test.ts` — 20 tests covering all of the above:
  new redact patterns × 6, picks validator + atomic delete × 4, dumpArtifacts
  redaction + protected paths + `flag:'wx'` + perms × 4, safeGitCwd × 5,
  `looksLikeSystemNoise` end-to-end through builder × 1.
- `tests/snapshot-clean.test.ts` updated for the dropped `sectionDecisions`
  heading.

### Added — In-session plugin (MCP tools)
- **`src/mcp/server.ts`** — MCP server using `@modelcontextprotocol/sdk` (stdio transport). Five tools registered:
  - `claude_map_list` — numbered ASCII tree as text
  - `claude_map_snapshot` — single-node resume markdown + git context, records pick
  - `claude_map_picks` — all-session pick history
  - `claude_map_diff` — what happened between two nodes
  - `claude_map_unstar` — remove ⭐ marker
- **`.claude-plugin/plugin.json`** + **`.claude-plugin/.mcp.json`** — Claude Code plugin manifest. Once installed under `~/.claude/plugins/local/`, the MCP server is auto-registered and tools surface in every session — no CLI subprocess needed.
- **`skills/claude-map/SKILL.md`** updated to prefer MCP tools when available, with the CLI as fallback.
- **esbuild** now builds two entries: `dist/cli.js` + `dist/mcp-server.js`.

### Added — Tier 1 UX improvements
- **Smart default**: `claude-map` (no args) auto-picks the latest session for the current cwd's project; falls back to globally latest with a notice.
- **`--phases-only`**: collapse sub-actions; show only user-prompt phase headers — 5×↑ navigation speed on long sessions.
- **Phase metadata**: phase labels carry `(N actions · M files · T min)` so users gauge weight without expanding.
- **Git context in snapshots**: snapshot markdown auto-appends branch / HEAD / recent commits / working-tree status (best-effort, soft-fail). New session pasted with the snapshot now knows the source code state.

### Added — Tier 2 navigation utilities
- **`--picks`**: list every recorded pick across every session.
- **`--unstar <id>`**: remove ⭐ from a previously picked node (cleans `picks.jsonl`).
- **`--diff <a> <b>`**: summarise event range / files / tools between two nodes.

### Pivot — File-tree style hierarchy
- Segments are now grouped into **phases**: each significant user prompt becomes a phase header (📌-style), and the assistant's subsequent file-edit / tool-call segments become sub-actions under it. Tree depth = 2 (root → phases → actions). Read like a `tree` command.
- ⭐ marks previously picked nodes (GitHub starring semantics — single emoji regardless of mode).
- All emoji-as-icon noise removed from labels; format itself differentiates: `"..."` = user prompt phase, `file.ts (Tool)` = sub-action.
- TTY-only ANSI colorization (cyan for user phases, yellow for starred nodes, dim for time/range).
- System-noise user turns (`<task-notification>...`) no longer surface as labels.
- Micro-segments (≤1 event) are merged into their successor.

### Intentionally NOT pursued
- **LLM phase labeling** (`Tier 3 J`): user-turn-based phases already convey intent. LLM-generated narratives would add cost ($0.10–0.20/session) and external-API dependency without material UX gain.
- **Cross-session vector search** (`Tier 3 K`): `grep -r ~/.claude/projects/` covers the same need without an embedding store; product complexity not justified.

### Removed (BREAKING)
- **HTML / browser mode dropped entirely.** `--html`, `--no-open`, `--collapse-depth`, `--branch-mode`, `--out`, `--lang`, `--force` flags removed. The `markmap-view` and `d3` runtime dependencies are gone (42 transitive packages dropped). The `src/render/markmap.ts`, `src/render/template.html`, `src/utils/browser_open.ts` modules and their tests are deleted. Per user request, `agent-tree (was oh-my-claude-map)` is now strictly a terminal-only tool: every output mode prints to stdout/stderr (text tree, snapshot markdown, TUI). HTML cache (`writeHtmlCache` / `readHtmlCache` / `copyHtmlFromCache`) and the `mindmap.html` artifact are gone — the per-input cache directory still holds optional `segments.json` / `tree.json` / `graph.json` for `--verbose` debugging.
- **Snapshot factory now accepts `redactor`** so secret leaks in verbatim user-text quoting (previously caught by the deleted render-stage `redactDeep`) stay protected end-to-end.

### Added
- **M1 — Ingestion & segmentation** (SPEC §7.1–7.2)
  - Streaming JSONL parser with graceful degrade on malformed lines.
  - DAG reconstruction via `parentUuid` chain, cycle + orphan detection.
  - 6-signal heuristic segmentation (time gap, file Jaccard, topic-shift phrases, slash command, sidechain transition, turn-count force split).
  - CLI `--dump-json <dir>` for raw artifacts.
  - Empirical RawEvent union widened for observed types beyond SPEC §6: `system`, `last-prompt`, `file-history-snapshot`, `queue-operation` (Appendix D.4 M1 discovery task completed).
- **M2 — Mindmap render** (SPEC §7.4 · §7.7)
  - 2-depth MindMap build: session root, topic-segment children, dedicated `🔀 Sidechains` bucket.
  - markmap-view root JSON + self-contained HTML template with dark/light auto-theme, click popup, keyboard `C`/`F`/`Esc`, ARIA tree role.
  - Cross-platform `browser_open` helper (macOS `open`, Linux `xdg-open`, Windows `cmd /c start`).
  - ContextSnapshot placeholders for continue/fork (shape-complete, content filled in M3).
- **M3 — LLM labeling** (SPEC §7.3)
  - Anthropic SDK wrapper with `cache_control: ephemeral` on the system block, exponential backoff on 429, 30s hard timeout.
  - Per-segment `labelMindMap` with parallel throttle (default 3) and token-budget ceiling.
  - Snapshot narrative upgrade: LLM-derived `summary`, `next_steps`, verbatim last-user-turn extraction.
  - Graceful degrade: per-segment failure keeps heuristic label without aborting the run.
- **M4 — Privacy & cache** (SPEC §7.6 · §7.9 · §19)
  - `utils/redact.ts` — 10 default patterns (API keys, tokens, JWTs, PEM blocks), strict mode adds email / phone / card (Luhn-gated) / SSN / RRN.
  - Redaction applied at two chokepoints: LLM user message, HTML `window.OMCM` bundle.
  - Content-hash disk cache at `~/.cache/claude-map/<hash>/mindmap.html` — warm-cache rerun under 200ms on the 872-line smoke session.
  - `--force`, `--redact-strict`, `--redact-dryrun` flags.
- **M5 — Config & polish** (SPEC §17)
  - YAML config loader with layered precedence (CLI > env > user config > project config > defaults).
  - Remaining CLI flags: `--pick`, `--lang`, `--branch-mode`, `--include-sidechains` / `--flatten-sidechains` / `--drop-sidechains`.
  - Interactive session picker across every project.
  - GitHub Actions CI (lint + typecheck + test + build on every PR and push to `main`).
  - README with CLI flag catalog, privacy notes, architecture diagram.

### Post-M5 product pivot — in-session text mindmap (default)
- **Default UX is now in-session**, not a browser pop-up. The CLI prints a numbered ASCII tree to stdout (or runs an interactive readline picker on a TTY) and returns the chosen node's resume markdown to stdout. The legacy HTML mindmap is preserved behind `--html`.
- New CLI modes: `--list` (numbered tree, skill-friendly), `--snapshot <id> --mode continue|fork` (single snapshot to stdout), `--tui` (interactive). Default: TTY → tui, non-TTY → list.
- New module split: `src/cli/options.ts`, `src/cli/pipeline.ts`, `src/cli/modes.ts`, `src/cli/tui.ts`. The old `cli.ts` shrank from 561 to ~196 lines.
- New `src/render/text.ts` produces the deterministic numbered tree.
- New `skills/claude-map/SKILL.md` so a Claude Code session can show the mindmap inline (drop into `~/.claude/skills/`).
- **UX bug fix**: snapshots no longer leak internal milestone jargon (`(M3 narrative placeholder)`, `(M4 will paste...)`) when running with `--no-llm`. The `tree/context_snapshot.ts` factory now extracts the verbatim last-user turn from segment events (no LLM required) and gracefully omits LLM-only sections.

### Cleanup loops (maintenance)
- **Loop 1**: cli.ts decomposed into `cli/{options,pipeline,modes,tui}.ts`. Long-function smell gone.
- **Loop 2**: dropped unused `markmap-lib` dependency (we'd built our own tree). Removed 37 transitive packages.
- **Loop 3**: `MindMapNode.segment_id` introduced. Labeler now does an exact-id O(1) lookup; the previous first-uuid identity was theoretically corruptible.
- **Loop 4**: `--list` / `--snapshot` modes suppress the `[N/5]` progress lines so skill output stays clean.
- **Loop 5**: dropped bespoke `jsEscape` — values that go inside `<script>` blocks now use `JSON.stringify`, which spec-correctly handles U+2028 / U+2029 / quotes / newlines.
- **Loop 6**: SPEC §18.3 — verbose mode mirrors `segments.json`, `tree.json`, `graph.json` to the per-input cache dir for inspection without re-running.

### Post-M5 hardening (architect review follow-ups)
- **Offline-safe HTML**: d3 + markmap-view no longer loaded from jsDelivr CDN — both browser bundles are inlined at render time. Generated HTML works fully offline (SPEC §11 acceptance #7). Total size ~401 KB, still under the 500 KB budget.
- **SDK compatibility guard**: `@anthropic-ai/sdk` bumped 0.32 → 0.90. A non-emitting type-only `__sdkCompatibilityGuard` in `src/llm/anthropic.ts` exercises the exact `messages.create` call shape we rely on, so future SDK drifts (e.g. `Usage.cache_creation_input_tokens` becoming `number | null`) fail CI before shipping.
- **Redaction end-to-end integration test**: new `tests/integration.test.ts` runs the full pipeline on a secret-laden fixture and asserts zero leak for 10+ patterns. Found + fixed a real truncation-leak bug: first-user-msg was sliced below the API-key regex's 20-char minimum before the render-stage redactor ran, so partial fragments escaped. Redactor now applied at `tree/builder.ts` before truncation.

### Known gaps (intentional post-M5 scope)
- `/wrap` Stop-hook auto-trigger (v1.1).
- Obsidian Canvas export (v1.1).
- Multi-session cross-analysis (v2).
- `--share-safe` mode that strips raw snapshots for external sharing (v2).
- Homebrew tap (v2).
