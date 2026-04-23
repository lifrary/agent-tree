# agent-tree

> Navigate any Claude Code session as a numbered file-tree in your terminal — and resume from any node.

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Node ≥20](https://img.shields.io/badge/node-%E2%89%A520-brightgreen.svg)](https://nodejs.org/)
[![npm](https://img.shields.io/badge/npm-%40seungwoolee%2Fagent--tree-cb3837.svg)](https://www.npmjs.com/package/@seungwoolee/agent-tree)

A finished Claude Code session can run thousands of turns across hours of work. Linear `/wrap` summaries flatten that into prose and lose the branches, dead-ends, and good-but-discarded ideas. **`agent-tree`** parses the session JSONL into a `tree`-style hierarchy you read directly in your terminal: each user-prompt is a phase, each segment underneath is a sub-action, and any node you've previously resumed from is marked with ⭐. Pick a number, and the resume markdown lands on your clipboard ready to paste into a fresh `claude` session.

> Built for Claude Code today. Designed to extend to Codex / Gemini sessions tomorrow — hence the agent-neutral name.

## What it does

- **File-tree view of a session** — `phases (user prompts) → sub-actions (file edits / tool calls)`. Read like `tree`. No browser, no HTML.
- **Smart default** — `agent-tree` with no args picks up the most recently modified session in your current project's encoded directory; falls back to globally latest with a notice.
- **⭐ pick history** — every node you've resumed from gets starred (binary, GitHub-style). Persisted across runs at `~/.cache/agent-tree/picks/<sid>.jsonl`.
- **Continue / Fork resume** — pick a node, get the resume markdown on stdout (and on your clipboard when running on a TTY) ready to paste into a new session.
- **Git context auto-append** — snapshots include current branch / HEAD / status / recent commits so the next session knows the working-tree state.
- **MCP plugin** — install once and the five tools (`agent_tree_list / snapshot / picks / diff / unstar`) surface in every Claude Code session natively, no subprocess spawn.
- **Secret redaction** — 10 default patterns (Anthropic/OpenAI/GitHub/AWS/GCP keys, JWTs, Bearer tokens, PEM blocks); `--redact-strict` adds email / phone / card (Luhn-gated) / SSN / RRN.

## What it looks like

```
agent-tree · session fd8b7e83 · 8602 events · 1916 turns · 210 nodes · 2707 min

 1. 🎯 Build agent-tree per SPEC.md v0.3                                        (root)
 2. ├─ "Read SPEC.md — self-contained spec v0.3 …"   (23 actions · 21 files · 19min) T0      events 0–40
 3. ├─ "ralph: M5까지 알아서 잘 해봐 ultrathink"     (24 actions · 19 files · 14min) T+1h 8m  events 1362–1494
 4. ├─ ⭐ "무조건 터미널 안에서 실행되어야해"         (15 actions · 15 files · 12min) T+23h 43m events 5885–5918
 5. ├─ "mindmap인건 중요치않아 … 파일 위치 구조화처럼"  (1 action · 1 file · 3min)    T+24h 44m events 6583–6587
 6. └─ ⭐ "꼼꼼히 실행해. ultrathink"                   (9 actions · 9 files · 4min)  T+43h 17m events 7077–7144

Pick a number to copy that node's resume context.
  N        → continue mode (preserve decisions, change direction)
  N fork   → fork mode (discard subsequent turns)
  N c / N f → shorthand
```

Phase headers are cyan on TTY, ⭐ marks are yellow, `T+1h 8m` / `events 0–40` are dimmed. `--phases-only` collapses sub-actions for fast navigation; default view expands them.

## Install

### As a CLI

```bash
npm install -g @seungwoolee/agent-tree
```

Two bins are exposed: `agent-tree` (primary) and `atree` (alias).

### As a Claude Code plugin (recommended — MCP integration)

The plugin manifest ships an MCP server so the tools surface natively in every Claude Code session. No subprocess spawn, no `--no-llm` flag juggling.

```bash
git clone https://github.com/lifrary/agent-tree ~/.claude/plugins/local/agent-tree
cd ~/.claude/plugins/local/agent-tree
npm install
npm run build
```

Restart Claude Code. The following MCP tools become available:

| MCP tool              | Purpose                                                                     |
| --------------------- | --------------------------------------------------------------------------- |
| `agent_tree_list`     | numbered file-tree of a session (with phase grouping, filter, ⭐)           |
| `agent_tree_snapshot` | resume markdown for one node (continue/fork) + git context, records pick    |
| `agent_tree_picks`    | every recorded pick across every session                                    |
| `agent_tree_diff`     | event range / files / tools between two nodes                               |
| `agent_tree_unstar`   | remove ⭐ from a previously picked node                                     |

The bundled skill (`skills/agent-tree/SKILL.md`) instructs Claude Code to prefer MCP tools and fall back to the CLI when the server isn't connected.

#### Verify the install

After restarting Claude Code, in any session:

```
> Use the agent_tree_list MCP tool with cwd="/path/to/any/project"
```

Claude Code should call the tool and return a numbered file-tree of that project's most-recent session. If you see "Tool agent_tree_list not found":

1. Confirm the plugin lives at `~/.claude/plugins/local/agent-tree/` (not just symlinked from elsewhere — Claude Code's plugin loader doesn't follow symlinks consistently).
2. Confirm `dist/mcp-server.js` exists (run `npm run build` if missing).
3. Restart Claude Code (the plugin loader only scans on startup).
4. Check `~/.claude/logs/` for plugin-load errors.

Smoke-test the server outside Claude Code:

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' \
  | node dist/mcp-server.js | head -200
```

You should see all 5 `agent_tree_*` tools listed.

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
| `--diff <a> <b>`                                                    | —                    | summarise event range / files / tools between two nodes     |
| `--no-llm`                                                          | LLM on if key set    | skip Anthropic call, heuristic labels only                  |
| `--model <name>`                                                    | `claude-sonnet-4-6`  | Anthropic model for LLM labeling                            |
| `--max-llm-tokens <n>`                                              | `50000`              | input token budget ceiling                                  |
| `--redact-strict`                                                   | off                  | add PII patterns (email/phone/card/SSN/RRN)                 |
| `--redact-dryrun`                                                   | off                  | print redaction hit counts to stderr                        |
| `--include-sidechains` / `--flatten-sidechains` / `--drop-sidechains` | include            | subagent (Task-tool) handling                               |
| `--dry-run`                                                         | off                  | run pipeline, emit no output                                |
| `--dump-json <dir>`                                                 | —                    | dump intermediate artifacts (raw / graph / segments / tree) |
| `-v, --verbose` / `--trace`                                         | —                    | log levels                                                  |

Run `agent-tree --help` for the canonical list.

## LLM labeling (optional)

When `ANTHROPIC_API_KEY` is set, each segment can carry an LLM-derived label, summary, and suggested next steps. Prompt caching amortizes the system block across every segment so a typical 200-turn session costs ~$0.10–0.20.

- `--no-llm` for offline / zero-egress.
- `--max-llm-tokens 30000` to cap spend.
- `--model claude-haiku-4-5-20251001` for ~90% cost reduction.

The heuristic phase labels (taken verbatim from user prompts) are usable on their own — the LLM adds polish, not core functionality.

## Privacy

Snapshot markdown contains the redacted session context, including the verbatim last user-turn of the chosen segment. Defaults strip:

- Anthropic / OpenAI / GitHub / AWS / GCP API keys (length-gated regex)
- Bearer tokens, JWTs (3-part dot-separated)
- PEM private key blocks

`--redact-strict` adds email, phone, card (Luhn-validated), SSN, and Korean RRN patterns. `--redact-dryrun` prints the hit count per pattern to stderr so you can verify what would be stripped without running for real.

Redaction is applied **before truncation** — earlier sessions had a regression where 60-char truncation sliced an API key below the 20-char regex floor. Tests in `tests/integration.test.ts` enforce zero-leak across the pipeline.

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
 [1] Reader            streaming parse + DAG via parentUuid
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
         MCP tools  (when running as Claude Code plugin)
```

For the deep version, see [`CLAUDE.md`](./CLAUDE.md).

## Roadmap

- [x] **v0.1** — agent-tree on Claude Code sessions: file-tree, ⭐ picks, MCP plugin, snapshot resume
- [ ] **v0.2** — Codex JSONL adapter (`~/.codex/sessions/` shape)
- [ ] **v0.2** — `SessionSource` interface so the reader stops being Claude-specific
- [ ] **v0.3** — Gemini session adapter (assuming a stable on-disk format emerges)
- [ ] **v1.0** — `--share-safe` mode that strips raw user-text from snapshots for external sharing

The `agent-tree` name is the long-term commitment; multi-agent support is the reason it isn't `claude-tree`.

## Development

```bash
git clone https://github.com/lifrary/agent-tree.git
cd agent-tree
npm install
npm test            # vitest, 92 tests / 11 files
npm run typecheck   # tsc --noEmit, strict
npm run lint        # eslint
npm run build       # esbuild → dist/cli.js + dist/mcp-server.js
./dist/cli.js --help
```

Project conventions live in [`CLAUDE.md`](./CLAUDE.md). Historical design context is in [`SPEC.md`](./SPEC.md) (v0.3, frozen reference).

## License

[MIT](./LICENSE) © 2026 Seungwoo Lee
