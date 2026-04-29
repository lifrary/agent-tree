# agent-tree

> Navigate any Claude Code session as a numbered file-tree in your terminal — and resume from any node.

[![npm version](https://img.shields.io/npm/v/@seungwoolee/agent-tree.svg?color=cb3837&label=npm)](https://www.npmjs.com/package/@seungwoolee/agent-tree)
[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Node ≥20](https://img.shields.io/badge/node-%E2%89%A520-brightgreen.svg)](https://nodejs.org/)

A finished Claude Code session can run thousands of turns across hours of work. Linear end-of-session summaries flatten that into prose and lose the branches, dead-ends, and good-but-discarded ideas. **`agent-tree`** parses the session JSONL into a `tree`-style hierarchy you read directly in your terminal: each user-prompt is a phase, each segment underneath is a sub-action, and any node you've previously resumed from is marked with ⭐. Pick a number, and the resume markdown lands on your clipboard ready to paste into a fresh `claude` session.

> Built for Claude Code today. Designed to extend to Codex / Gemini sessions tomorrow — hence the agent-neutral name.

If an LLM agent landed on this README from a bare repo URL, jump to **[For agents (LLMs handed this URL)](#for-agents-llms-handed-this-url)** for an identity block, self-test sequence, MCP tool schemas, and common task recipes.

## What it looks like

```
agent-tree · session fd8b7e83 · 8602 events · 1916 turns · 210 nodes · 2707 min

 1. 🎯 Build agent-tree per SPEC.md v0.3                                        (root)
 2. ├─ "Read SPEC.md — self-contained spec v0.3 …"   (23 actions · 21 files · 19min) T0      events 0–40
 3. ├─ "Implement milestones M1 through M5 end-to-end"  (24 actions · 19 files · 14min) T+1h 8m   events 1362–1494
 4. ├─ ⭐ "Must run strictly inside the terminal"        (15 actions · 15 files · 12min) T+23h 43m events 5885–5918
 5. ├─ "Layout is secondary — think file-tree hierarchy"  (1 action · 1 file · 3min)    T+24h 44m events 6583–6587
 6. └─ ⭐ "Polish the output carefully"                   (9 actions · 9 files · 4min)  T+43h 17m events 7077–7144

Pick a number to copy that node's resume context.
  N        → continue mode (preserve decisions, change direction)
  N fork   → fork mode (discard subsequent turns)
  N c / N f → shorthand
```

Phase headers are cyan on TTY, ⭐ marks are yellow, `T+1h 8m` / `events 0–40` are dimmed. `--phases-only` collapses sub-actions for fast navigation; default view expands them.

## Install

### Try without installing globally

```bash
mkdir -p /tmp/atree && cd /tmp/atree
npm init -y >/dev/null && npm install @seungwoolee/agent-tree
./node_modules/.bin/agent-tree --list
```

A bare `npx -y @seungwoolee/agent-tree …` form does **not** work — the package ships two bins (`agent-tree`, `atree`) so npx 10+ can't auto-resolve from the package name alone. The isolated-install pattern above is what the bundled `/mcp-smoke` slash command uses, so it's regression-tested every release. See [Why not bare `npx`?](#why-not-bare-npx) below for the full trap.

### As a global CLI

```bash
npm install -g @seungwoolee/agent-tree
```

Two bins are exposed: `agent-tree` (primary) and `atree` (alias).

### As a Claude Code plugin (recommended for in-session use)

The plugin manifest ships an MCP server so the tools surface natively in every Claude Code session — no subprocess spawn, no `--no-llm` juggling.

`~/.claude/plugins/local/` is **not** auto-scanned, so a plain `git clone` there will not register the plugin. The canonical registration path uses Claude Code's plugin CLI:

```bash
# Option A — directly from GitHub (recommended)
claude plugin marketplace add github:lifrary/agent-tree
claude plugin install agent-tree@agent-tree

# Option B — from a local clone (contributors / live dev)
git clone https://github.com/lifrary/agent-tree
cd agent-tree
npm install && npm run build     # optional — dist/ is committed; rebuild only after editing src/
claude plugin marketplace add "$PWD"
claude plugin install agent-tree@agent-tree
```

**Restart Claude Code.** The plugin loader only spawns MCP servers at session start, so changes to `installed_plugins.json` need a restart to take effect.

After restart, `/mcp` should list `agent-tree` with status `connected` and 5 tools beneath it. Or invoke the tool directly in chat:

```
> Use agent_tree_list with cwd="/path/to/any/project"
```

Claude Code calls the tool and returns a numbered file-tree of that project's most-recent session.

#### Troubleshooting the install

If the tools don't surface:

1. Confirm the plugin is CLI-registered and enabled:
   ```bash
   claude plugin list | grep agent-tree   # → should show "Status: ✔ enabled"
   ```
2. Confirm the cache has the MCP server file (version-agnostic glob):
   ```bash
   ls ~/.claude/plugins/cache/agent-tree/agent-tree/*/dist/mcp-server.js
   ```
3. Restart Claude Code (the plugin loader only spawns MCP servers at startup).
4. After a version bump, refresh the cache. `claude plugin install` is idempotent — re-running it on an already-registered plugin is a silent no-op, so uninstall first:
   ```bash
   claude plugin uninstall agent-tree@agent-tree
   claude plugin install agent-tree@agent-tree
   ```
5. Smoke-test the published tarball end-to-end. If you cloned this repo, the bundled slash command `/mcp-smoke` runs a clean `/tmp` install + spec-compliant MCP `initialize` + `tools/list` + 5-tool assertion. Otherwise see [`RELEASING.md`](./RELEASING.md) Step 7 for the manual JSON-RPC sequence.

## Quickstart

```bash
# Smart default — interactive picker for the latest session of the current project
agent-tree

# Print the file-tree to stdout (skill / pipe friendly)
agent-tree --list

# Use a specific session by UUID prefix
agent-tree 69c2f35e --list

# Phase-only view for fast navigation
agent-tree --list --phases-only

# Resume from a node by display number — markdown to stdout, clipboard on TTY
agent-tree 69c2f35e --snapshot 7 --mode continue
agent-tree 69c2f35e --snapshot 12 --mode fork

# Filter long sessions
agent-tree 69c2f35e --list --filter "auth"

# Pick history across every session
agent-tree --picks

# Compare two nodes
agent-tree 69c2f35e --diff 7 12

# Remove a star you regret
agent-tree 69c2f35e --unstar 7
```

Default routing:

- **TTY stdout** (you in your terminal) → interactive picker (`--tui`)
- **non-TTY** (piped, redirected, or invoked from a skill) → list mode (`--list`)

Snapshots auto-copy to your system clipboard on TTY (`pbcopy` / `xclip` / `clip`); paste into a fresh `claude` session as the first message and resume.

## Continue vs Fork

| Mode         | When to use                                                                                                            |
| ------------ | ---------------------------------------------------------------------------------------------------------------------- |
| **Continue** | Decisions up to this point were good — keep going from here, skipping whatever the session did next.                   |
| **Fork**     | Re-try this moment with the subsequent turns erased, exploring a different direction entirely.                         |

The pick is recorded either way; ⭐ is GitHub-style binary (no per-mode bookkeeping).

## CLI flag catalog

| Flag                                                                | Default              | Notes                                                       |
| ------------------------------------------------------------------- | -------------------- | ----------------------------------------------------------- |
| `<session-id>`                                                      | smart default        | UUID or short prefix; positional                            |
| `--latest`                                                          | —                    | force globally most-recent session                          |
| `--pick`                                                            | —                    | interactive picker over recent sessions                     |
| `--list`                                                            | (auto on non-TTY)    | print file-tree to stdout                                   |
| `--snapshot <id>`                                                   | —                    | print one node's resume markdown to stdout                  |
| `--mode <continue\|fork>`                                           | `continue`           | snapshot mode                                               |
| `--tui`                                                             | (auto on TTY)        | interactive readline picker                                 |
| `--phases-only`                                                     | off                  | hide sub-actions, show only user-prompt headers             |
| `--filter <kw>`                                                     | —                    | case-insensitive label/time/range match                     |
| `--no-group`                                                        | grouped              | disable consecutive same-file collapsing                    |
| `--no-color`                                                        | colored on TTY       | force-disable ANSI                                          |
| `--picks`                                                           | —                    | list every pick across every session                        |
| `--unstar <id>`                                                     | —                    | remove ⭐ from a previously picked node                     |
| `--diff <from> <to>`                                                | —                    | summarise event range / files / tools between two nodes     |
| `--no-llm`                                                          | LLM on if key set    | skip Anthropic call, heuristic labels only                  |
| `--model <name>`                                                    | `claude-sonnet-4-6`  | Anthropic model for LLM labeling                            |
| `--max-llm-tokens <n>`                                              | `50000`              | input token budget ceiling                                  |
| `--redact-strict`                                                   | off                  | add PII patterns (email/phone/SSN/RRN); card check always on |
| `--redact-dryrun`                                                   | off                  | print redaction hit counts to stderr                        |
| `--include-sidechains` / `--flatten-sidechains` / `--drop-sidechains` | include            | subagent (Task-tool) handling                               |
| `--dry-run`                                                         | off                  | run pipeline, emit no output                                |
| `--dump-json <dir>`                                                 | —                    | dump intermediate artifacts (raw / graph / segments / tree) |
| `-v, --verbose` / `--trace`                                         | —                    | log levels                                                  |

Run `agent-tree --help` for the canonical list. The flag definitions live in [`src/cli/options.ts`](./src/cli/options.ts).

## MCP tools

When this plugin is installed, five tools surface natively in every Claude Code session:

| Tool                  | Purpose                                                                  |
| --------------------- | ------------------------------------------------------------------------ |
| `agent_tree_list`     | numbered file-tree of a session (with phase grouping, filter, ⭐)       |
| `agent_tree_snapshot` | resume markdown for one node (continue/fork) + git context, records pick |
| `agent_tree_picks`    | every recorded pick across every session                                 |
| `agent_tree_diff`     | event range / files / tools between two nodes                            |
| `agent_tree_unstar`   | remove ⭐ from a previously picked node                                 |

Example invocation from chat:

```
> Use agent_tree_list with cwd="/Users/alice/Code/myproject", phasesOnly: true
```

The tools are zod-validated. Full schemas + agent-friendly recipes live in [For agents](#for-agents-llms-handed-this-url) below; canonical definitions live in [`src/mcp/server.ts`](./src/mcp/server.ts).

The bundled skill ([`skills/agent-tree/SKILL.md`](./skills/agent-tree/SKILL.md)) tells Claude Code to prefer MCP tools and fall back to the CLI when the server isn't connected.

## For agents (LLMs handed this URL)

This section is for LLM agents who've been pointed at this repo with little other context. Top-down: identity → self-test → tool schemas → recipes → constraints. Everything below is intentionally machine-friendly (literal commands, fenced JSON shapes, table-driven recipes).

### Identity

```
package    @seungwoolee/agent-tree
repo       https://github.com/lifrary/agent-tree
version    0.1.2 (npm badge above shows latest)
bins       agent-tree, atree
runtime    Node.js ≥ 20
mode       terminal-only — no browser, no HTML, all output is text/markdown
data       reads ~/.claude/projects/<encoded-cwd>/*.jsonl
license    MIT
```

The encoded-cwd rule: a session's JSONL lives at `~/.claude/projects/<cwd-with-slashes-replaced-by-dashes>/<session-uuid>.jsonl`. Example: cwd `/Users/alice/Code/myproject` → `~/.claude/projects/-Users-alice-Code-myproject/`. The CLI's smart-default uses the caller's cwd to find the right encoded directory automatically.

### One-shot self-test

If you have shell access, run this sequence to confirm install + spot-check capability. Uses an isolated `/tmp` dir (no global pollution) — the same pattern the bundled `/mcp-smoke` slash command uses, so this path is regression-tested every release:

```bash
mkdir -p /tmp/atree-probe && cd /tmp/atree-probe
npm init -y >/dev/null && npm install @seungwoolee/agent-tree

# 1) Identity — package version.
./node_modules/.bin/agent-tree --version
# → 0.1.2 (or newer)

# 2) Bin runs (no JSONL data required).
./node_modules/.bin/agent-tree --help | head -20
# → Usage / Options / commands (commander-style)

# 3) Data probe — does any session JSONL exist on this machine?
./node_modules/.bin/agent-tree --list 2>&1 | head -5
# → tree header, or "(no session in this project — falling back to globally
#   latest: <uuid>...)" if the cwd lacks data, or "No agent-tree session JSONL
#   files found..." on a totally fresh machine.
```

#### Why not bare `npx`?

`npx -y @seungwoolee/agent-tree --version` does **not** work as you'd expect: the package ships two bins (`agent-tree` and `atree`) so npx 10+ can't auto-resolve from the unscoped package name alone, and `--version` falls through to npx's own version output (returning the npm version `10.9.4`, not `0.1.2`). The form `npx -y @seungwoolee/agent-tree agent-tree --version` works for `--version` and `--help` (because commander short-circuits on those flags before parsing positionals), but breaks `--list` because npx passes the bin name through as an arg and commander reads it as the `[session-id]` positional. The isolated-install form above sidesteps all of that.

For users who insist on a one-shot global install: `npm install -g @seungwoolee/agent-tree && agent-tree --version` is the simple form.

### Capability surfaces

Three ways an LLM can invoke agent-tree:

1. **CLI** — when you have shell access. Smart-default picks the latest session in `cwd`'s project. Pipe to `head` / `grep` for filtering.
2. **MCP tools** — when you ARE Claude Code with this plugin installed. Five `agent_tree_*` tools, zod-validated, no subprocess spawn.
3. **Skill** — auto-loaded by Claude Code when this plugin is installed. The skill prompt at `skills/agent-tree/SKILL.md` defines when to invoke and how to format output.

If you're a non-Claude-Code agent (Codex, Gemini, custom): only the CLI path is available today. v0.2 will add direct adapters for non-Claude session formats — see [Roadmap](#roadmap).

### MCP tool schemas

All five tools are stdio-only (the plugin loader spawns a child process). Inputs are zod-validated; pass JSON. Responses follow the MCP envelope:

```jsonc
// Success
{ "content": [{ "type": "text", "text": "<markdown body>" }] }

// Failure (no match, ambiguous prefix, missing node, etc.)
{ "content": [{ "type": "text", "text": "<error message>" }], "isError": true }
```

#### `agent_tree_list`

Render a numbered ASCII tree of a session. Phase headers (user prompts) at depth 1, sub-actions at depth 2.

```jsonc
{
  "cwd":        "string",        // required — caller cwd, used for smart-default session pick
  "sessionId":  "string?",       // optional — UUID prefix (≥8 chars). Omit for cwd's latest.
  "phasesOnly": "boolean?",      // optional — show only phase headers, hide sub-actions
  "filter":     "string?"        // optional — case-insensitive keyword on labels / time / range
}
```

Returns a tree like:

```
Session 69c2f35e (-Users-alice-Code-myproject)

agent-tree · session 69c2f35e · 230 turns · 26 nodes · 62 min

 1. 🎯 Setup auth flow                                       (root)
 2. ├─ "Wire up Auth0 redirect URLs" (15 actions · 12 files · 8 min) T0     events 0–48
 ...

(⭐ = previously picked — 3 starred, 7 total picks)
```

#### `agent_tree_snapshot`

Get the resume markdown for a specific node. Records the pick (⭐) for future display.

```jsonc
{
  "cwd":       "string",          // required
  "nodeId":    "string",          // "7" (display number) or "n_007" (raw id)
  "mode":      "continue|fork",   // continue = preserve decisions; fork = discard subsequent turns
  "sessionId": "string?"
}
```

Returns markdown that pastes directly into a new `claude` session as the first message. Show it to the user verbatim inside a fenced code block — any reformatting (line break tweaks, prose around it) breaks tool-use blocks.

#### `agent_tree_picks`

List every pick across every session. Shows session id × node × mode × timestamp.

```jsonc
{
  "cwd": "string?"   // optional — currently unused, kept for shape symmetry
}
```

#### `agent_tree_diff`

Summarize what happened between two nodes (event range, files touched, tools used).

```jsonc
{
  "cwd":       "string",
  "from":      "string",          // "7" or "n_007"
  "to":        "string",          // "12" or "n_012"
  "sessionId": "string?"
}
```

#### `agent_tree_unstar`

Remove the ⭐ marker from a previously picked node (deletes its pick history entries).

```jsonc
{
  "cwd":       "string",
  "nodeId":    "string",
  "sessionId": "string?"
}
```

### Common task recipes

| User says                                        | What to call                                                              |
| ------------------------------------------------ | ------------------------------------------------------------------------- |
| "show me what we worked on yesterday in <repo>"  | `agent_tree_list({ cwd: "<repo>", phasesOnly: true })`                    |
| "go back to where we set up auth"                | `agent_tree_list({ cwd, filter: "auth" })` then `agent_tree_snapshot`     |
| "I want to try a different direction at step 7"  | `agent_tree_snapshot({ cwd, nodeId: "7", mode: "fork" })`                 |
| "what changed between steps 3 and 11?"           | `agent_tree_diff({ cwd, from: "3", to: "11" })`                           |
| "remove the star from node 4"                    | `agent_tree_unstar({ cwd, nodeId: "4" })`                                 |
| "show me all my saved bookmarks"                 | `agent_tree_picks({})`                                                    |

After `agent_tree_list`, **show the tree verbatim** in a fenced code block — wide-char alignment + ⭐ + ANSI-stripped output is meant to be displayed, not paraphrased. Same for `agent_tree_snapshot` markdown — the user pastes it into a new session, and reformatting breaks it.

### Constraints / failure modes

- **No `~/.claude/projects/` data → no output.** agent-tree reads from there. A fresh machine (no prior Claude Code sessions) gets a friendly "no JSONL found" message; there's no fallback data source.
- **In-progress sessions are lossy.** The tool needs a finalized JSONL. Don't run it against a session that's still being written — the parse will be incomplete or fail.
- **Ambiguous session prefix → error.** If `sessionId: "fd"` matches multiple sessions, the tool returns an error asking for a longer prefix. Use ≥8 chars for stability.
- **LLM labeling costs money.** Default skill mode is `--no-llm` (heuristic labels). Don't enable `--llm` without warning the user about cost (~$0.10–0.20 per typical 200-turn session with Sonnet).
- **Snapshots contain redacted but verbatim user text.** 16 default secret patterns plus an always-on Luhn-validated card check strip data; `--redact-strict` adds 4 more PII patterns (email/phone/SSN/RRN). Always show a share warning if the snapshot is going somewhere external.
- **MCP path resolution.** When this plugin is installed via `claude plugin marketplace add github:...`, `${CLAUDE_PLUGIN_ROOT}` resolves to the cache path under `~/.claude/plugins/cache/agent-tree/agent-tree/<version>/`. When installed from a directory marketplace (`claude plugin marketplace add "$PWD"`), it resolves to the absolute source path frozen at registration time. A folder rename does not auto-update the directory marketplace registration — re-run `claude plugin marketplace add` after a rename or hand-edit `~/.claude/settings.json`.

### Where to look next

- [`CHANGELOG.md`](./CHANGELOG.md) — what changed and why; every pivot has a paper trail
- [`skills/agent-tree/SKILL.md`](./skills/agent-tree/SKILL.md) — the prompt Claude Code auto-loads when this plugin is installed
- [`src/mcp/server.ts`](./src/mcp/server.ts) — canonical MCP tool definitions (zod schemas live here)
- [`src/cli/options.ts`](./src/cli/options.ts) — canonical CLI flag definitions
- [`RELEASING.md`](./RELEASING.md) — release sequence + post-publish smoke
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — dev loop + check chain + test guarantees

## LLM labeling (optional)

When `ANTHROPIC_API_KEY` is set, each segment can carry an LLM-derived label, summary, and suggested next steps. Prompt caching amortizes the system block across every segment so a typical 200-turn session costs ~$0.10–0.20.

- `--no-llm` for offline / zero-egress.
- `--max-llm-tokens 30000` to cap spend.
- `--model claude-haiku-4-5-20251001` for ~90% cost reduction.

The heuristic phase labels (taken verbatim from user prompts) are usable on their own — the LLM adds polish, not core functionality.

## Privacy

Snapshot markdown contains the redacted session context, including the verbatim last user-turn of the chosen segment. The default redactor strips 16 named secret patterns plus a Luhn-validated credit-card check that runs at every level (surgical enough to skip order numbers / SKUs):

- Anthropic / OpenAI (incl. project keys) / GitHub PAT (classic + fine-grained) / Slack / AWS (access key + temp key) / GCP (API key + OAuth token) / HuggingFace / Stripe / npm API tokens (length-gated, class-boundary-anchored via negative lookahead so trailing `-` / `_` doesn't slip the seam)
- Bearer tokens, JWTs (3-part dot-separated, base64url-aware)
- PEM private key blocks
- Credit card numbers (Luhn-validated; runs even without `--redact-strict`)

`--redact-strict` adds 4 PII patterns: email, phone (E.164 + free-form with required separators — split into two regexes to dodge ReDoS), SSN, and Korean RRN. `--redact-dryrun` prints hit count per pattern to stderr so you can verify what would be stripped without running for real.

Redaction is applied **before truncation** — earlier sessions had a regression where 60-char truncation sliced an API key below the 20-char regex floor. Tests in `tests/security-hardening.test.ts` enforce zero-leak across the pipeline (39 tests including ReDoS fuzz guards and class-boundary anchoring per pattern).

Cache directory (`~/.cache/agent-tree/`) is created with mode `0700`. The pick history at `~/.cache/agent-tree/picks/<sid>.jsonl` is per-session and append-only.

## Configuration

Flags can be set via YAML config or environment variables. Precedence:

```
CLI flags > env vars > ~/.config/agent-tree/config.yaml > <project>/.agent-tree.yaml > defaults
```

Default schema lives in [`src/config/schema.ts`](./src/config/schema.ts).

## Architecture at a glance

```
 JSONL (session)
      │
      ▼
 [1] Reader            streaming parse + DAG via parentUuid;
      │                indirect-cycle guard (iterative DFS)
      │                → RawEvent[] + SessionGraph
      ▼
 [2] Analyzer          6 boundary signals (gap / file-Jaccard / topic-shift /
      │                slash-cmd / sidechain transition / turn-cap)
      │                → TopicSegment[]
      ▼
 [3] Tree builder      group segments into phases (user-prompt headers);
      │                heuristic labels; LLM overlay (optional);
      │                redactor applied here, before truncation
      │                → MindMap with continue/fork ContextSnapshot per node
      ▼
 [4] Renderer          numbered file-tree (text.ts) — wide-char-aware,
      │                consecutive-file grouping, ANSI on TTY, ⭐ for picks,
      │                phase metadata (N actions · M files · T min)
      ▼
 Output: stdout (markdown for snapshot, file-tree for list/tui)
         clipboard (TTY auto-copy via pbcopy / xclip / clip)
         MCP tools  (when running as Claude Code plugin; 3-entry LRU cache
                     keyed on jsonl mtime so in-progress sessions invalidate)
```

Source layout is documented inline in `src/` module headers; [`CHANGELOG.md`](./CHANGELOG.md) explains *why* the current shape exists (every pivot left a paper trail).

## Roadmap

- [x] **v0.1** — agent-tree on Claude Code sessions: file-tree, ⭐ picks, MCP plugin, snapshot resume, audit-hardened (v0.1.0–v0.1.2 shipped)
- [ ] **v0.2** — Codex JSONL adapter (`~/.codex/sessions/` shape) + `SessionSource` interface so the reader stops being Claude-specific
- [ ] **v0.3** — Gemini session adapter (assuming a stable on-disk format emerges)
- [ ] **v1.0** — `--share-safe` mode that strips raw user-text from snapshots for external sharing

The `agent-tree` name is the long-term commitment; multi-agent support is the reason it isn't `claude-tree`.

## Development

```bash
git clone https://github.com/lifrary/agent-tree
cd agent-tree
npm install
npm test            # vitest, 134 tests / 12 files at last green
npm run typecheck   # tsc --noEmit, strict
npm run lint        # eslint
npm run build       # esbuild → dist/cli.js + dist/mcp-server.js
./dist/cli.js --help
```

Two maintainer slash commands ship in `.claude/commands/` (tracked, version-controlled, runnable by anyone with the repo cloned):

- `/pre-publish-audit` — version sync (6 fields), exact tarball file-set vs frozen baseline, dist freshness vs source mtime, MCP manifest sanity, prepublishOnly chain
- `/mcp-smoke` — clean `/tmp` install of the published tarball + spec-compliant MCP `initialize` + `tools/list` + 5-tool assertion

Contributor workflow: [`CONTRIBUTING.md`](./CONTRIBUTING.md). Release procedure: [`RELEASING.md`](./RELEASING.md). Decision history: [`CHANGELOG.md`](./CHANGELOG.md).

## License

[MIT](./LICENSE) © 2026 Seungwoo Lee
