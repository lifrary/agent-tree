import { createHash } from 'node:crypto';
import { constants, type Stats } from 'node:fs';
import { open } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { readCodex } from '../reader/codex.js';
import { codexSource, nativeCodexEntry } from '../sources/codex.js';
import { isSameDirectory, lstatIfPresent } from '../sources/files.js';
import { findSpawnEvent } from '../sources/relations.js';
import type { ReadSessionResult, SessionEntry, UsageSample } from '../sources/types.js';
import type { RawEvent } from '../types.js';
import type { Logger } from '../utils/logger.js';
import type { SubagentUsageAt } from './types.js';

interface Descendant {
  entry: SessionEntry;
  parentId: string;
}

/** A portable export must never discover children from the host's native catalog. */
async function nativeFamily(jsonlPath: string): Promise<{
  root: SessionEntry;
  descendants: Descendant[];
} | null> {
  const root = await nativeCodexEntry(jsonlPath);
  if (!root) return null;
  const entries = await codexSource.discover({ includeSubagents: true, includeArchived: true });
  const children = new Map<string, SessionEntry[]>();
  for (const entry of entries) {
    const parent = entry.subagent?.parentSessionId?.toLowerCase();
    if (!parent) continue;
    const siblings = children.get(parent) ?? [];
    siblings.push(entry);
    children.set(parent, siblings);
  }
  const descendants: Descendant[] = [];
  const queue = [root.sessionId.toLowerCase()];
  const seen = new Set(queue);
  for (let at = 0; at < queue.length; at += 1) {
    const parentId = queue[at];
    for (const entry of children.get(parentId) ?? []) {
      const id = entry.sessionId.toLowerCase();
      if (seen.has(id)) continue;
      seen.add(id);
      queue.push(id);
      descendants.push({ entry, parentId });
    }
  }
  return { root, descendants };
}

/** Includes archived descendants and ancestry, not just the unchanged parent file. */
export async function codexSubagentSignature(jsonlPath: string): Promise<string> {
  try {
    const family = await nativeFamily(jsonlPath);
    if (!family || family.descendants.length === 0) return '';
    const hash = createHash('sha256');
    for (const { entry, parentId } of family.descendants.sort((a, b) =>
      a.entry.sessionId.localeCompare(b.entry.sessionId),
    )) {
      const info = await lstatIfPresent(entry.jsonlPath);
      if (!info?.isFile()) continue;
      hash.update(
        JSON.stringify([
          entry.sessionId,
          parentId,
          entry.subagent,
          entry.archived === true,
          entry.jsonlPath,
          info.size,
          info.mtimeMs,
          info.ctimeMs,
          info.dev,
          info.ino,
        ]),
      );
    }
    return hash.digest('hex');
  } catch {
    return 'unreadable';
  }
}

interface AgentState {
  parentId: string | null;
  events: RawEvent[];
  eventUuid: string | null;
  sampleKeys: Set<string>;
}

/**
 * Only metadata-proven descendants are counted. A missing spawn link anywhere
 * along a nested chain leaves its usage explicitly at session level.
 */
export async function readCodexSubagents(
  jsonlPath: string,
  events: RawEvent[],
  samples: UsageSample[],
  logger?: Logger,
): Promise<SubagentUsageAt[] | undefined> {
  let family: Awaited<ReturnType<typeof nativeFamily>>;
  try {
    family = await nativeFamily(jsonlPath);
  } catch {
    logger?.debug('skipped unreadable Codex subagent discovery');
    return undefined;
  }
  if (!family || family.descendants.length === 0) return undefined;
  const rootId = family.root.sessionId.toLowerCase();
  const states = new Map<string, AgentState>([
    [
      rootId,
      {
        parentId: null,
        events,
        eventUuid: null,
        sampleKeys: sampleKeys(samples),
      },
    ],
  ]);
  const seenResponses = new Set(
    samples.flatMap((sample) => (sample.response_id ? [sample.response_id] : [])),
  );
  const agents: SubagentUsageAt[] = [];
  for (const { entry, parentId } of family.descendants) {
    const id = entry.sessionId.toLowerCase();
    let result: ReadSessionResult | null = null;
    try {
      result = await readEntry(entry);
    } catch {
      // Never log source text, paths, or exception messages for optional usage.
      logger?.debug('skipped an unreadable Codex subagent transcript');
    }
    const parent = states.get(parentId)!;
    const spawn = findSpawnEvent(parent.events, entry);
    const eventUuid = spawn === null ? null : parentId === rootId ? spawn : parent.eventUuid;
    const ownSamples = result?.usage ?? [];
    const state: AgentState = {
      parentId,
      events: result?.events ?? [],
      eventUuid,
      sampleKeys: new Set(),
    };
    states.set(id, state);
    if (ownSamples.length === 0) continue;
    const cutoff = Date.parse(entry.subagent?.createdAt ?? '');
    const totals = { calls: 0, prompt_tokens: 0, output_tokens: 0 };
    for (const sample of ownSamples) {
      if (sample.thread_id && sample.thread_id.toLowerCase() !== id) continue;
      if (sample.response_id && seenResponses.has(sample.response_id)) continue;
      // Inherited token_count history retains its old timestamps. Never use
      // cumulative-total subtraction or token counts alone to invent a delta.
      if (!sample.thread_id && Number.isFinite(cutoff) && Date.parse(sample.timestamp) < cutoff)
        continue;
      if (!sample.response_id && !sample.thread_id && inheritedSample(sample, parentId, states))
        continue;
      if (sample.response_id) seenResponses.add(sample.response_id);
      const key = sampleKey(sample);
      if (key !== null) state.sampleKeys.add(key);
      totals.calls += 1;
      totals.prompt_tokens += sample.prompt_tokens;
      totals.output_tokens += sample.output_tokens;
    }
    agents.push({ agentId: entry.subagent!.id, eventUuid, ...totals });
  }
  return agents.length > 0 ? agents : undefined;
}

/** Open once without following links or blocking on a replaced FIFO. */
async function readEntry(entry: SessionEntry): Promise<ReadSessionResult | null> {
  const home = resolve(process.env.CODEX_HOME || join(homedir(), '.codex'));
  const directories: Array<{ path: string; info: Stats }> = [];
  let directory = dirname(entry.jsonlPath);
  while (directory === home || directory.startsWith(`${home}${sep}`)) {
    const info = await lstatIfPresent(directory);
    if (!info?.isDirectory()) return null;
    directories.push({ path: directory, info });
    if (directory === home) break;
    directory = dirname(directory);
  }
  const original = await lstatIfPresent(entry.jsonlPath);
  if (!original?.isFile()) return null;
  const handle = await open(
    entry.jsonlPath,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.dev !== original.dev || info.ino !== original.ino) return null;
    const result = await readCodex(entry.jsonlPath, { fd: handle.fd });
    const current = await lstatIfPresent(entry.jsonlPath);
    if (!current?.isFile() || current.dev !== info.dev || current.ino !== info.ino) return null;
    if (
      !(await Promise.all(directories.map(({ path, info }) => isSameDirectory(path, info)))).every(
        Boolean,
      )
    )
      return null;
    return result.meta.sessionId.toLowerCase() === entry.sessionId.toLowerCase() ? result : null;
  } finally {
    await handle.close().catch(() => undefined);
  }
}

function sampleKey(sample: UsageSample): string | null {
  const timestamp = Date.parse(sample.timestamp);
  if (!Number.isFinite(timestamp)) return null;
  return JSON.stringify([
    timestamp,
    sample.prompt_tokens,
    sample.cache_read_tokens,
    sample.cache_write_tokens,
    sample.output_tokens,
    sample.reasoning_tokens,
  ]);
}

function sampleKeys(samples: UsageSample[]): Set<string> {
  return new Set(
    samples.flatMap((sample) => {
      const key = sampleKey(sample);
      return key === null ? [] : [key];
    }),
  );
}

function inheritedSample(
  sample: UsageSample,
  parentId: string,
  states: Map<string, AgentState>,
): boolean {
  const key = sampleKey(sample);
  if (key === null) return false;
  let ancestor = states.get(parentId);
  while (ancestor) {
    if (ancestor.sampleKeys.has(key)) return true;
    ancestor = ancestor.parentId === null ? undefined : states.get(ancestor.parentId);
  }
  return false;
}
