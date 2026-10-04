/**
 * Session path helpers — SPEC §4.1
 *
 * Claude Code stores per-project session JSONL under
 *   <CLAUDE_CONFIG_DIR or ~/.claude>/projects/<encoded-project-path>/<uuid>.jsonl
 *
 * Encoding: absolute path → replace every non-ASCII-alphanumeric character
 * with `-` (e.g. `/Users/x/Code/my_project` → `-Users-x-Code-my-project`).
 *
 * Encoding is not reversible, so the encoded directory name is only a project
 * hint, not a way to recover the original working directory.
 */

import type { Dirent, Stats } from 'node:fs';
import { lstat, readdir, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, extname, join, resolve } from 'node:path';

export function getProjectsRoot(): string {
  return resolve(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'projects');
}

export function encodeProjectPath(absPath: string): string {
  return absPath.replace(/[^a-zA-Z0-9]/g, '-');
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

export interface SessionEntry extends SessionMatch {
  mtimeMs: number;
  sizeBytes: number;
}

/**
 * Discover regular UUID-named session files without following symlinks.
 * Missing paths and paths replaced by non-directories are normal scan races;
 * other filesystem failures must remain visible to callers.
 */
export async function listSessions(
  opts: { projectsRoot?: string; projectCwd?: string; limit?: number } = {},
): Promise<SessionEntry[]> {
  if (opts.limit !== undefined && (!Number.isSafeInteger(opts.limit) || opts.limit < 0)) {
    throw new RangeError('session limit must be a nonnegative safe integer');
  }
  if (opts.limit === 0) return [];

  const root = resolve(opts.projectsRoot ?? getProjectsRoot());
  const rootInfo = await lstatIfPresent(root);
  if (!rootInfo?.isDirectory()) return [];

  const projectDirs =
    opts.projectCwd === undefined
      ? (await readDirectory(root))
          .filter((entry) => entry.isDirectory())
          .map((entry) => entry.name)
      : [encodeProjectPath(opts.projectCwd)];
  const sessions: SessionEntry[] = [];

  for (const projectDir of projectDirs) {
    if (!projectDir) continue;
    const projectPath = join(root, projectDir);
    const projectInfo = await lstatIfPresent(projectPath);
    if (!projectInfo?.isDirectory()) continue;
    const projectSessions: SessionEntry[] = [];

    for (const file of await readDirectory(projectPath)) {
      if (!file.isFile() || !file.name.endsWith('.jsonl')) continue;
      const sessionId = file.name.slice(0, -'.jsonl'.length);
      if (!isFullUuid(sessionId)) continue;

      const jsonlPath = join(projectPath, file.name);
      const info = await lstatIfPresent(jsonlPath);
      if (!info?.isFile()) continue;
      projectSessions.push({
        sessionId,
        projectDir,
        jsonlPath,
        mtimeMs: info.mtimeMs,
        sizeBytes: info.size,
      });
    }

    // Discard files from a directory removed, replaced, or turned into a
    // symlink while the scan was in progress.
    if (await isSameDirectory(projectPath, projectInfo)) {
      for (const session of projectSessions) sessions.push(session);
    }
  }

  if (!(await isSameDirectory(root, rootInfo))) return [];
  sessions.sort(compareSessions);
  return opts.limit === undefined ? sessions : sessions.slice(0, opts.limit);
}

/**
 * Import an explicitly selected JSONL file, including portable exports whose
 * names are not UUIDs. The reader can replace the provisional id with the
 * session id recorded in the JSONL envelope.
 */
export async function sessionFromFile(filePath: string): Promise<SessionMatch> {
  const jsonlPath = await realpath(resolve(filePath));
  if (extname(jsonlPath) !== '.jsonl') {
    throw new Error('session file must have a .jsonl extension');
  }
  const info = await lstat(jsonlPath);
  if (!info.isFile()) {
    throw new Error('session file must be a regular file');
  }
  return {
    sessionId: basename(jsonlPath, '.jsonl'),
    projectDir: basename(dirname(jsonlPath)),
    jsonlPath,
  };
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
  const prefix = sessionIdOrPrefix.toLowerCase();

  if (!isUuidPrefix(prefix) && !isFullUuid(prefix)) {
    throw new Error(`session id "${sessionIdOrPrefix}" is not a valid UUID or prefix`);
  }

  const matches = (await listSessions({ projectsRoot: opts.projectsRoot })).filter((session) =>
    session.sessionId.toLowerCase().startsWith(prefix),
  );

  matches.sort((a, b) => {
    if (opts.projectHint) {
      const aHit = a.projectDir === opts.projectHint ? 1 : 0;
      const bHit = b.projectDir === opts.projectHint ? 1 : 0;
      if (aHit !== bHit) return bHit - aHit;
    }
    return compareSessions(a, b);
  });

  return matches.map(toSessionMatch);
}

/**
 * Find the most recently modified session across all projects — powers --latest.
 */
export async function findLatestSession(
  projectsRoot: string = getProjectsRoot(),
): Promise<SessionMatch | null> {
  const [latest] = await listSessions({ projectsRoot, limit: 1 });
  return latest ? toSessionMatch(latest) : null;
}

/**
 * Find the most recently modified session within the current cwd's encoded
 * project directory — used as the smart default when `agent-tree` is invoked
 * without `--latest` / `--pick` / a session id. Returns null when no session
 * exists for this project (caller should fall back to `findLatestSession`).
 */
export async function findLatestSessionInProject(
  cwd: string,
  projectsRoot: string = getProjectsRoot(),
): Promise<SessionMatch | null> {
  const [latest] = await listSessions({ projectsRoot, projectCwd: cwd, limit: 1 });
  return latest ? toSessionMatch(latest) : null;
}

function compareSessions(a: SessionEntry, b: SessionEntry): number {
  return (
    b.mtimeMs - a.mtimeMs || (a.jsonlPath < b.jsonlPath ? -1 : a.jsonlPath > b.jsonlPath ? 1 : 0)
  );
}

function toSessionMatch(entry: SessionEntry): SessionMatch {
  return {
    sessionId: entry.sessionId,
    projectDir: entry.projectDir,
    jsonlPath: entry.jsonlPath,
  };
}

function isMissingPath(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

async function lstatIfPresent(path: string): Promise<Stats | null> {
  try {
    return await lstat(path);
  } catch (error) {
    if (isMissingPath(error)) return null;
    throw error;
  }
}

async function readDirectory(path: string): Promise<Dirent[]> {
  try {
    return await readdir(path, { withFileTypes: true });
  } catch (error) {
    if (isMissingPath(error)) return [];
    throw error;
  }
}

async function isSameDirectory(path: string, original: Stats): Promise<boolean> {
  const current = await lstatIfPresent(path);
  return (
    current !== null &&
    current.isDirectory() &&
    current.dev === original.dev &&
    current.ino === original.ino
  );
}
