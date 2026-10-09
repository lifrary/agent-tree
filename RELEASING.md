# Releasing agent-tree

This is the v0.X.Y → v0.X.Y+1 (or v0.X+1.0) checklist. Captures the sequence
that shipped v0.1.0 so the next release doesn't re-discover it.

The next release is **0.3.0 (unreleased)**. Updating the repository does not
publish to npm; registry and GitHub release steps below are a separate
maintainer action after release approval.

The OMC `release` skill (`/oh-my-claudecode:release`) handles the generic
ordering — this doc is the agent-tree-specific overlay (project-aware steps,
post-publish smoke test, MCP plugin re-install).

## Prerequisites

- **Node.js ≥22.13.0**; CI must cover Node 22/24/26 on Linux and macOS.
- ESLint 10 flat config, Vitest 5, and the TypeScript 7.0.2 native compiler.
  TypeScript 6.0.3 remains installed for typescript-eslint's JavaScript
  compiler API. Use the npm scripts to select the intended compiler.
- Logged in to npm as `seungwoolee`: `npm whoami`
- Logged in to GitHub via `gh`: `gh auth status`
- On `main` branch with no untracked / uncommitted changes
- Working directory at repo root
- **npm Granular Access Token with "Bypass 2FA when publishing"** enabled —
  one-time setup at https://www.npmjs.com/settings/seungwoolee/tokens →
  Generate New Token → Granular Access Token → check "Bypass two-factor
  authentication when publishing", grant Read+Write on `@seungwoolee/agent-tree`,
  then `npm config set //registry.npmjs.org/:_authToken=npm_XXXXX`. Without
  this, subprocess publish fails: `--auth-type=web` silent-fails (no
  stdin/browser orchestration in agent-driven shells), classic-OTP path
  requires interactive stdin. Token expires per its TTL — re-issue then.

## Release sequence

### 1. Bump version everywhere

For 0.3.0, synchronize these editable version fields:

- `package.json` → `"version": "0.3.0"`
- `.claude-plugin/plugin.json` → `"version": "0.3.0"`
- `.claude-plugin/marketplace.json` → **both** `metadata.version` AND
  `plugins[0].version` → `"0.3.0"`
- `skills/agent-tree/SKILL.md` → frontmatter `version: 0.3.0`
- Refresh `package-lock.json` so its root package versions match.

CLI and MCP both use `src/version.ts`, which reads `package.json` in source
execution and uses `__PKG_VERSION__` in bundles. Do not add a separate
hard-coded version to `src/mcp/server.ts`. Update current-facing README
identity/runtime guidance and `.claude/commands/` audit expectations too.

> **Why**: the plugin/skill/MCP/marketplace version surfaces in Claude
> Code's plugin registry — drift causes confusion about which version is
> loaded. esbuild bakes `package.json#version` into both bundles via
> `__PKG_VERSION__`, so CLI `--version` and MCP `initialize` must match
> `package.json` after build.
>
> Quick sanity grep before committing:
>
> ```bash
> grep -nE '"version": "0\.[0-9]+\.[0-9]+"' package.json .claude-plugin/*.json
> grep -nE '^version: 0\.[0-9]+\.[0-9]+' skills/agent-tree/SKILL.md
> # All five editable fields above must show 0.3.0 for this release.
> node -e 'const p=require("./package-lock.json"); console.log(p.version, p.packages[""].version)'
> # Both lockfile root versions must also match.
> ```

### 2. Update CHANGELOG.md

- Move `## [Unreleased] — 0.3.0` content → `## [v0.3.0] — YYYY-MM-DD`
- Add a fresh empty `## [Unreleased]` at the top
- Keep already-published historical entries intact. Do not promote the
  unreleased section merely because a preparation commit was pushed.

### 3. Run the full check chain

```bash
npm run lint && npm run typecheck && npm run typecheck:legacy && npm test && npm run build
npm run check:release && npm run smoke:release
```

Review the release contract before publishing:

`check:release` verifies metadata and bundled versions. `smoke:release`
packs the local project, installs the tarball into a temporary directory,
and exercises the installed CLI and MCP server. Neither command publishes.

- `--file` auto-detects Claude Code or Codex JSONL; `--source` selects discovery
  (default Claude) or validates an explicit import. `--cwd` controls project
  discovery/config. `CLAUDE_CONFIG_DIR` and `CODEX_HOME` select source roots.
- `--sessions --limit 20 --json` returns a redacted `{ "sessions": [...] }`
  catalog for the selected source across projects unless `--cwd` restricts it.
  Codex reads bounded metadata headers and excludes subagents/symlinks.
- The Codex fixture exercises messages, tool calls/results, duplicate
  notifications, patch paths and compaction. Verify source-isolated stars
  and that resume hints retain `--source codex`.
- `--file <fixture.jsonl> --no-llm --strict --json` emits only a complete
  redacted mindmap on stdout. Malformed strict input must fail; incompatible
  modes/selectors/JSON display filters must exit 2.
- Phase-only views preserve canonical node numbers for snapshot lookup.
  `--dry-run --no-llm --dump-json <dir> --verbose` must not write dumps or
  caches; dry run alone does not disable paid labeling.
- TUI selection matches `--snapshot` for git context, redaction, pick
  recording, and clipboard behavior, and honors display filters.
- All six MCP tools and schemas below match the README and skill.
  MCP is heuristic-only; no smoke step should incur LLM charges.
- Config security invariants, per-field validation, file/config cache
  invalidation, and concurrent exact input-token reservations are covered by
  tests. The LLM input limit is not a monetary spending cap.

> Already enforced by `prepublishOnly`, but run manually first so you can
> see test output without the publish progress bar fighting for the terminal.
>
> **dist/ is committed**: `dist/*.js` is tracked in git (source-maps are
> ignored) so that `claude plugin marketplace add lifrary/agent-tree`
> → `install` works out of the box. `git add -A` in the next step will pick
> up any regenerated bundle.

### 4. Commit the reviewed release changes on main

```bash
git switch main
git diff --stat
git diff
git add -A   # only after confirming all changes belong to this release
git commit -m "release: vX.Y.Z"
git tag -a vX.Y.Z -m "Release vX.Y.Z"
git push origin main
git push origin vX.Y.Z
```

For preparation-only work, commit and push `main` without creating tags,
GitHub releases, or publishing to npm. Keep the changelog marked unreleased.

### 5. GitHub Release notes

```bash
# Extracts the just-promoted [vX.Y.Z] section from CHANGELOG
gh release create vX.Y.Z --title "vX.Y.Z" \
  --notes-file <(awk -v v="vX.Y.Z" \
    '/^## \['v'\]/{flag=1;next} /^## \[/{flag=0} flag' CHANGELOG.md)
```

### 6. npm publish

With a Granular Access Token + 2FA-bypass configured (Prerequisites
above), publish proceeds straight through:

```bash
npm publish --access public
```

Without bypass token, manual OTP fallback (interactive shell only):

```bash
npm publish --access public --otp=NNNNNN
```

> `prepublishOnly` re-runs lint+typecheck+test+build automatically. If it
> fails, the publish is aborted before any registry write.
>
> **Re-trying after an auth fix**: rerun `npm publish --access public`
> without disabling `prepublishOnly`, so the artifacts being published are
> checked and rebuilt from the current source.

### 7. Post-publish smoke test

```bash
# Run only after this exact version has been published.
VERSION=0.3.0
export VERSION
SMOKE_DIR=$(mktemp -d)
cd "$SMOKE_DIR"
npm init -y >/dev/null
npm install "@seungwoolee/agent-tree@$VERSION"
test "$(./node_modules/.bin/agent-tree --version)" = "$VERSION"

# Sequential initialize → initialized notification → tools/list.
# stderr stays separate from newline-delimited JSON-RPC stdout.
node --input-type=module <<'NODE'
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const child = spawn(process.execPath, [
  './node_modules/@seungwoolee/agent-tree/dist/mcp-server.js',
], { stdio: ['pipe', 'pipe', 'inherit'] });
const lines = createInterface({ input: child.stdout });
const pending = new Map();
let nextId = 0;
const timer = setTimeout(() => {
  child.kill();
  throw new Error('MCP smoke timed out');
}, 30_000);
const fail = (error) => {
  for (const request of pending.values()) request.reject(error);
  pending.clear();
};
child.on('error', fail);
child.on('exit', (code) => fail(new Error(`MCP exited: ${code}`)));
lines.on('line', (line) => {
  try {
    const response = JSON.parse(line);
    const request = pending.get(response.id);
    if (!request) return;
    pending.delete(response.id);
    if (response.error) request.reject(new Error(JSON.stringify(response.error)));
    else request.resolve(response.result);
  } catch (error) {
    fail(error);
  }
});
const send = (message) => child.stdin.write(JSON.stringify(message) + '\n');
const rpc = (method, params) => new Promise((resolve, reject) => {
  const id = ++nextId;
  pending.set(id, { resolve, reject });
  send({ jsonrpc: '2.0', id, method, params });
});
try {
  const init = await rpc('initialize', {
    protocolVersion: '2024-11-05', capabilities: {},
    clientInfo: { name: 'agent-tree-smoke', version: '1.0' },
  });
  assert.equal(init.serverInfo.version, process.env.VERSION);
  send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  const { tools } = await rpc('tools/list', {});
  const expected = [
    'agent_tree_sessions', 'agent_tree_list', 'agent_tree_snapshot',
    'agent_tree_picks', 'agent_tree_diff', 'agent_tree_unstar',
  ];
  assert.deepEqual(tools.map((tool) => tool.name).sort(), expected.sort());
  const schemas = Object.fromEntries(tools.map((tool) => [tool.name, tool.inputSchema]));
  const catalog = schemas.agent_tree_sessions.properties;
  assert.equal(catalog.limit.default, 20);
  assert.equal(catalog.limit.minimum, 1);
  assert.equal(catalog.limit.maximum, 1000);
  assert.equal(catalog.cwd.type, 'string');
  for (const schema of Object.values(schemas)) {
    assert.deepEqual(schema.properties.source.enum, ['claude', 'codex']);
  }
  for (const name of ['list', 'snapshot', 'diff', 'unstar']) {
    const schema = schemas[`agent_tree_${name}`];
    assert.equal(schema.properties.file.type, 'string');
    assert.equal(schema.properties.sessionId.type, 'string');
    assert.ok(schema.required.includes('cwd'));
  }
  assert.deepEqual(schemas.agent_tree_list.properties.format.enum, ['text', 'json']);
  assert.equal(schemas.agent_tree_list.properties.format.default, 'text');
  console.log('PASS: version and all 6 MCP tools/schemas match');
} finally {
  clearTimeout(timer);
  lines.close();
  child.kill();
}
NODE
```

This checks the published tarball, not local source. Before publication,
use a locally packed tarball in a separate temporary install instead of
claiming a registry smoke succeeded. `/mcp-smoke` automates the published
package check for maintainers.

### 8. Re-install the plugin so Claude Code picks up the new build

`~/.claude/plugins/local/` is **not** auto-scanned by Claude Code — a symlink
or copy there does not register the plugin's MCP server or skill. The
CLI-sanctioned install path writes to `installed_plugins.json` and
`settings.json#enabledPlugins`, and that registry entry is what triggers the
MCP spawn at session start.

**Maintainer (you) — after publishing a new version:**

```bash
# `claude plugin install` is idempotent when the plugin is already
# registered — it reports "already installed" and does NOT overwrite the
# cache. Must uninstall first to force a fresh copy of the new build.
claude plugin uninstall agent-tree@agent-tree
claude plugin install agent-tree@agent-tree   # writes cache/.../<new-version>/
```

Then restart Claude Code.

**Bootstrapping a fresh machine (you or external user):**

```bash
# If using the local repo clone as the marketplace source:
cd <where-you-cloned>
npm install && npm run build                  # dist/*.js is committed; rebuild after source edits
claude plugin marketplace add "$PWD"
claude plugin install agent-tree@agent-tree
# → Restart Claude Code
```

**External users — github-URL marketplace (from v0.1.1 onward)**:

```bash
claude plugin marketplace add lifrary/agent-tree   # owner/repo; current Claude Code rejects a github: prefix
claude plugin install agent-tree@agent-tree
# → Restart Claude Code
```

This works because `dist/*.js` is now committed (`.gitignore` exempts it);
`git clone` pulls the built bundle along with the manifests.

## Hotfix flow (vX.Y.Z+1)

1. Branch from `main` — patches must be linear over the released tag
2. Fix + test on the hotfix branch
3. Merge the reviewed fix into `main`
4. Tag and publish from `main`

## Known gotchas

- `npm publish` cannot be undone after 24 hours. If you ship a broken
  build, bump to vX.Y.Z+1 and republish — never `npm unpublish` an aged
  version.
- The `prepublishOnly` script runs `npm run build` and overwrites `dist/`.
  This is intentional — it guarantees the published tarball matches the
  source on `main`. Don't disable it.
- GitHub Release notes are best generated from CHANGELOG, not free-form,
  so the registry / GitHub / repo all tell the same story.
- macOS / Linux only for the smoke test in step 7. Windows users would
  need different shell syntax for the JSON-RPC pipe.
- **Tag-push vs `npm publish` ordering**: the canonical sequence in Step
  4–6 pushes `vX.Y.Z` tag _before_ `npm publish`. If `npm publish` fails
  at auth (silently-expired `.npmrc` token → `E401`), you're stuck with a
  live tag pointing to a version the registry doesn't have — fixing
  requires delete-tag-and-re-tag or a version bump. Defensive alternative
  proven on v0.1.1 and re-validated on v0.1.2: run `npm publish` **before**
  `git push origin vX.Y.Z` (the release commit can still push to main
  first so CI sees it; only the tag-push waits). Always `npm whoami` as a
  publish preflight — the canonical token-failure mode only surfaces at
  publish time.
- **Subprocess `npm publish --auth-type=web` silent-fails**: When run
  inside an agent-driven shell (no interactive stdin / no automated
  browser orchestration), `--auth-type=web` exits without performing the
  auth handshake → publish falls back to anonymous → npm hides "permission
  denied" behind `404 Not Found` on scoped packages (privacy feature, not
  a missing-package signal). The fix is the bypass-token path in
  Prerequisites. Discovered v0.1.2 (2026-04-25) when scheduled publish
  hung on Day 1 (OTP) and silently 404'd on Day 2 (web auth in
  subprocess). See `.claude-sessions/2026-04-24-23-09-v0.1.2-publish-pause.md`.
- **Granular Access Token defaults to 2FA-required**: A freshly issued
  granular token works for `npm whoami` and read operations immediately,
  but publish still throws `EOTP` until you re-issue with the "Bypass
  two-factor authentication when publishing" checkbox enabled. Easy to
  miss during initial token setup; the checkbox is on the same form as
  packages/scopes/permissions, not a separate page.
- **Folder-rename hazards (paired-mv discipline, exit-first ordering)**:
  Renaming the working tree (`mv ~/Code/<old> ~/Code/<new>`) changes the
  encoded directory used for project-scoped discovery. The v0.1.2 incident
  was resolved with a paired history-directory move; 0.2.0 can also access
  old history through the global catalog, UUID selection, or portable file
  import. Four distinctions matter:
  1. **inode/FD vs absolute-path resolution**: open file descriptors
     follow the inode through `mv`, but Claude Code's hook payloads
     (`transcript_path`, subprocess `cwd`, permission rules in
     `settings.local.json`) hold absolute paths and re-resolve on every
     use. Mid-session `mv` keeps the existing FD writing fine but breaks
     every fresh path resolution → silent permission-prompt regressions
     and stale-path subprocess respawns until restart.
  2. **Stored sessions keep the old project encoding**: the rule
     replaces every non-ASCII-alphanumeric character with `-`, so
     `~/Code/agent-tree` resolves to directory
     `-Users-seungwoolee-Code-agent-tree`. If only the working tree is
     renamed, project-scoped discovery uses a new encoded directory.
     In agent-tree, old files remain accessible through the all-project
     catalog, UUID selection, or `--file`; moving history is not required
     for portable imports. With `CLAUDE_CONFIG_DIR`, use its `projects/`
     directory instead of `~/.claude/projects/`.
  3. **Encoding is lossy**: `/`, `-`, `_`, punctuation, and non-ASCII
     characters become `-`, so distinct paths can collide. The encoded
     directory is a hint, not a reversible or unique project identity.
  4. **Exit-first ordering**: do the `mv` post-`/exit` only, never
     mid-session. Mid-session `mv` corrupts hook permission rules,
     triggers MCP-server respawn at stale paths, and leaves the agent
     in a broken state until full restart. The historical remediation was:
     `/exit` → `mv` working tree → paired `mv` `~/.claude/projects/`
     dir → `cd <new>` → `claude`. See
     `.claude-sessions/2026-04-25-18-57-folder-rename-decision.md` for
     the full incident log.
- **Plugin MCP spawns from marketplace source, not cache** (verified
  2026-04-25 with three independent signals):
  1. **`ps -ef`**: argv shows
     `node <source-cwd>//dist/mcp-server.js` — note the doubled slash
     from `${CLAUDE_PLUGIN_ROOT}/` + `/dist/...`.
  2. **`lsof -p <pid>`**: process `cwd DIR` resolves to the source
     tree (`/Users/seungwoolee/Code/agent-tree`) — not
     `~/.claude/plugins/cache/agent-tree/agent-tree/<version>/`.
  3. **Cache vs source byte-identity at install time**: `diff -q`
     on `dist/mcp-server.js` shows identical content with matching
     mtime immediately after `claude plugin install`, but cache
     stays put when source is rebuilt. Combined with signal 1+2,
     this means the runtime resolves to source — and the cache
     only matters as an artifact of `claude plugin install`'s
     bookkeeping, not as the loaded bundle.
     Implication: in-session MCP behavior reflects _current_ source, not
     the cached snapshot — editing `dist/mcp-server.js` in the source tree
     mid-session affects the next Claude Code restart even without a
     re-install. Cache file-count + CLI `--version` checks
     (`/pre-publish-audit`) are necessary but **not sufficient** to prove
     the in-session MCP runtime loads the published code; only a `/tmp`
     clean-dir install of the published tarball (`/mcp-smoke`) exercises
     the registry-served bundle end-to-end. Stale dev-path MCP processes
     also survive folder rename — `ps -ef` after a rename shows entries
     pointing at the old (now-missing) directory until each spawning
     Claude Code session is restarted (paired-mv discipline above does not
     help here; only restart does).

  **Marketplace type controls the spawn path.** Verified by inspecting
  `~/.claude/settings.json#extraKnownMarketplaces` and cross-referencing
  with `ps -ef` for multiple installed plugins:
  - **`directory` source** (this repo's setup; `claude plugin
marketplace add "$PWD"` writes `{"source":"directory","path":"<abs
cwd>"}`) → `${CLAUDE_PLUGIN_ROOT}` resolves to that registered
    path, so MCP spawns from source. Cache exists but is not consumed
    at runtime.
  - **`github` source** (e.g., `oh-my-claudecode@omc` registered via
    `claude plugin marketplace add <owner>/<repo>`) → `${CLAUDE_PLUGIN_ROOT}`
    resolves to the cache path
    (`~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/`),
    so MCP spawns from cache. Source path doesn't exist locally for
    this case.
  - Practical consequence: this repo's `directory` registration means
    a folder rename or `mv` of the source tree breaks the plugin
    immediately for the next Claude Code session, because the
    `extraKnownMarketplaces.<name>.source.path` is an absolute string
    and does not auto-update. Either re-run `claude plugin marketplace
add "$NEW_PWD"` after rename, or hand-edit
    `~/.claude/settings.json#extraKnownMarketplaces.agent-tree.source.path`.
