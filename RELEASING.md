# Releasing agent-tree

This is the v0.X.Y → v0.X.Y+1 (or v0.X+1.0) checklist. Captures the sequence
that shipped v0.1.0 so the next release doesn't re-discover it.

The OMC `release` skill (`/oh-my-claudecode:release`) handles the generic
ordering — this doc is the agent-tree-specific overlay (project-aware steps,
post-publish smoke test, MCP plugin re-install).

## Prerequisites

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

Five sources of truth (six fields) must move together:

- `package.json` → `"version": "0.X.Y"`
- `.claude-plugin/plugin.json` → `"version": "0.X.Y"`
- `.claude-plugin/marketplace.json` → **both** `metadata.version` AND
  `plugins[0].version` → `"0.X.Y"`
- `src/mcp/server.ts` → `version: '0.X.Y'` in the `McpServer({...})` block
- `skills/agent-tree/SKILL.md` → frontmatter `version: 0.X.Y`

> **Why**: the plugin/skill/MCP/marketplace version surfaces in Claude
> Code's plugin registry — drift causes confusion about which version is
> loaded. esbuild bakes `package.json#version` into `dist/cli.js` via
> `__PKG_VERSION__`, so `agent-tree --version` always matches
> `package.json` after build.
>
> Quick sanity grep before committing:
> ```bash
> grep -nE '"version": "0\.[0-9]+\.[0-9]+"' package.json .claude-plugin/*.json
> grep -nE "version: '0\.[0-9]+\.[0-9]+'" src/mcp/server.ts
> grep -nE '^version: 0\.[0-9]+\.[0-9]+' skills/agent-tree/SKILL.md
> # All six occurrences must show the same 0.X.Y.
> ```

### 2. Update CHANGELOG.md

- Move `## [Unreleased]` content → `## [v0.X.Y] — YYYY-MM-DD`
- Add a fresh empty `## [Unreleased]` at the top

### 3. Run the full check chain

```bash
npm run lint && npm run typecheck && npm test && npm run build
```

> Already enforced by `prepublishOnly`, but run manually first so you can
> see test output without the publish progress bar fighting for the terminal.
>
> **dist/ is committed**: `dist/*.js` is tracked in git (source-maps are
> ignored) so that `claude plugin marketplace add github:lifrary/agent-tree`
> → `install` works out of the box. `git add -A` in the next step will pick
> up any regenerated bundle.

### 4. Commit on dev → fast-forward main

```bash
git checkout dev
git add -A   # safe here — package.json, CHANGELOG, manifests
git commit -m "release: vX.Y.Z"
git push origin dev

git checkout main
git merge --ff-only dev
git tag -a vX.Y.Z -m "Release vX.Y.Z"
git push origin main
git push origin vX.Y.Z
```

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
> **Re-trying after an auth fix**: skip the second `prepublishOnly` with
> `npm publish --access public --ignore-scripts` when lint+typecheck+test+build
> already passed in the same shell session — esbuild bakes
> `package.json#version` into `dist/cli.js` at build time, so once `dist/`
> matches the bumped version, re-running scripts is wasted ceremony.
> Validated v0.1.2 publish (2026-04-25).

### 7. Post-publish smoke test

```bash
# In a clean tmp dir — no chance of resolving local node_modules
cd /tmp && rm -rf agent-tree-smoke && mkdir agent-tree-smoke && cd agent-tree-smoke
npm init -y >/dev/null
npm install @seungwoolee/agent-tree
./node_modules/.bin/agent-tree --version   # must equal vX.Y.Z
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' \
  | node ./node_modules/@seungwoolee/agent-tree/dist/mcp-server.js \
  | grep -oE '"name":"agent_tree_[a-z]+"' | sort -u
# Must list all 5 agent_tree_* tools
```

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
npm install && npm run build                  # dist/ is gitignored; must exist before install
claude plugin marketplace add "$PWD"
claude plugin install agent-tree@agent-tree
# → Restart Claude Code
```

**External users — github-URL marketplace (from v0.1.1 onward)**:

```bash
claude plugin marketplace add github:lifrary/agent-tree
claude plugin install agent-tree@agent-tree
# → Restart Claude Code
```

This works because `dist/*.js` is now committed (`.gitignore` exempts it);
`git clone` pulls the built bundle along with the manifests.

## Hotfix flow (vX.Y.Z+1)

1. Branch from `main` (not `dev`) — patches must be linear over the released tag
2. Fix + test on the hotfix branch
3. Merge into both `main` and `dev`
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
  4–6 pushes `vX.Y.Z` tag *before* `npm publish`. If `npm publish` fails
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
  Renaming the working tree (`mv ~/Code/<old> ~/Code/<new>`) without a
  paired `mv` of the matching Claude Code session storage
  (`mv ~/.claude/projects/-Users-...-<old> -Users-...-<new>`) makes the
  cwd→encoded-path lookup in `src/utils/session_path.ts` return zero —
  the tool goes blind to its own JSONL history. Four asymmetries that
  bite:
    1. **inode/FD vs absolute-path resolution**: open file descriptors
       follow the inode through `mv`, but Claude Code's hook payloads
       (`transcript_path`, subprocess `cwd`, permission rules in
       `settings.local.json`) hold absolute paths and re-resolve on every
       use. Mid-session `mv` keeps the existing FD writing fine but breaks
       every fresh path resolution → silent permission-prompt regressions
       and stale-path subprocess respawns until restart.
    2. **Paired `~/.claude/projects/` mv is mandatory**: encoded-cwd rule
       is `/` → `-`, so `~/Code/agent-tree` resolves to directory
       `-Users-seungwoolee-Code-agent-tree`. If only the working tree is
       renamed, JSONL files become unreachable to both Claude Code (which
       writes to a fresh dir under the new encoded name) and agent-tree
       (which reads from the encoded-of-cwd dir).
    3. **Encoded-path slash→hyphen rule**: a single `/` becomes a single
       `-` with no escaping, so any literal `-` already in a folder name
       can collide with a sibling whose `/` is at that position. Avoid
       `-` in folder names if you anticipate future renames.
    4. **Exit-first ordering**: do the `mv` post-`/exit` only, never
       mid-session. Mid-session `mv` corrupts hook permission rules,
       triggers MCP-server respawn at stale paths, and leaves the agent
       in a broken state until full restart. The user-side ceremony is:
       `/exit` → `mv` working tree → paired `mv` `~/.claude/projects/`
       dir → `cd <new>` → `claude`. See
       `.claude-sessions/2026-04-25-18-57-folder-rename-decision.md` for
       the full incident log.
- **Plugin MCP can spawn from source, not cache** (verified 2026-04-25):
  `claude plugin install` builds a real copy under
  `~/.claude/plugins/cache/agent-tree/agent-tree/<version>/`, but
  `ps -ef | grep mcp-server.js` shows the running MCP server invoked
  from the marketplace source directory (`node <source-cwd>//dist/...`,
  note the doubled slash from `${CLAUDE_PLUGIN_ROOT}/` + `/dist/...`),
  not the cache. Implication: in-session MCP behavior reflects *current*
  source, not the cached snapshot — editing `dist/mcp-server.js` in the
  source tree mid-session affects the next Claude Code restart even
  without a re-install. Cache file-count + CLI `--version` checks
  (`/pre-publish-audit`) are necessary but **not sufficient** to prove
  the in-session MCP runtime loads the published code; only a `/tmp`
  clean-dir install of the *published tarball* (`/mcp-smoke`) exercises
  the registry-served bundle end-to-end. A consequence: stale dev-path
  MCP processes survive folder rename — `ps -ef` after a rename will
  show entries pointing at the old (now-missing) directory until each
  Claude Code session that spawned them is restarted.
