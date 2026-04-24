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

## Release sequence

### 1. Bump version everywhere

Four sources of truth must move together:

- `package.json` → `"version": "0.X.Y"`
- `.claude-plugin/plugin.json` → `"version": "0.X.Y"`
- `src/mcp/server.ts` → `version: '0.X.Y'` in the `McpServer({...})` block
- `skills/agent-tree/SKILL.md` → frontmatter `version: 0.X.Y`

> **Why**: the plugin/skill/MCP version surfaces in Claude Code's plugin
> registry — drift causes confusion about which version is loaded. esbuild
> bakes `package.json#version` into `dist/cli.js` via `__PKG_VERSION__`, so
> `agent-tree --version` always matches `package.json` after build.

### 2. Update CHANGELOG.md

- Move `## [Unreleased]` content → `## [v0.X.Y] — YYYY-MM-DD`
- Add a fresh empty `## [Unreleased]` at the top

### 3. Run the full check chain

```bash
npm run lint && npm run typecheck && npm test && npm run build
```

> Already enforced by `prepublishOnly`, but run manually first so you can
> see test output without the publish progress bar fighting for the terminal.

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

```bash
npm publish --access public
# 2FA on? add: --otp=NNNNNN
```

> `prepublishOnly` re-runs lint+typecheck+test+build automatically. If it
> fails, the publish is aborted before any registry write.

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

### 8. Re-link plugin (if dev install is symlinked)

If you symlinked `~/.claude/plugins/local/agent-tree` → `~/Code/oh-my-claude-map`,
the symlink target now has the new build. Restart Claude Code so the plugin
loader picks up the new manifest version.

> External users do `git pull && npm install && npm run build` in their
> `~/.claude/plugins/local/agent-tree/` clone — their flow is unchanged
> across versions.

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
