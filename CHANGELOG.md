# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/) and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Docs: README rewrite + agent-friendly surface (2026-04-26)

Rewrote `README.md` for v0.1.2 accuracy and added a top-level
"For agents (LLMs handed this URL)" section. Modern agentic workflows
often hand a repo URL to an LLM with no other context; the new section
provides:

- Identity block (package / repo / version / runtime / data source)
- One-shot self-test sequence (isolated `/tmp` install + `--version` /
  `--help` / `--list`); see "self-test npx form" note below for why
  bare `npx` is unreliable here
- MCP tool schemas — zod-derived JSON, copy-paste-ready
- Common task recipes ("user says X → call Y")
- Constraints + failure modes (no `~/.claude/projects/` data, in-progress
  sessions, ambiguous prefix, LLM cost, redaction, MCP path resolution
  per marketplace type)
- Pointer table to `CHANGELOG` / `SKILL.md` / `src/mcp/server.ts` /
  `src/cli/options.ts` / `RELEASING.md` / `CONTRIBUTING.md`

Also refreshed stale references across the doc set:

- README test count `113 / 12 → 134 / 12` and pattern count
  `10 default → 16 default` (5 strict). Original "10 default" was a much
  earlier number; the v0.1.2 audit added several token classes (slack,
  github_pat_finegrained, openai_project_key, stripe, huggingface, npm,
  gcp_oauth, aws_temp). The v0.1.2 CHANGELOG line "all 14 DEFAULT_PATTERNS"
  was itself stale — direct count of `name:` entries between
  `DEFAULT_PATTERNS` and `STRICT_EXTRA` in `src/utils/redact.ts` is 16
- README self-test npx form. Earlier draft used
  `npx -y @seungwoolee/agent-tree --version` which silently fell back
  to npx's own `--version` (returning the npm version `10.9.4`, not the
  package). Multi-bin packages (`agent-tree` + `atree`) need the
  explicit bin name: `npx -y @seungwoolee/agent-tree agent-tree --version`.
  Confirmed by running all three self-test steps in `/tmp` against the
  published 0.1.2 tarball
- README plugin-cache verification path `0.1.0` → version-agnostic glob
  `*` so future bumps don't immediately re-stale the troubleshooting steps
- README MCP smoke example now points to the bundled `/mcp-smoke` slash
  command instead of an inline `tools/list` echo (which lacked the
  spec-required `initialize` handshake under SDK 1.29)
- `CONTRIBUTING.md` test count `113 / 12 → 134 / 12`
- `skills/agent-tree/SKILL.md` `npx oh-my-agent-tree …` →
  `npx -y @seungwoolee/agent-tree …` (the legacy package name predates
  the rebrand chain `oh-my-claude-map → claude-map → claude-tree → agent-tree`)

## [v0.1.2] — 2026-04-24

### Security: token-class boundary audit (2026-04-24)

Two built-in redaction patterns had a latent class/`\b` bug that let
trailing-`-` tokens leak. `\b` requires a word↔non-word transition, but
classes like `[A-Za-z0-9_-]` include both word and non-word characters.
When a token happened to end on `-` (non-word) and the next char was also
non-word (space / `.` / EOF), `\b` couldn't match at the seam:

- **`jwt`** — base64url signature can legally end in `-` or `_` (RFC 4648
  §5). With fixed `{10,}` minimums the engine either truncated the match
  one byte short (leaking the trailing dash) or couldn't match at all
  when the signature ended in multiple dashes.
- **`gcp_api_key`** — fixed-length `{35}` so no length backtracking. A
  trailing `-` on the key made `\b` fail and the entire key leaked.

Fix: replace trailing `\b` with a negative lookahead `(?![A-Za-z0-9_-])`
against the same class, which terminates correctly regardless of
word-ness at the seam (including at EOF).

Audited all 14 `DEFAULT_PATTERNS` + 5 `STRICT_EXTRA` entries for the same
shape; `hf_token`, `bearer_token`, `aws_*`, `stripe_*`, `github_pat_*`,
and `npm_token` are already safe by construction and are now locked in
via `tests/security-hardening.test.ts` "token class-boundary audit" block.

### Safety: indirect-cycle guard in `buildGraph` (2026-04-24)

`src/reader/graph.ts` previously caught only direct self-reference
(`parentUuid === uuid`). A duplicate-uuid jsonl entry with a conflicting
`parentUuid` synthesizes an indirect cycle (A↔B, or deeper), which a
downstream tree walker would follow into infinite loop. Added an
iterative DFS post-build pass that detects back-edges against the active
traversal stack and splices them from the `childrenOf` map; returned
graph is now guaranteed acyclic regardless of jsonl pathology. Iterative
form avoids stack overflow on long linear parent chains. Test fixtures
in `tests/graph.test.ts`: cycle break, diamond preservation, empty graph.

### Safety: ReDoS fuzz guard for `redaction.extra_patterns` (2026-04-24)

`config.redaction.extra_patterns` compiles user-supplied strings into
RegExps that then run against every string flowing through the redactor
sinks. A pathological pattern like `/(a+)+b/` would hang the entire CLI
on innocent input — self-DoS. Added `passesRedosFuzz` (exported from
`src/cli/pipeline.ts`) that each candidate must clear before joining the
redactor:

1. Syntactic pre-filter — rejects classic nested-quantifier and
   alternation-overlap shapes (`(x+)+`, `(x*)*`, `(x|x)*`) that cover
   most practical ReDoS without having to run the regex at all.
2. Short-input probe — 20-char worst-case inputs run against the
   compiled regex with a 50ms per-probe budget. Catches patterns that
   slip past the syntactic filter. Input size is deliberately tiny
   because JavaScript's RegExp is uninterruptible, so long probes would
   be vulnerable to the very DoS they're meant to detect.

Patterns that fail are dropped with a `logger.warn`; the rest of
`extra_patterns` still ships.

### Perf: MCP pipeline LRU cache (2026-04-24)

The MCP server's 4 session-bound tools (`agent_tree_list`, `snapshot`,
`diff`, `unstar`) each re-parsed the entire JSONL on every call. A
typical agent workflow (list → snapshot → diff on the same session)
redid all of that work 3×. Added a 3-entry in-process LRU in
`src/mcp/server.ts`'s `pipelineFor`, keyed on
`sessionId:jsonlPath:mtimeMs`. mtime in the key means an in-progress
session that gains new events between calls invalidates automatically.
Size 3 covers the common list/snapshot/diff pattern with one spare while
keeping resident memory modest (a pipeline result carries graph +
segments + mindmap, ~MB scale for long sessions).

### Safety: `git.ts` stdout byte cap (2026-04-24)

`runGit()` was accumulating the entire child stdout into a JS string
with no bound — `git status --short` in a massive monorepo, or an
unexpectedly noisy flag, could stream megabytes before the process
closed. Cap at 32 KB (`STDOUT_CAP_BYTES`); once reached the handler
kills the child and returns the partial output. Downstream formatter
already truncates to ~800 chars so this is strictly a memory guard, not
a behavior change.

### Safety: `picks.ts` tmp-filename collision (2026-04-24)

`removePicksForNode` wrote a tmp file at `${file}.tmp-${pid}-${ms}` then
renamed. Two processes with a recycled pid landing in the same
millisecond would collide; modern OSes recycle pid space aggressively.
Added 4 random bytes (8 hex chars via `crypto.randomBytes(4)`) to the
suffix; collision now requires ≥32-bit entropy collision on top of the
pid+ms match.

### Code quality: `resolveSession` discriminated union (2026-04-24)

`src/cli.ts#resolveSession` previously returned `SessionMatch | null |
undefined` — null meant "user cancelled, exit 130", undefined meant "not
found, exit 2". Caller disambiguated via `match === null ? 130 : 2`.
Converted to a discriminated union `{ ok: true; match } | { ok: false;
reason: 'cancelled' | 'not_found' }` so the exit-code mapping is
explicit and typechecked; no more hidden fragility at the null /
undefined seam.

### Tests: 119 → 134 (+15)

- `tests/security-hardening.test.ts`: +6 "token class-boundary audit"
  + +6 "passesRedosFuzz" = +12 total.
- `tests/graph.test.ts`: +3 (indirect cycle break, diamond preservation,
  empty-events safety).

## [v0.1.1] — 2026-04-24

### Security: CLI snapshot now uses `safeGitCwd` (2026-04-24)

`agent-tree --snapshot` was feeding the raw `cwd` field from JSONL into
`getGitContext` without going through the `safeGitCwd` realpath /
absolute / null-byte guard that the MCP tool already used. An attacker-
authored session could point `cwd` at a directory with a poisoned
`.git/config` (CVE-2022-24765) and achieve arbitrary command execution
on `agent-tree --snapshot` via `git` auto-evaluating `core.pager` /
`core.sshCommand` / `core.fsmonitor` hooks. Fix routes through
`safeGitCwd(eventsCwd, process.cwd())` — parity with `src/mcp/server.ts`.
Closes parity gap flagged by the v0.1.1 pre-ship security audit.

### Added — `npm_token` redact pattern (2026-04-24)

Developers routinely paste `.npmrc` snippets (including the
`//registry.npmjs.org/:_authToken=npm_<36 alnum>` line) into chat while
debugging publish failures. Added `/\bnpm_[A-Za-z0-9]{36}\b/g` to
`DEFAULT_PATTERNS`; test at `tests/security-hardening.test.ts`.

### MCP manifest location fix (2026-04-24)

The plugin's MCP server is now declared **inline** in
`.claude-plugin/plugin.json` via an `mcpServers` object, replacing the prior
external `.mcp.json` file reference. The file itself is deleted.

**Root cause (original bug)**: `.claude-plugin/.mcp.json` was nested under
`.claude-plugin/`, but Claude Code resolves `plugin.json`'s
`"mcpServers": "./.mcp.json"` relative to the **plugin root**, not the
`plugin.json` file's own directory. So it looked for
`${plugin_root}/.mcp.json`, didn't find it, and silently skipped MCP
registration. The plugin appeared in `claude plugin list` and in
`settings.json#enabledPlugins`, but `claude mcp list` omitted `agent-tree`
entirely and no `mcp__agent_tree__*` tools surfaced in-session. Direct
spawn of `dist/mcp-server.js` always worked — the server was healthy;
discovery was broken.

**Why inline instead of moving `.mcp.json` to plugin root**: Claude Code
*also* auto-discovers `.mcp.json` at any cwd as a **project-scope** MCP
config. For a plugin whose developer runs `claude` inside the plugin's own
source directory, that double-duty filename produces a duplicate registration
where `${CLAUDE_PLUGIN_ROOT}` never gets substituted — one broken entry in
`claude mcp list` per developer session. Moving the file to plugin root
would fix the discovery bug but keep the collision. Inline
(`plugin.json#mcpServers` as `object`) kills both issues: no file, no
collision, and the schema supports it — per [plugins-reference](https://code.claude.com/docs/en/plugins-reference#plugin-manifest-schema)
`mcpServers` is `string | array | object`.

- **Added** — `.claude-plugin/plugin.json#mcpServers` inline block:
  `{"agent-tree": {"command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/dist/mcp-server.js"]}}`
- **Deleted** — `.claude-plugin/.mcp.json` (no longer needed)
- **Unchanged** — `.gitignore` keeps `.mcp.json` ignored at root (with an
  explanatory comment); no allowlist needed since we ship nothing by that name

### Phone regex ReDoS hardening (2026-04-24)

The strict-mode phone pattern used three optional separators inside an
outer-optional prefix group — classic nested-optional structure whose
worst-case backtracking was quasi-exponential on long digit-only input.
The fix splits intent into two patterns:

- **`phone_e164`** — `/\+\d{8,15}\b/g`. International format with required
  `+` prefix, pure-digit bounded run. No backtracking at all.
- **`phone`** — `/(?<!\w)(?:\+\d{1,3}[-.\s])?\(?\d{2,4}\)?[-.\s]\d{3,4}[-.\s]\d{3,4}\b/g`.
  Middle separators now required (not `?`), removing the nested optional.
  Leading `(?<!\w)` replaces `\b` so a leading `(` in `(415) 555-0123` is
  still captured. Pure-digit domestic numbers without separators are
  intentionally not matched — the false-positive risk on order numbers /
  SKUs / IDs outweighed the extra recall.

Fuzz tests in `tests/security-hardening.test.ts` verify that
`'1'.repeat(1000) + 'x'` and `'1-'.repeat(500) + 'x'` both complete in
<200 ms, and that common formats (`010-1234-5678`, `(415) 555-0123`,
`+82 10-1234-5678`, `+14155550123`) still redact correctly. Test count:
113 → 118.

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
