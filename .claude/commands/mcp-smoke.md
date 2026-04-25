---
description: Post-publish MCP smoke test — installs the published tarball in /tmp, performs MCP `initialize` + `tools/list` JSON-RPC handshake, asserts all 5 agent_tree_* tools surface. Automates RELEASING.md Step 7.
allowed-tools: Bash, Read
---

You are running the agent-tree post-publish MCP smoke test. The goal: prove that the **published** tarball boots an MCP server that surfaces all 5 `agent_tree_*` tools via a spec-compliant JSON-RPC handshake. This automates `RELEASING.md` Step 7.

Run this **after `npm publish`** has succeeded. It installs from the registry, not from local source.

> **Fixes from Loop 1 + Loop 2 + Loop 3 reviews**:
> - **Spec-compliant MCP handshake** (Loop 1): the previous version sent
>   a bare `tools/list` request without the `initialize` →
>   `notifications/initialized` handshake. SDK 1.29 enforces the
>   handshake — a premature `tools/list` returned an error envelope or
>   nothing, which the old grep would silently miscount.
> - **stderr separated from JSON-RPC stream** (Loop 2): `node ... 2>&1`
>   used to fold the MCP server's stderr (banner, deprecation warnings,
>   debug logs) into `$RESPONSE`. One stray non-JSON line corrupts
>   `jq -rs` parsing and the script falsely reports "no tools surfaced"
>   while the server is actually healthy. We now redirect stderr to a
>   tempfile and dump it on FAIL, leaving the JSON-RPC stream pure.
> - **jq stderr preserved on FAIL** (Loop 2): the old `2>/dev/null` on
>   the parsing pipeline buried jq's actual error message. Removed.
> - **`grep -c .` replaced with `wc -l`** (Loop 2): `grep -c .` returns
>   exit 1 on zero matches, which under `set -o pipefail` inside a
>   `$(...)` aborts the script. `wc -l | tr -d ' '` is unconditional.
> - **portable `smoke_timeout` shim** (Loop 3 verifier dry-run BLOCKER):
>   macOS does not bundle GNU coreutils' `timeout` binary by default —
>   the previous `timeout 30 node ...` aborted at exit 127 (command not
>   found) before the handshake started. The shim below resolves to
>   `timeout` (Linux), `gtimeout` (macOS+brew coreutils), or a
>   perl-alarm fallback (perl ships with macOS system).
> - **trap-based cleanup** (Loop 1): registered once after dir creation
>   so a failure mid-script still purges `/tmp`. The entire script must
>   run in **one** bash invocation for the trap to apply.

## The smoke script

Read `package.json#version` first, then run the entire script below as **one** Bash tool call so `set -euo pipefail` and the EXIT trap propagate correctly:

```bash
set -euo pipefail

# --- Portable timeout resolver (Loop 3 verifier BLOCKER fix) ---
# macOS does not bundle GNU coreutils. Resolve the 30-second wall clock
# from one of: native `timeout`, Homebrew `gtimeout`, or a perl-alarm shim.
# Mirrors GNU coreutils' exit code 124 on timeout.
if command -v timeout >/dev/null 2>&1; then
  smoke_timeout() { timeout "$@"; }
elif command -v gtimeout >/dev/null 2>&1; then
  smoke_timeout() { gtimeout "$@"; }
else
  smoke_timeout() {
    local sec="$1"; shift
    perl -MPOSIX -e '
      my $sec = shift @ARGV;
      my $pid = fork();
      die "fork failed: $!" unless defined $pid;
      if ($pid == 0) { exec { $ARGV[0] } @ARGV; die "exec failed: $!"; }
      local $SIG{ALRM} = sub { kill TERM => $pid; waitpid $pid, 0; exit 124; };
      alarm $sec;
      waitpid $pid, 0;
      exit ($? >> 8);
    ' "$sec" "$@"
  }
fi

VERSION=$(jq -r '.version' /Users/seungwoolee/Code/agent-tree/package.json) \
  || { echo "FAIL: jq parse package.json"; exit 1; }
echo "Testing @seungwoolee/agent-tree@$VERSION (from npm registry)"

SMOKE_DIR=/tmp/agent-tree-smoke-$$
STDERR_FILE=$(mktemp -t agent-tree-mcp-smoke-stderr.XXXXXX)
# Register cleanup BEFORE creating the dir so any failure path still purges
# both the install dir and the stderr capture file.
trap 'cd / && rm -rf "$SMOKE_DIR" && rm -f "$STDERR_FILE"' EXIT

rm -rf "$SMOKE_DIR"
mkdir -p "$SMOKE_DIR"
cd "$SMOKE_DIR"

echo
echo "--- Step 1/5 : npm init + install ---"
npm init -y >/dev/null
if ! npm install "@seungwoolee/agent-tree@$VERSION" 2>&1 | tail -10; then
  echo "FAIL: npm install — registry / network / auth issue"
  exit 1
fi
echo "  OK : @seungwoolee/agent-tree@$VERSION installed in clean tmp dir"

echo
echo "--- Step 2/5 : CLI --version handshake ---"
INSTALLED=$(./node_modules/.bin/agent-tree --version 2>&1 | head -1)
echo "agent-tree --version → $INSTALLED"
if [ "$INSTALLED" != "$VERSION" ]; then
  echo "FAIL: CLI version mismatch (got '$INSTALLED', expected '$VERSION')"
  exit 1
fi
echo "  OK : CLI version matches"

echo
echo "--- Step 3/5 : MCP initialize + tools/list handshake ---"
# Spec-compliant 3-message sequence:
#   1. initialize request (id=1)
#   2. notifications/initialized notification (no id, no response)
#   3. tools/list request (id=2)
# Server emits one JSON-RPC response per request, newline-delimited via stdio.
# `smoke_timeout 30` covers cold-cache npm install warming + first-spawn TS
# source-map loading + handshake; tighten only after measuring on a
# representative machine. stderr is captured separately so banner / debug
# lines do not corrupt jq parse.
RESPONSE=$(printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"agent-tree-smoke","version":"1.0"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
  | smoke_timeout 30 node ./node_modules/@seungwoolee/agent-tree/dist/mcp-server.js 2>"$STDERR_FILE")

if [ -z "$RESPONSE" ]; then
  echo "FAIL: empty response from MCP server (timeout, crash, or stdin closed early)"
  echo "--- captured stderr ---"
  cat "$STDERR_FILE" || true
  exit 1
fi

echo "Raw MCP response (first 800 chars):"
printf '%s\n' "$RESPONSE" | head -c 800
echo
echo
if [ -s "$STDERR_FILE" ]; then
  echo "MCP server stderr (info — not failure):"
  sed 's/^/  /' "$STDERR_FILE"
  echo
fi

echo
echo "--- Step 4/5 : Parse tools/list response (id=2) via jq slurp ---"
# Slurp newline-delimited JSON into an array, select the response whose id==2,
# extract tool names. `?` after .tools[]?.name short-circuits if .result is
# missing or .tools is null (e.g. error envelope). jq's stderr is left visible
# (no 2>/dev/null) so a parse error prints its own message before our
# fallback diagnostic — Loop 2 review.
TOOL_NAMES=$(printf '%s\n' "$RESPONSE" \
  | jq -rs '.[] | select((.id // null) == 2) | .result.tools[]?.name' \
  | sort -u || true)

if [ -z "$TOOL_NAMES" ]; then
  echo "FAIL: no tools surfaced from tools/list response (id=2 missing or .result.tools empty)"
  echo "--- response analysis ---"
  printf '%s\n' "$RESPONSE" \
    | jq -rs '.[] | "id=\(.id // "n/a") method=\(.method // "n/a") error=\(.error // "n/a")"' \
    || echo "  (response not parseable as JSON-Lines — see jq error above)"
  echo "--- captured stderr ---"
  cat "$STDERR_FILE" || true
  exit 1
fi

echo "Tools surfaced:"
printf '%s\n' "$TOOL_NAMES" | sed 's/^/  /'

echo
echo "--- Step 5/5 : Assert exactly the 5 expected tools ---"
# wc -l is unconditional (no exit-1-on-zero like grep -c). Already guarded by
# the [ -z "$TOOL_NAMES" ] branch above, but kept defensive.
COUNT=$(printf '%s\n' "$TOOL_NAMES" | wc -l | tr -d ' ')
if [ "$COUNT" -ne 5 ]; then
  echo "FAIL: expected exactly 5 agent_tree_* tools, got $COUNT"
  exit 1
fi

# Whole-line match (`-Fxq`) per name — robust against partial-match false-pass.
for expected in agent_tree_list agent_tree_snapshot agent_tree_picks agent_tree_diff agent_tree_unstar; do
  if ! printf '%s\n' "$TOOL_NAMES" | grep -Fxq "$expected"; then
    echo "FAIL: missing tool $expected"
    exit 1
  fi
done
echo "  OK : all 5 expected tools present"

echo
echo "============================================="
echo "MCP SMOKE — PASS  (agent-tree v$VERSION)"
echo "  install  : @seungwoolee/agent-tree@$VERSION from npm"
echo "  cli      : --version handshake matches"
echo "  mcp      : initialize + tools/list handshake, 5/5 expected tools"
echo "============================================="
```

The `trap ... EXIT` will purge `$SMOKE_DIR` and `$STDERR_FILE` regardless of exit path.

## What this proves

If you reach the PASS summary, the published tarball is wired correctly: a fresh `npm install` + plain `node` spawn + spec-compliant MCP handshake produces a server that surfaces exactly the 5 `agent_tree_*` tools, and the JSON-RPC response stream is clean of stderr noise. By transitivity, plugin marketplace install (`claude plugin install agent-tree@agent-tree`) will register the same MCP server with the same 5 tools — assuming `RELEASING.md` Step 8's uninstall-first ceremony is followed to refresh the cache.

## What this does NOT prove

- **In-session MCP round-trip from inside Claude Code.** Per the
  RELEASING.md "Plugin MCP spawns from marketplace source, not cache"
  hazard, the in-session `mcp__plugin_agent-tree_*` tools may resolve
  `${CLAUDE_PLUGIN_ROOT}` to the marketplace source dir — not the cache
  this smoke just verified. Restart Claude Code with the cache refreshed,
  then call `mcp__plugin_agent-tree_agent-tree__agent_tree_list` to close
  that loop manually.
- **Plugin manifest collision-safety in environments where the user has
  a project-scope `.mcp.json` at repo root.** This smoke is agnostic to
  that — see the `.gitignore` rationale in the repo for why we never
  ship a root-level `.mcp.json`.
