---
description: Pre-publish audit for agent-tree — version sync (6 fields), exact tarball file-set, dist freshness, MCP manifest sanity, prepublishOnly smoke. Run before `npm publish`.
allowed-tools: Bash, Read
---

You are running the agent-tree pre-publish audit. **Halt and report on the FIRST failure** — do not silently continue. Produce a final PASS/FAIL summary at the end.

All paths below are relative to repo root (cwd is already the repo). Each code block starts with `set -euo pipefail` so a failed intermediate does not silently propagate to a green PASS.

## Check 1 — Version sync (6 fields)

`package.json#version` is canonical. These five files / six fields must all match it:

- `.claude-plugin/plugin.json#version`
- `.claude-plugin/marketplace.json#metadata.version`
- `.claude-plugin/marketplace.json#plugins[0].version`
- `src/mcp/server.ts` — the `version: '...'` arg in the `McpServer({...})` constructor
- `skills/agent-tree/SKILL.md` — frontmatter `version: ...`

```bash
set -euo pipefail

PKG=$(jq -r '.version' package.json) \
  || { echo "FAIL: jq parse package.json"; exit 1; }
echo "package.json#version = $PKG (canonical)"

declare -a FAILS=()
check() {
  local label="$1" actual="$2"
  if [ "$actual" = "$PKG" ]; then
    echo "  OK : $label = $actual"
  else
    echo "  FAIL: $label = '$actual' (expected '$PKG')"
    FAILS+=("$label")
  fi
}

# Capture each version field BEFORE calling check() — under `set -e`, a naked
# `check "label" "$(jq ...)"` substitution would silently abort the script
# on jq failure, leaving FAILS empty and exit code propagation broken
# (Loop 2 review).
PLUGIN_VER=$(jq -r '.version' .claude-plugin/plugin.json) \
  || { echo "FAIL: jq parse plugin.json"; exit 1; }
MARKETPLACE_META=$(jq -r '.metadata.version' .claude-plugin/marketplace.json) \
  || { echo "FAIL: jq parse marketplace.json (metadata)"; exit 1; }
MARKETPLACE_PLUGIN=$(jq -r '.plugins[0].version' .claude-plugin/marketplace.json) \
  || { echo "FAIL: jq parse marketplace.json (plugins[0])"; exit 1; }

# src/mcp/server.ts: scope to lines that look like a McpServer constructor
# version field — anchored, semver-only, must end with `',` so a comment or
# test fixture can't false-match. Single-shot awk avoids the
# `grep | head -1 | sed` pipeline that, under `set -o pipefail`, can abort
# Check 1 silently when grep gets SIGPIPE from head's early close
# (Loop 2 review). `\047` is the octal escape for a single quote inside
# the awk regex.
MCP_SERVER_VER=$(awk -F"'" '
  /^[[:space:]]+version: \047[0-9]+\.[0-9]+\.[0-9]+\047,/ { print $2; exit }
' src/mcp/server.ts)

SKILL_VER=$(awk '/^version:/ { print $2; exit }' skills/agent-tree/SKILL.md)

check ".claude-plugin/plugin.json#version"                "$PLUGIN_VER"
check ".claude-plugin/marketplace.json#metadata.version"  "$MARKETPLACE_META"
check ".claude-plugin/marketplace.json#plugins[0].version" "$MARKETPLACE_PLUGIN"
check "src/mcp/server.ts#McpServer.version"               "$MCP_SERVER_VER"
check "skills/agent-tree/SKILL.md#frontmatter.version"    "$SKILL_VER"

[ ${#FAILS[@]} -eq 0 ] || { echo "Halt — version drift in: ${FAILS[*]}"; exit 1; }
```

## Check 2 — Exact tarball file set (not just count)

Hard-coded count is too coarse — every legit addition flips it to FAIL post-hoc, every silent removal can pass at exactly the same count. Instead, assert the exact file set against a baseline frozen at v0.1.2 release. Update the baseline below intentionally when you genuinely ship a new file.

```bash
set -euo pipefail

EXPECTED=$(cat <<'EOF'
.claude-plugin/marketplace.json
.claude-plugin/plugin.json
CHANGELOG.md
LICENSE
README.md
dist/cli.js
dist/cli.js.map
dist/mcp-server.js
dist/mcp-server.js.map
package.json
skills/agent-tree/SKILL.md
EOF
)
EXPECTED_SORTED=$(printf '%s\n' "$EXPECTED" | sort)

ACTUAL=$(npm pack --dry-run --json 2>/dev/null | jq -r '.[0].files[].path' | sort) \
  || { echo "FAIL: npm pack --dry-run / jq parse"; exit 1; }

if [ "$ACTUAL" != "$EXPECTED_SORTED" ]; then
  echo "FAIL: tarball file-set drift"
  echo "--- expected (baseline v0.1.2) ---"
  printf '%s\n' "$EXPECTED_SORTED" | sed 's/^/  /'
  echo "--- actual (npm pack --dry-run) ---"
  printf '%s\n' "$ACTUAL" | sed 's/^/  /'
  echo "--- diff ---"
  diff <(printf '%s\n' "$EXPECTED_SORTED") <(printf '%s\n' "$ACTUAL") || true
  echo "If a file is *intentionally* added/removed, update the EXPECTED"
  echo "heredoc in this command, then re-run."
  exit 1
fi

echo "  OK : tarball file-set matches baseline ($(printf '%s\n' "$ACTUAL" | wc -l | tr -d ' ') files)"
```

## Check 3 — dist build freshness

`dist/cli.js` and `dist/mcp-server.js` must be newer than the most-recently-modified `.ts` file in `src/`. Stale dist = published tarball does not reflect source.

```bash
set -euo pipefail

# stat -f '%m %N' is BSD/macOS; for Linux CI use stat -c '%Y %n'.
NEWEST_SRC=$(find src -name '*.ts' -type f -exec stat -f '%m %N' {} \; | sort -rn | head -1)
SRC_MTIME=$(echo "$NEWEST_SRC" | awk '{print $1}')
SRC_FILE=$(echo "$NEWEST_SRC" | awk '{$1=""; sub(/^ /, ""); print}')
[ -n "$SRC_MTIME" ] || { echo "FAIL: no src/*.ts files found — repo state suspect"; exit 1; }

DIST_CLI=$(stat -f '%m' dist/cli.js 2>/dev/null || echo 0)
DIST_MCP=$(stat -f '%m' dist/mcp-server.js 2>/dev/null || echo 0)
echo "newest src         : $SRC_FILE @ $SRC_MTIME"
echo "dist/cli.js        @ $DIST_CLI"
echo "dist/mcp-server.js @ $DIST_MCP"
if [ "$DIST_CLI" -lt "$SRC_MTIME" ] || [ "$DIST_MCP" -lt "$SRC_MTIME" ]; then
  echo "FAIL: dist is stale relative to src. Run: npm run build"
  exit 1
fi
echo "  OK : dist is fresh"
```

## Check 4 — MCP manifest sanity

The v0.1.0 bug was `"mcpServers": "./.mcp.json"` (string ref → plugin-root-relative resolution failed → MCP never registered). Must be an inline object, and the `args[]` paths must resolve.

> **Fix from Loop 1 review**: previous version looped over `args[]` inside
> a `jq | while read` pipeline subshell, so `exit 1` on a missing path
> could not propagate to the parent — silent false-pass. The version
> below captures jq output into a parent-shell variable first
> (preserving jq-error propagation under `set -e`), then splits into
> an array via a portable while-read.
>
> **Portability fix (2026-04-26 macOS dogfood)**: previous version used
> `mapfile -t`, a bash 4+ builtin. Claude Code's Bash tool routes
> scripts through `/bin/zsh` on macOS by default — zsh has no
> `mapfile`, so the call aborted with `(eval):N: command not found:
> mapfile`. Capture-then-`while IFS= read -r ... <<<` is bash 3.2+ /
> zsh 5+ compatible and preserves the same parent-shell array semantics.

```bash
set -euo pipefail

jq -e '.mcpServers | type == "object"' .claude-plugin/plugin.json >/dev/null \
  || { echo "FAIL: plugin.json#mcpServers must be an inline object, not a string ref"; exit 1; }
echo "  OK : plugin.json#mcpServers is an object"

# Two-phase split: capture jq output first so a parse failure surfaces
# under `set -e` (process substitution + while-read would mask jq's
# exit code — the FIFO would just close empty), then split into
# MCP_ARGS via a portable while-read. `mapfile -t` would be one line
# shorter but is bash-only — `/bin/zsh` (the macOS Bash tool default)
# has no equivalent.
MCP_ARGS_RAW=$(jq -r '.mcpServers | to_entries[] | .value.args[]?' .claude-plugin/plugin.json) \
  || { echo "FAIL: jq parse plugin.json mcpServers"; exit 1; }

MCP_ARGS=()
if [ -n "$MCP_ARGS_RAW" ]; then
  while IFS= read -r line; do
    MCP_ARGS+=("$line")
  done <<< "$MCP_ARGS_RAW"
fi
[ ${#MCP_ARGS[@]} -gt 0 ] || { echo "FAIL: no args[] under .mcpServers"; exit 1; }

for p in "${MCP_ARGS[@]}"; do
  resolved="${p//\$\{CLAUDE_PLUGIN_ROOT\}/.}"
  if [ ! -f "$resolved" ]; then
    echo "FAIL: MCP arg path missing: $p (resolved as $resolved)"
    exit 1
  fi
  echo "  OK : MCP arg resolves: $p → $resolved"
done
```

## Check 5 — prepublishOnly smoke

This is what `npm publish` runs anyway. Doing it manually first means you see test output without the publish progress bar fighting for the terminal.

```bash
set -euo pipefail
npm run lint && npm run typecheck && npm test && npm run build \
  || { echo "FAIL: prepublishOnly chain"; exit 1; }
```

Expected: lint clean, tsc clean, vitest 134 tests passing, esbuild produces fresh `dist/cli.js` + `dist/mcp-server.js`.

## Output

If all 5 checks pass, print:

```
=========================================================
PRE-PUBLISH AUDIT — PASS  (agent-tree v$PKG)
  version  : 6 fields synced
  tarball  : exact file-set matches baseline (11)
  dist     : fresh
  mcp      : inline object, paths resolve
  smoke    : lint + typecheck + 134 tests + build
=========================================================
Ready to npm publish.
```

If any check fails, print the failing check name and HALT. Do not proceed to remaining checks — fix the failure, then re-run the audit.
