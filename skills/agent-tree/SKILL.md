---
name: agent-tree
description: Use when the user asks to "map a session", "show me the tree", "agent-tree", "/agent-tree", "resume from a node", "fork from this session", find recent sessions, or inspect a portable Claude Code JSONL export. Renders the session as a numbered file-tree and emits a continue/fork resume block on selection. Six MCP tools (agent_tree_sessions / agent_tree_list / agent_tree_snapshot / agent_tree_picks / agent_tree_diff / agent_tree_unstar) and a CLI fallback.
version: 0.2.0
---

# agent-tree skill

In-session mindmap for a previous Claude Code session. The skill renders a
numbered text tree directly in chat, the user picks a number, and you paste
the resume context so they can drop it into a fresh `claude` session.

This is a terminal-only tool — everything happens inside the current Claude
Code conversation (no browser, no HTML). Structured JSON export is also
available. Requires Node.js ≥22.13.0. This skill describes upcoming 0.2.0;
the npm registry may still serve an earlier release. Only Claude Code JSONL
is supported, not Codex or Gemini native session formats.

## When to invoke

Use this skill when the user says any of:

- "agent-tree", "/agent-tree", "atree"
- "show the mindmap", "map this session", "what did session X look like"
- "resume from <node>", "I want to fork from <some point>"
- "I want to go back to where we did X" (when X refers to an earlier session)
- "find recent sessions", "inspect this export", "export the tree as JSON"

Do **not** use this skill for:

- Summarizing a session as flat prose (agent-tree maps structure, not summaries)
- Creating a new session from scratch (this is for resuming existing ones)
- Treating the _current_ session as a complete record (it is still being
  written, so node numbers and snapshots may change)

## How it works

Two interfaces available — prefer MCP tools when this plugin's MCP server is
registered (no per-call CLI subprocess), fall back to the CLI otherwise.

### MCP tools (preferred)

When the `agent-tree` MCP server is connected (via plugin install):

- `agent_tree_sessions({ cwd?, limit? })` → redacted recent-session catalog; default limit 20, integer 1–1000
- `agent_tree_list({ cwd, sessionId?, file?, phasesOnly?, filter?, format? })` → numbered text tree by default, or complete redacted mindmap with `format: "json"`
- `agent_tree_snapshot({ cwd, nodeId, mode?, sessionId?, file? })` → resume markdown and records the pick; mode defaults to `continue`
- `agent_tree_picks({})` → lists every recorded pick across every session
- `agent_tree_diff({ cwd, from, to, sessionId?, file? })` → summarises what happened between two nodes
- `agent_tree_unstar({ cwd, nodeId, sessionId?, file? })` → removes the ⭐ from a node

Per-session tools require the caller's `cwd` for project discovery and
configuration. Choose `sessionId` or `file`, never both; use an absolute path
for portable exports. Omit both for the project's latest session, with a
global fallback if none exists. `agent_tree_sessions` searches all projects
when `cwd` is omitted; `agent_tree_picks` takes `{}` only.

JSON list output rejects nonempty `filter` and `phasesOnly: true`. Catalog
responses contain `structuredContent: { sessions: [...] }`; JSON list
responses contain `structuredContent: { mindmap: {...} }`, plus serialized
JSON text. Each catalog entry has `sessionId`, `projectDir`, `jsonlPath`,
`mtimeMs`, and `sizeBytes`. Treat JSON as data, not numbered display rows.
MCP always uses heuristic labels and makes no LLM calls.

### CLI fallback

If the MCP server isn't available, fall through to spawning the CLI:

```bash
agent-tree [<session-id>] --no-llm --list
agent-tree [<session-id>] --no-llm --snapshot <N> --mode continue|fork
agent-tree --picks
agent-tree [<session-id>] --no-llm --diff <a> <b>
agent-tree [<session-id>] --no-llm --unstar <N>
agent-tree --sessions --limit 20 --json
agent-tree --cwd /path/to/project --sessions
agent-tree --file /path/to/export.jsonl --no-llm --list
agent-tree --file /path/to/export.jsonl --no-llm --strict --json
```

The CLI is `agent-tree` (alias `atree`), installed globally via npm. If the
binary is missing, prompt the user to run `npm i -g @seungwoolee/agent-tree` first.

`--cwd` selects project discovery and `.agent-tree.yaml` without changing the
shell directory. `--json` emits only structured JSON on stdout; diagnostics
go to stderr. It exports the complete mindmap (or `{ "sessions": [...] }`),
so do not combine it with `--filter`, `--phases-only`, or `--no-group`.
Selectors and output modes are mutually exclusive; invalid combinations
exit with code 2. `--strict` rejects malformed JSONL instead of recovering;
it is an analysis flag, not a catalog option.

### Step 1 — pick a session

Default to the caller's project, not the globally latest session. Discover
candidates with `agent_tree_sessions({ cwd })` or `--cwd <project>
--sessions` when the intended session is unclear. If the user named a
UUID/prefix, pass it explicitly; prefer at least 8 characters. Use `file` /
`--file` for an export and keep that same selector for snapshot/diff/unstar.

```bash
agent-tree --cwd /path/to/project --no-llm --list
# Explicit session:
agent-tree <session-id-or-prefix> --no-llm --list
# Globally latest, only when that is intended:
agent-tree --latest --no-llm --list
```

`--no-llm` keeps analysis offline (heuristic labels). Omit it only when the
user has `ANTHROPIC_API_KEY`, LLM labeling is enabled in config, and they
request LLM-curated labels after understanding the cost. There is no
`--llm` flag. The input-token budget uses exact `messages.countTokens`
preflight counts and reserves before paid calls; a failed count makes no
paid labeling call for that segment. Reservations are not refunded after
failure, and output charges are separate: this is not a monetary cap.

Discovery uses `<CLAUDE_CONFIG_DIR or ~/.claude>/projects/`, only regular
UUID-named `.jsonl` files, and excludes agent/subagent and symlink entries.
Project encoding replaces every non-ASCII-alphanumeric character with `-`.
An imported export without a valid session UUID gets a stable path-derived
32-hex local history identity; continue selecting it with `--file`, not that
identity as a UUID prefix.

`--list` is the skill-friendly mode: it prints a numbered ASCII tree to
stdout. **Show this output verbatim to the user** in a fenced code block:

With `--phases-only` or text filtering, hidden rows do not renumber visible
nodes. Keep the displayed numbers; gaps are intentional.

````markdown
```
agent-tree — session 69c2f35e · 777 events · 230 turns · 26 nodes · 3720 min

 1. 🎯 (root label = first user message, truncated)
 2. ├─ 🧩 seg_001 · oss-ideation.md · Write   events 0–48
 3. ├─ 🧩 seg_002 · SPEC.md · Edit            events 49–98
 ...
26. └─ 🧩 seg_025 · README.md · Edit          events 720–776
```
````

Then ask the user:

> Pick a number to copy that node's resume context.
> • Just the number → continue mode (preserve decisions, change direction)
> • "N fork" → fork mode (discard subsequent turns)

### Step 2 — fetch the snapshot

Once the user replies (e.g. `7`, `12 fork`, `n_005`), parse it:

- A bare integer or `n_NNN` → node id, mode=continue
- `<id> fork` → mode=fork
- `<id> continue` → mode=continue (explicit)

Run:

```bash
agent-tree <session-id> --no-llm --snapshot <id-or-number> --mode <continue|fork>
# For an export, keep the same file selector:
agent-tree --file /path/to/export.jsonl --no-llm --snapshot <id-or-number> --mode continue
```

The CLI prints the resume markdown to stdout. **Show it to the user inside a
fenced code block** so the user can select-and-copy without you adding
any commentary inside the fence:

````markdown
```markdown
# Continuing from: seg_007

...
```
````

After the fence, tell the user:

- The snapshot is now visible above.
- They should open a new `claude` session and paste it as the first message.
- The new session will resume from that point with the chosen mode.

### Step 3 — handle errors

- **No session matched** → use `agent_tree_sessions({ cwd })` or
  `agent-tree --cwd <project> --sessions`; accept an explicit export when
  the machine has no discovered sessions.
- **Ambiguous prefix** → CLI lists matches; ask the user to pick the right
  full UUID.
- **`agent-tree: command not found`** → tell the user to run
  `npm i -g @seungwoolee/agent-tree`. (Avoid suggesting bare `npx` —
  the package ships two bins so npx auto-resolution is unreliable; see
  the README's "For AI agents" section.)

## Privacy

The snapshot you show in chat contains the (redacted) session context. By
default, 16 secret patterns plus Luhn-validated credit cards are stripped
(Anthropic / OpenAI / GitHub / Slack / AWS / GCP / HuggingFace / Stripe / npm
tokens, JWTs, Bearer tokens, PEM private keys, card numbers). To additionally
strip PII (emails / phones / SSN / Korean RRN), append `--redact-strict`:

```bash
agent-tree <session> --no-llm --redact-strict --snapshot <id> --mode continue
```

Always show the user the share warning if the snapshot is going to be
copy-pasted somewhere external. JSON and catalog output also redact strings,
but pattern matching cannot guarantee removal of every sensitive detail.

Config precedence is defaults < user YAML < project YAML < environment <
explicit CLI flags. Invalid fields warn without discarding valid siblings.
Redaction is always enabled, the only LLM provider is `anthropic`, and
telemetry accepts only `false`. LLM config honors model, input/output limits,
parallelism, prompt caching, and `render.lang` (`auto|ko|en`); these do not
turn on LLM use in MCP. MCP's analysis cache is invalidated by caller
configuration and source path/mtime/ctime/size, and respects `cache.enabled`.

## What you should NOT do

- Don't paraphrase the snapshot before showing it. The exact markdown is what
  the user pastes; even reformatting line breaks can break tool-use blocks.
- The CLI has no browser mode. All output is terminal text by design.
- Don't omit `--no-llm` for paid labeling without warning the user about
  cost and waiting for confirmation.
- Don't invoke `agent-tree` against the _current_ session UUID — its JSONL is
  still being written, so the parse will be incomplete or fail.
