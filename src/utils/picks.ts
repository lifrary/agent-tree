/**
 * Pick history — track which nodes the user has already snapshotted.
 *
 * Recorded at `~/.cache/agent-tree/picks/<session-id>.jsonl` (session-scoped,
 * not config-scoped, so re-running with different `--no-llm` / sidechain
 * options still surfaces past picks). Append-only JSONL — each line is one
 * pick `{node_id, mode, ts}`.
 *
 * The list / TUI renderers read this map to mark visited nodes with ⭐
 * (binary, GitHub-style — single emoji regardless of mode), giving the user
 * "been there" awareness.
 *
 * Mutation safety:
 *   - `recordPick` uses `appendFile`, which on POSIX is atomic for writes
 *     under PIPE_BUF (typically 4096 bytes). One pick line is ~120 bytes
 *     so concurrent CLI invocations won't interleave bytes mid-line. This
 *     is the canonical "append-only log" pattern.
 *   - `removePicksForNode` writes via tmp-file + atomic `rename` to avoid
 *     losing concurrent `recordPick` writes between read and rewrite.
 *   - Path-traversal hardening: `picksFileFor` rejects any sessionId not
 *     matching `/^[0-9a-f-]{4,40}$/i` — defense in depth on top of the
 *     `locateSession` validator that already gates the same regex upstream.
 */

import { randomBytes } from 'node:crypto';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const PICKS_ROOT = join(homedir(), '.cache', 'agent-tree', 'picks');

export interface Pick {
  node_id: string;
  mode: 'continue' | 'fork';
  ts: string; // ISO-8601
}

export interface PickIndex {
  /** node_id → set of modes ever picked */
  modesByNode: Map<string, Set<'continue' | 'fork'>>;
  /** total picks recorded */
  total: number;
}

// Defense-in-depth: locateSession already validates against /^[0-9a-f-]+$/i,
// but enforce here too so the picks store never composes a path from
// untrusted input (path-traversal hardening per security audit MEDIUM-5).
const SESSION_ID_RE = /^[0-9a-f-]{4,40}$/i;

function picksFileFor(sessionId: string, root = PICKS_ROOT): string {
  if (!SESSION_ID_RE.test(sessionId)) {
    throw new Error(`refusing to compose picks path for invalid sessionId "${sessionId}"`);
  }
  return join(root, `${sessionId}.jsonl`);
}

export async function recordPick(
  sessionId: string,
  nodeId: string,
  mode: 'continue' | 'fork',
  opts: { root?: string } = {},
): Promise<void> {
  const file = picksFileFor(sessionId, opts.root);
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const entry: Pick = { node_id: nodeId, mode, ts: new Date().toISOString() };
  await appendFile(file, JSON.stringify(entry) + '\n', 'utf8');
}

export interface SessionPicks {
  sessionId: string;
  picks: Pick[];
}

/**
 * List every recorded pick across every session, newest first. Used by
 * `agent-tree --picks` so users can review their navigation history.
 */
export async function listAllPicks(
  opts: { root?: string } = {},
): Promise<SessionPicks[]> {
  const root = opts.root ?? PICKS_ROOT;
  const { readdir } = await import('node:fs/promises');
  let files: string[];
  try {
    files = await readdir(root);
  } catch {
    return [];
  }
  const out: SessionPicks[] = [];
  for (const fname of files) {
    if (!fname.endsWith('.jsonl')) continue;
    const sessionId = fname.slice(0, -'.jsonl'.length);
    const filePath = join(root, fname);
    let raw: string;
    try {
      raw = await readFile(filePath, 'utf8');
    } catch {
      continue;
    }
    const picks: Pick[] = [];
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed) as Pick;
        if (parsed.node_id) picks.push(parsed);
      } catch {
        // ignore
      }
    }
    if (picks.length > 0) out.push({ sessionId, picks });
  }
  // Newest session activity first (compare last pick timestamp)
  out.sort((a, b) => {
    const ta = a.picks[a.picks.length - 1]?.ts ?? '';
    const tb = b.picks[b.picks.length - 1]?.ts ?? '';
    return tb.localeCompare(ta);
  });
  return out;
}

/**
 * Remove every pick entry for a given (session, node_id) pair. Returns the
 * number of entries removed. Atomic-ish via rewrite-then-rename.
 */
export async function removePicksForNode(
  sessionId: string,
  nodeId: string,
  opts: { root?: string } = {},
): Promise<number> {
  const file = picksFileFor(sessionId, opts.root);
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch {
    return 0;
  }
  const lines = raw.split('\n');
  let removed = 0;
  const kept: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as Pick;
      if (parsed.node_id === nodeId) {
        removed += 1;
        continue;
      }
      kept.push(trimmed);
    } catch {
      kept.push(trimmed);
    }
  }
  if (removed === 0) return 0;
  // Atomic-ish: write to a sibling tmp then rename. Concurrent recordPick
  // writes to `file` between the read and rename will be lost (acceptable
  // for a navigation-history store; documented in module header).
  //
  // Suffix = pid + ms + 4 random bytes. pid + ms alone is vulnerable to
  // collision on same-ms invocations across reused pids (modern OSes recycle
  // pid space aggressively); random bytes add 32 bits of entropy and
  // eliminate the race in practice.
  const { writeFile, rename } = await import('node:fs/promises');
  const rand = randomBytes(4).toString('hex');
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}-${rand}`;
  await writeFile(
    tmp,
    kept.length > 0 ? kept.join('\n') + '\n' : '',
    { encoding: 'utf8', mode: 0o600 },
  );
  await rename(tmp, file);
  return removed;
}

export async function readPicks(
  sessionId: string,
  opts: { root?: string } = {},
): Promise<PickIndex> {
  const file = picksFileFor(sessionId, opts.root);
  const index: PickIndex = { modesByNode: new Map(), total: 0 };
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch {
    return index;
  }
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as Pick;
      if (!parsed.node_id || (parsed.mode !== 'continue' && parsed.mode !== 'fork')) {
        continue;
      }
      const set = index.modesByNode.get(parsed.node_id) ?? new Set();
      set.add(parsed.mode);
      index.modesByNode.set(parsed.node_id, set);
      index.total += 1;
    } catch {
      // ignore malformed entries
    }
  }
  return index;
}
