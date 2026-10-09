/** Source-independent discovery, selection and portable imports. */
import { lstat, realpath } from 'node:fs/promises';
import { basename, dirname, extname, resolve } from 'node:path';
import { detectSessionSource, getSessionSource } from '../sources/index.js';
import { isFullUuid, isUuidPrefix } from '../sources/files.js';
import type {
  DiscoverOptions,
  SessionEntry,
  SessionMatch,
  SessionSourceId,
} from '../sources/types.js';

export type { SessionEntry, SessionMatch } from '../sources/types.js';

export interface SessionSelection extends DiscoverOptions {
  source?: SessionSourceId;
}

export async function listSessions(
  opts: SessionSelection & { limit?: number } = {},
): Promise<SessionEntry[]> {
  if (opts.limit !== undefined && (!Number.isSafeInteger(opts.limit) || opts.limit < 0)) {
    throw new RangeError('session limit must be a nonnegative safe integer');
  }
  if (opts.limit === 0) return [];
  const sessions = await getSessionSource(opts.source).discover(opts);
  sessions.sort(compareSessions);
  return opts.limit === undefined ? sessions : sessions.slice(0, opts.limit);
}

export async function sessionFromFile(
  filePath: string,
  source?: SessionSourceId,
): Promise<SessionMatch> {
  const jsonlPath = await realpath(resolve(filePath));
  if (extname(jsonlPath) !== '.jsonl') throw new Error('session file must have a .jsonl extension');
  const info = await lstat(jsonlPath);
  if (!info.isFile()) throw new Error('session file must be a regular file');
  return {
    source: await detectSessionSource(jsonlPath, source),
    sessionId: basename(jsonlPath, '.jsonl'),
    projectDir: basename(dirname(jsonlPath)),
    jsonlPath,
  };
}

export async function locateSession(
  sessionIdOrPrefix: string,
  opts: SessionSelection & { projectHint?: string } = {},
): Promise<SessionMatch[]> {
  const prefix = sessionIdOrPrefix.toLowerCase();
  if (!isUuidPrefix(prefix) && !isFullUuid(prefix)) {
    throw new Error('session id is not a valid UUID or prefix');
  }
  const matches = (await listSessions(opts)).filter((session) =>
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

export async function findLatestSession(opts: SessionSelection = {}): Promise<SessionMatch | null> {
  const [latest] = await listSessions({ ...opts, limit: 1 });
  return latest ? toSessionMatch(latest) : null;
}

export async function findLatestSessionInProject(
  cwd: string,
  opts: SessionSelection = {},
): Promise<SessionMatch | null> {
  return findLatestSession({ ...opts, projectCwd: cwd });
}

function compareSessions(a: SessionEntry, b: SessionEntry): number {
  return (
    b.mtimeMs - a.mtimeMs || (a.jsonlPath < b.jsonlPath ? -1 : a.jsonlPath > b.jsonlPath ? 1 : 0)
  );
}

function toSessionMatch(entry: SessionEntry): SessionMatch {
  return {
    source: entry.source,
    sessionId: entry.sessionId,
    projectDir: entry.projectDir,
    jsonlPath: entry.jsonlPath,
  };
}
