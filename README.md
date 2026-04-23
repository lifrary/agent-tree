# oh-my-claude-map

> Visualize a Claude Code session as an interactive mindmap — and restart from inside it.

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Node ≥20](https://img.shields.io/badge/node-%E2%89%A520-brightgreen.svg)](https://nodejs.org/)

Claude Code sessions can balloon to hundreds of turns. Linear `/wrap` summaries hide the branches, dead-ends, and subagent spawns. `oh-my-claude-map` turns a completed `.jsonl` session into an interactive browser mindmap where every node is a resumable context snapshot.

## What it does

- **Post-session snapshot** — one CLI command → fully self-contained HTML (no CDN, works offline).
- **Branch resume** — click any node, get a *continue* or *fork* markdown block on your clipboard, paste into a new `claude` session.
- **Dead-end pruning** — see where you got stuck; retry those threads in isolation.
- **Sidechain visibility** — subagent branches rendered as their own tree.
- **Secret redaction** — API keys, tokens, JWTs, private keys never reach the HTML or the LLM.

## Install

```bash
npm install -g oh-my-claude-map
```

This exposes two CLI bins:

- `claude-map` — primary
- `omcm` — short alias

## Quickstart

```bash
# Interactive numbered ASCII mindmap in your terminal — pick a node, snapshot copies to clipboard
claude-map --latest

# Print numbered list to stdout (skill / pipe friendly)
claude-map --latest --list

# Resume from a specific node by number — prints the markdown to stdout
claude-map 69c2f35e --snapshot 7 --mode continue
claude-map 69c2f35e --snapshot 12 --mode fork | pbcopy   # macOS (TTY: auto-copies)

# Filter long sessions
claude-map 69c2f35e --list --filter "auth"

# Heuristic-only (no LLM call, offline-safe)
claude-map 69c2f35e --no-llm
```

Everything stays **inside your terminal** — no browser, no HTML. Default behavior:
- TTY stdout → interactive `--tui` (numbered selection + auto-clipboard)
- non-TTY (piped / redirected) → `--list` (machine-readable for skill use)

Snapshots print to stdout; in TTY they also push to your system clipboard automatically (`pbcopy` on macOS, `xclip` on Linux, `clip` on Windows). Paste into a fresh `claude` session to resume from that node.

### Use as a Claude Code skill

Drop `skills/claude-map/SKILL.md` into `~/.claude/skills/claude-map/` and a Claude Code conversation can say "show me the tree" — the skill runs `claude-map --list`, presents the numbered tree, and routes your number choice to `claude-map --snapshot <N>`. The chosen markdown lands directly in chat.

### Use as a Claude Code plugin (MCP tools, recommended)

For real in-session integration — no subprocess spawn, just native MCP tool
calls — install as a plugin so the bundled MCP server registers with Claude
Code:

```bash
# clone or symlink into Claude Code's plugin search path
git clone https://github.com/lifrary/oh-my-claude-map ~/.claude/plugins/local/oh-my-claude-map
cd ~/.claude/plugins/local/oh-my-claude-map
npm install
npm run build
```

The plugin manifest (`.claude-plugin/plugin.json` + `.claude-plugin/.mcp.json`)
registers `dist/mcp-server.js` as an MCP server named `claude-map`. Once
Claude Code restarts, the following tools become available in any session:

| MCP tool | Purpose |
|---------|---------|
| `claude_map_list` | numbered ASCII tree of a session (with phase grouping, filter, ⭐) |
| `claude_map_snapshot` | resume markdown for one node (continue/fork) + git context, auto-records pick |
| `claude_map_picks` | every recorded pick across every session |
| `claude_map_diff` | event range / files / tools between two nodes |
| `claude_map_unstar` | remove ⭐ from a previously picked node |

The `skills/claude-map/SKILL.md` is also part of the plugin and prefers MCP
tools when available, falling back to the CLI otherwise.

## Why two branch modes?

| Mode | When to use |
|------|-------------|
| **Continue** | Decisions up to this point were good — I just want to keep going from here, skipping whatever the session did next. |
| **Fork** | I want to re-try this moment with the subsequent turns erased, exploring a different direction entirely. |

## Requirements

- **Node.js** ≥ 20 (native `fetch`, streams)
- **macOS** primary target; Linux / Windows supported via `xdg-open` / `start`
- Claude Code session JSONLs under `~/.claude/projects/<encoded-path>/`

## LLM labeling (optional)

If `ANTHROPIC_API_KEY` is set, each topic segment gets an LLM-derived label, summary, and suggested next steps. Prompt caching amortizes the system block across every segment so a typical 200-turn session costs **~$0.10–0.20**.

- Disable with `--no-llm` to stay offline (heuristic labels only).
- Cap spend with `--max-llm-tokens 30000`.
- Downgrade with `--model claude-haiku-4-5-20251001` for ~90% cost reduction.

Estimated cost table is in [SPEC Appendix E](./SPEC.md#appendix-e-llm-cost-calculation).

## Privacy

`window.OMCM` inside the generated HTML contains the **full redacted session context**. This is required for client-side clipboard resume, but:

- ⚠️ **Do not share the HTML externally** without review.
- ⚠️ `--redact-strict` adds email / phone / card / SSN / RRN patterns.
- ⚠️ `--redact-dryrun` prints redaction hit counts so you can verify before committing.
- ⚠️ `--no-llm` is the only path that guarantees zero network egress.

Cache directory (`~/.cache/claude-map/`) is created with mode `0700`.

## Configuration

All flags can be set via YAML config or environment variables. Precedence:
**CLI flags > env vars > `~/.config/claude-map/config.yaml` > `<project>/.claude-map.yaml` > defaults**.

See the default schema in [`src/config/schema.ts`](./src/config/schema.ts) and the SPEC Appendix F example.

## CLI flag catalog (selected)

| Flag | Default | Notes |
|------|---------|-------|
| `--latest` | — | use most recently modified session |
| `--pick` | — | interactive chooser |
| `--list` | — | print numbered ASCII tree to stdout |
| `--snapshot <id>` | — | print one node's resume markdown to stdout |
| `--mode <continue\|fork>` | continue | snapshot mode |
| `--tui` | (auto on TTY) | interactive readline picker |
| `--filter <kw>` | — | show only rows matching keyword |
| `--no-group` | off | disable consecutive same-file collapsing |
| `--no-color` | off | force-disable ANSI color even on TTY |
| `--phases-only` | off | show only phase headers, hide sub-actions |
| `--picks` | — | list every pick across every session |
| `--unstar <id>` | — | remove ⭐ from a previously picked node |
| `--diff <a> <b>` | — | summarise what happened between two nodes |
| `--no-llm` | off | heuristic labels only |
| `--model <name>` | `claude-sonnet-4-6` | Anthropic model |
| `--max-llm-tokens <n>` | 50000 | input budget ceiling |
| `--redact-strict` | off | add PII patterns |
| `--redact-dryrun` | off | print redaction hits to stderr |
| `--include-sidechains` / `--flatten-sidechains` / `--drop-sidechains` | include | subagent handling |
| `--dry-run` | off | analyze only, no output |
| `--dump-json <dir>` | — | dump intermediate artifacts |
| `-v, --verbose` / `--trace` | — | log levels |

Run `claude-map --help` for the full list.

## Architecture at a glance

```
 JSONL (session)
      │
      ▼
 [1] Reader          streaming JSON parse + graph reconstruction
      │              → RawEvent[] + SessionGraph
      ▼
 [2] Analyzer        6 boundary signals (gap, file-shift, phrase, slash-cmd,
      │              sidechain-transition, turn-cap) → TopicSegment[]
      ▼
 [3] Tree builder    heuristic labels; LLM overlay (optional)
      │              → MindMap with continue/fork ContextSnapshot per node
      ▼
 [4] Renderer        numbered ASCII tree (text.ts) — wide-char-aware,
      │              consecutive-file grouping, optional ANSI color
      ▼
 Output: stdout (markdown for snapshot, tree for list/tui)
         clipboard (TTY auto-copy via pbcopy/xclip/clip)
```

## Development

```bash
git clone https://github.com/lifrary/oh-my-claude-map.git
cd oh-my-claude-map
npm install
npm test            # vitest, ~80 tests
npm run typecheck   # strict tsc
npm run build       # esbuild → dist/cli.js + dist/template.html
./dist/cli.js --help
```

## Status

Milestones from the [design spec](./SPEC.md) §12:

- [x] **M1** — ingest + graph + heuristic segments
- [x] **M2** — markmap render + browser open + click → clipboard
- [x] **M3** — Anthropic LLM labeling + prompt caching + snapshot narratives
- [x] **M4** — secret redaction + content-hash cache
- [x] **M5** — config loader + CLI flag catalog + bilingual docs — *you are here*

## License

[MIT](./LICENSE) © 2026 Seungwoo Lee
