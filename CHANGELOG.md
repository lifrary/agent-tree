# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/) and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

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
