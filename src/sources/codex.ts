import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { readCodex } from '../reader/codex.js';
import {
  isFullUuid,
  isMissingPath,
  isSameDirectory,
  lstatIfPresent,
  readDirectory,
} from './files.js';
import type { DiscoverOptions, SessionEntry, SessionSource } from './types.js';

const ROLLOUT_NAME =
  /^rollout-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}-\d{2})?-([0-9a-fA-F-]{36})\.jsonl$/;
const DATE_DIRECTORIES = [/^\d{4}$/, /^(?:0[1-9]|1[0-2])$/, /^(?:0[1-9]|[12]\d|3[01])$/];
// Session metadata may contain sizeable base instructions. Discovery must not
// read the rest of a rollout, or allocate an unbounded first physical line.
const HEADER_LIMIT = 1024 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function sessionEntry(jsonlPath: string, filenameId: string): Promise<SessionEntry | null> {
  const original = await lstatIfPresent(jsonlPath);
  if (!original?.isFile()) return null;
  let handle: FileHandle | undefined;
  try {
    // NONBLOCK also prevents a regular file replaced with a FIFO from hanging.
    handle = await open(
      jsonlPath,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    const info = await handle.stat();
    if (!info.isFile() || info.dev !== original.dev || info.ino !== original.ino) return null;
    const chunks: Buffer[] = [];
    let length = 0;
    let finished = false;
    while (length < HEADER_LIMIT) {
      const buffer = Buffer.allocUnsafe(Math.min(16 * 1024, HEADER_LIMIT - length));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (bytesRead === 0) {
        finished = true;
        break;
      }
      const newline = buffer.subarray(0, bytesRead).indexOf(10);
      const used = newline === -1 ? bytesRead : newline;
      chunks.push(buffer.subarray(0, used));
      length += used;
      if (newline !== -1) {
        finished = true;
        break;
      }
    }
    if (!finished) return null;
    let header: unknown;
    try {
      header = JSON.parse(Buffer.concat(chunks, length).toString('utf8').trim());
    } catch {
      return null;
    }
    if (!isRecord(header) || header.type !== 'session_meta' || !isRecord(header.payload))
      return null;
    const meta = header.payload;
    const id = meta.id;
    if (typeof id !== 'string' || !isFullUuid(id) || id.toLowerCase() !== filenameId.toLowerCase())
      return null;
    if (
      meta.session_id !== undefined &&
      (typeof meta.session_id !== 'string' || !isFullUuid(meta.session_id))
    )
      return null;
    if (typeof meta.cwd !== 'string' || !meta.cwd.trim()) return null;
    if (
      meta.source === 'subagent' ||
      (isRecord(meta.source) && Object.hasOwn(meta.source, 'subagent'))
    )
      return null;
    const current = await lstatIfPresent(jsonlPath);
    if (!current?.isFile() || current.dev !== info.dev || current.ino !== info.ino) return null;
    return {
      source: 'codex',
      sessionId: id,
      projectDir: meta.cwd,
      jsonlPath,
      mtimeMs: info.mtimeMs,
      sizeBytes: info.size,
    };
  } catch (error) {
    if (isMissingPath(error) || (error as NodeJS.ErrnoException | null)?.code === 'ELOOP')
      return null;
    throw error;
  } finally {
    await handle?.close();
  }
}

async function discover(options: DiscoverOptions): Promise<SessionEntry[]> {
  const root = resolve(
    options.root ?? resolve(process.env.CODEX_HOME || join(homedir(), '.codex'), 'sessions'),
  );
  const projectCwd = options.projectCwd === undefined ? undefined : resolve(options.projectCwd);

  async function visit(directory: string, depth: number): Promise<SessionEntry[]> {
    const original = await lstatIfPresent(directory);
    if (!original?.isDirectory()) return [];
    const sessions: SessionEntry[] = [];
    for (const entry of await readDirectory(directory)) {
      if (depth < DATE_DIRECTORIES.length) {
        if (entry.isDirectory() && DATE_DIRECTORIES[depth].test(entry.name)) {
          for (const session of await visit(join(directory, entry.name), depth + 1))
            sessions.push(session);
        }
      } else if (entry.isFile()) {
        const match = ROLLOUT_NAME.exec(entry.name);
        if (!match || !isFullUuid(match[1])) continue;
        const session = await sessionEntry(join(directory, entry.name), match[1]);
        if (session && (projectCwd === undefined || resolve(session.projectDir) === projectCwd)) {
          sessions.push(session);
        }
      }
    }
    // Discard the entire subtree if any ancestor was replaced during the scan.
    return (await isSameDirectory(directory, original)) ? sessions : [];
  }

  return visit(root, 0);
}

export const codexSource: SessionSource = {
  id: 'codex',
  discover,
  accepts: (record) =>
    typeof record.type === 'string' &&
    ['session_meta', 'turn_context', 'response_item', 'event_msg', 'compacted'].includes(
      record.type,
    ) &&
    isRecord(record.payload),
  read: readCodex,
};
