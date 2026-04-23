/**
 * Session path helpers — SPEC §4.1
 *
 * Claude Code stores per-project session JSONL under
 *   ~/.claude/projects/<encoded-project-path>/<session-uuid>.jsonl
 *
 * Encoding: absolute path → replace every `/` with `-`. A leading `/` becomes a
 * leading `-` (e.g. `/Users/x/Code/workspace` → `-Users-x-Code-workspace`).
 *
 * We don't assume a lossless round-trip for the path — if the absolute path ever
 * contained a real `-`, the encoding is ambiguous. For M1 we only need:
 *   1. encode(cwd) → dir name (so we can prefer same-project matches)
 *   2. locate(sessionIdOrPrefix) → absolute JSONL path (scan + prefix match)
 */

import { readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const CLAUDE_PROJECTS_ROOT = join(homedir(), '.claude', 'projects');

export function encodeProjectPath(absPath: string): string {
  return absPath.replace(/\//g, '-');
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UUID_LOOSE = /^[0-9a-f-]+$/i;

export function isFullUuid(s: string): boolean {
  return UUID_RE.test(s);
}

export function isUuidPrefix(s: string): boolean {
  return UUID_LOOSE.test(s) && s.length >= 4 && s.length <= 36;
}

export interface SessionMatch {
  sessionId: string;
  projectDir: string; // encoded project dir name
  jsonlPath: string; // absolute path
}

/**
 * Locate session JSONL files matching either a full UUID or a prefix.
 *
 * Preference order:
 *   1. Same `projectHint` (encoded cwd) first when provided
 *   2. Most recently modified jsonl wins on ties
 */
export async function locateSession(
  sessionIdOrPrefix: string,
  opts: { projectHint?: string; projectsRoot?: string } = {},
): Promise<SessionMatch[]> {
  const root = opts.projectsRoot ?? CLAUDE_PROJECTS_ROOT;
  const prefix = sessionIdOrPrefix.toLowerCase();

  if (!isUuidPrefix(prefix) && !isFullUuid(prefix)) {
    throw new Error(
      `session id "${sessionIdOrPrefix}" is not a valid UUID or prefix`,
    );
  }

  const projectDirs = await safeReaddir(root);
  const matches: Array<SessionMatch & { mtimeMs: number }> = [];

  for (const projectDir of projectDirs) {
    const projectPath = join(root, projectDir);
    const files = await safeReaddir(projectPath);
    for (const fname of files) {
      if (!fname.endsWith('.jsonl')) continue;
      const id = fname.slice(0, -'.jsonl'.length);
      if (!id.toLowerCase().startsWith(prefix)) continue;
      const fullPath = join(projectPath, fname);
      let mtimeMs = 0;
      try {
        mtimeMs = (await stat(fullPath)).mtimeMs;
      } catch {
        // ignore
      }
      matches.push({
        sessionId: id,
        projectDir,
        jsonlPath: fullPath,
        mtimeMs,
      });
    }
  }

  matches.sort((a, b) => {
    if (opts.projectHint) {
      const aHit = a.projectDir === opts.projectHint ? 1 : 0;
      const bHit = b.projectDir === opts.projectHint ? 1 : 0;
      if (aHit !== bHit) return bHit - aHit;
    }
    return b.mtimeMs - a.mtimeMs;
  });

  return matches.map(({ mtimeMs: _m, ...rest }) => rest);
}

/**
 * Find the most recently modified session across all projects — powers --latest.
 */
export async function findLatestSession(
  projectsRoot: string = CLAUDE_PROJECTS_ROOT,
): Promise<SessionMatch | null> {
  const projectDirs = await safeReaddir(projectsRoot);
  let best: (SessionMatch & { mtimeMs: number }) | null = null;
  for (const projectDir of projectDirs) {
    const projectPath = join(projectsRoot, projectDir);
    const files = await safeReaddir(projectPath);
    for (const fname of files) {
      if (!fname.endsWith('.jsonl')) continue;
      const id = fname.slice(0, -'.jsonl'.length);
      const fullPath = join(projectPath, fname);
      let mtimeMs = 0;
      try {
        mtimeMs = (await stat(fullPath)).mtimeMs;
      } catch {
        continue;
      }
      if (!best || mtimeMs > best.mtimeMs) {
        best = { sessionId: id, projectDir, jsonlPath: fullPath, mtimeMs };
      }
    }
  }
  if (!best) return null;
  const { mtimeMs: _m, ...rest } = best;
  return rest;
}

/**
 * Find the most recently modified session within the current cwd's encoded
 * project directory — used as the smart default when `agent-tree` is invoked
 * without `--latest` / `--pick` / a session id. Returns null when no session
 * exists for this project (caller should fall back to `findLatestSession`).
 */
export async function findLatestSessionInProject(
  cwd: string,
  projectsRoot: string = CLAUDE_PROJECTS_ROOT,
): Promise<SessionMatch | null> {
  const projectDir = encodeProjectPath(cwd);
  const projectPath = join(projectsRoot, projectDir);
  const files = await safeReaddir(projectPath);
  let best: (SessionMatch & { mtimeMs: number }) | null = null;
  for (const fname of files) {
    if (!fname.endsWith('.jsonl')) continue;
    const id = fname.slice(0, -'.jsonl'.length);
    const fullPath = join(projectPath, fname);
    let mtimeMs = 0;
    try {
      mtimeMs = (await stat(fullPath)).mtimeMs;
    } catch {
      continue;
    }
    if (!best || mtimeMs > best.mtimeMs) {
      best = { sessionId: id, projectDir, jsonlPath: fullPath, mtimeMs };
    }
  }
  if (!best) return null;
  const { mtimeMs: _m, ...rest } = best;
  return rest;
}

async function safeReaddir(path: string): Promise<string[]> {
  try {
    return await readdir(path);
  } catch {
    return [];
  }
}
