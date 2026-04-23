---
name: agent-tree
description: Use when the user asks to "map a session", "show me the tree", "agent-tree", "/agent-tree", "resume from a node", "fork from this session", or wants to navigate / restart from a specific point in a previous Claude Code session. Renders the session as a numbered file-tree in chat and emits a continue/fork resume block on selection. Available as both an MCP tool (agent_tree_list / agent_tree_snapshot / agent_tree_picks / agent_tree_diff / agent_tree_unstar) and a CLI fallback.
version: 0.1.0
---

# agent-tree skill

In-session mindmap for a previous Claude Code session. The skill renders a
numbered text tree directly in chat, the user picks a number, and you paste
the resume context so they can drop it into a fresh `claude` session.

This is a terminal-only tool — everything happens inside the current Claude
Code conversation (no browser, no HTML), like `/wrap` or `/ooo`.

## When to invoke

Use this skill when the user says any of:
- "agent-tree", "/agent-tree", "atree"
- "show the mindmap", "map this session", "what did session X look like"
- "resume from <node>", "I want to fork from <some point>"
- "I want to go back to where we did X" (when X refers to an earlier session)

Do **not** use this skill for:
- Generating a `/wrap` summary (use `/wrap` instead — different tool)
- Creating a new session from scratch (this is for resuming existing ones)
- Visualizing the *current* session (agent-tree needs a completed `.jsonl`;
  the current session is still being written)

## How it works

Two interfaces available — prefer MCP tools when this plugin's MCP server is
registered (faster, no subprocess), fall back to the CLI otherwise.

### MCP tools (preferred)

When the `agent-tree` MCP server is connected (via plugin install):
- `agent_tree_list({ cwd, sessionId?, phasesOnly?, filter? })` → returns the numbered tree as text
- `agent_tree_snapshot({ cwd, nodeId, mode, sessionId? })` → returns the resume markdown for one node and records the pick
- `agent_tree_picks({})` → lists every recorded pick across every session
- `agent_tree_diff({ cwd, from, to, sessionId? })` → summarises what happened between two nodes
- `agent_tree_unstar({ cwd, nodeId, sessionId? })` → removes the ⭐ from a node

Always pass the caller's `cwd` (use the `cwd` value from the system context)
so the smart-default session-pickup hits the right project. `sessionId` is
optional; omit to use the current project's most recently modified session.

### CLI fallback

If the MCP server isn't available, fall through to spawning the CLI:
```bash
agent-tree [<session-id>] --no-llm --list
agent-tree [<session-id>] --no-llm --snapshot <N> --mode continue|fork
agent-tree --picks
agent-tree [<session-id>] --no-llm --diff <a> <b>
agent-tree [<session-id>] --no-llm --unstar <N>
```

The CLI is `agent-tree` (alias `atree`), installed globally via npm. If the
binary is missing, prompt the user to run `npm i -g @seungwoolee/agent-tree` first.

### Step 1 — pick a session

Default to the most recently modified session via `--latest`. If the user
named a specific session (UUID prefix like `69c2f35e`), pass it as the first
positional arg.

```bash
agent-tree --latest --no-llm --list
# or
agent-tree <session-id-or-prefix> --no-llm --list
```

`--no-llm` keeps it instant and offline (heuristic labels). Drop `--no-llm`
when the user has `ANTHROPIC_API_KEY` set and wants LLM-curated labels — but
warn that it'll cost ~$0.10–0.20 for a typical session.

`--list` is the skill-friendly mode: it prints a numbered ASCII tree to
stdout. **Show this output verbatim to the user** in a fenced code block:

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
>   • Just the number → continue mode (preserve decisions, change direction)
>   • "N fork" → fork mode (discard subsequent turns)

### Step 2 — fetch the snapshot

Once the user replies (e.g. `7`, `12 fork`, `n_005`), parse it:
- A bare integer or `n_NNN` → node id, mode=continue
- `<id> fork` → mode=fork
- `<id> continue` → mode=continue (explicit)

Run:

```bash
agent-tree <session-id> --no-llm --snapshot <id-or-number> --mode <continue|fork>
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

- **No session matched** → list recent sessions via `agent-tree --pick` or ask
  for a longer UUID prefix.
- **Ambiguous prefix** → CLI lists matches; ask the user to pick the right
  full UUID.
- **`agent-tree: command not found`** → tell the user to run
  `npm i -g @seungwoolee/agent-tree` (or `npx oh-my-agent-tree …` for one-shot).

## Privacy

The snapshot you show in chat contains the (redacted) session context. By
default, secrets matching the standard regex set (Anthropic / OpenAI / GitHub
/ AWS / GCP keys, JWTs, Bearer tokens, PEM private keys) are stripped. To
also strip emails / phones / cards / SSNs, append `--redact-strict`:

```bash
agent-tree <session> --no-llm --redact-strict --snapshot <id> --mode continue
```

Always show the user the share warning if the snapshot is going to be
copy-pasted somewhere external.

## What you should NOT do

- Don't paraphrase the snapshot before showing it. The exact markdown is what
  the user pastes; even reformatting line breaks can break tool-use blocks.
- The CLI has no browser mode. All output is terminal text by design.
- Don't run the LLM-labeling path (`--llm`) without warning the user about
  cost and waiting for confirmation.
- Don't invoke `agent-tree` against the *current* session UUID — its JSONL is
  still being written, so the parse will be incomplete or fail.
