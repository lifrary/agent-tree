/**
 * --search across sessions, shared by the CLI and the MCP tool.
 *
 * Sessions are processed newest first. Stage 1 and 2 (prefilter, then confirm
 * on parsed candidate lines) run a few files ahead in parallel; stage 3 (map to
 * steps) runs one session at a time, since one large session can take most of a
 * GiB, and the search stops once `limit` sessions are found.
 */
import type { ResolvedConfig } from '../cli/pipeline.js';
import { isMissingPath } from '../sources/files.js';
import type { SessionEntry, SessionSourceId } from '../sources/types.js';
import type { Redactor } from '../utils/redact.js';
import { listSessions } from '../utils/session_path.js';
import { mapSession, type MapContext } from './map.js';
import { createMatcher, type Matcher } from './matcher.js';
import { claudeRecordItems, codexRecordItems, fieldsOf, type ProjectionState } from './project.js';
import { scanFile } from './scan.js';
import { matchField } from './snippet.js';
import type { SearchReport, SessionResult } from './types.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_CONCURRENCY = 4;
const SHORT_ID_LENGTH = 8;

export interface SearchOptions {
  query: string;
  sources: SessionSourceId[];
  /** Limit to one project; undefined searches every project. */
  projectCwd?: string;
  sinceDays?: number;
  limit: number;
  includeToolOutput: boolean;
  redactor: Redactor;
  config: ResolvedConfig;
  /** Directory for configuration-relative paths in the pipeline. */
  cwd: string;
  concurrency?: number;
  chunkBytes?: number;
  now?: () => number;
  onProgress?: (progress: SearchProgress) => void;
}

export interface SearchProgress {
  scanned: number;
  total: number;
  matched: number;
}

export interface SearchOutcome {
  report: SearchReport;
  matcher: Matcher;
  /** The shortest session id prefix `--snapshot` resolves unambiguously, per result. */
  commandId(result: SessionResult): string;
}

type Scan = { found: boolean } | { error: unknown };

export async function searchSessions(options: SearchOptions): Promise<SearchOutcome> {
  const started = performance.now();
  const matcher = createMatcher(options.query);
  const discovered = await discover(options.sources, options.projectCwd);
  const cutoff =
    options.sinceDays === undefined
      ? -Infinity
      : (options.now ?? Date.now)() - options.sinceDays * DAY_MS;
  const entries = discovered.filter((entry) => entry.mtimeMs >= cutoff);
  const mapContext: MapContext = {
    matcher,
    redactor: options.redactor,
    includeToolOutput: options.includeToolOutput,
    config: options.config,
    cwd: options.cwd,
  };

  const controller = new AbortController();
  const scans: Array<Promise<Scan> | undefined> = [];
  const scan = (entry: SessionEntry): Promise<Scan> =>
    confirmSession(entry, matcher, options, controller.signal).then(
      (found) => ({ found }),
      (error: unknown) => ({ error }),
    );
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
  const results: SessionResult[] = [];
  let launched = 0;
  let scannedSessions = 0;
  let scannedBytes = 0;
  let stoppedEarly = false;
  try {
    for (let i = 0; i < entries.length; i++) {
      while (launched < entries.length && launched < i + concurrency) {
        scans[launched] = scan(entries[launched]);
        launched += 1;
      }
      const outcome = await scans[i];
      scans[i] = undefined;
      if (outcome && 'error' in outcome) throw outcome.error;
      scannedSessions += 1;
      scannedBytes += entries[i].sizeBytes;
      if (outcome?.found) {
        const result = await mapSession(entries[i], mapContext).catch((error: unknown) => {
          if (isMissingPath(error)) return null; // rotated away since discovery
          throw error;
        });
        if (result) results.push(result);
      }
      options.onProgress?.({ scanned: i + 1, total: entries.length, matched: results.length });
      if (results.length >= options.limit) {
        stoppedEarly = i + 1 < entries.length;
        break;
      }
    }
  } finally {
    controller.abort();
    await Promise.all(scans.filter((pending) => pending !== undefined));
  }

  const report: SearchReport = {
    query: options.redactor.apply(options.query),
    case_sensitive: matcher.caseSensitive,
    scope: {
      sources: [...options.sources],
      project: options.projectCwd ?? null,
      since_days: options.sinceDays ?? null,
      include_tool_output: options.includeToolOutput,
    },
    scanned: {
      sessions: scannedSessions,
      bytes: scannedBytes,
      seconds: Math.round((performance.now() - started) / 100) / 10,
      stopped_early: stoppedEarly,
    },
    total_sessions: results.length,
    results,
  };
  // Prefixes are only provably unique against every session of the source.
  const known = options.projectCwd === undefined ? discovered : null;
  return { report, matcher, commandId: (result) => shortestUniqueId(result, known) };
}

async function discover(
  sources: SessionSourceId[],
  projectCwd: string | undefined,
): Promise<SessionEntry[]> {
  const lists = await Promise.all(sources.map((source) => listSessions({ source, projectCwd })));
  return lists
    .flat()
    .sort(
      (a, b) =>
        b.mtimeMs - a.mtimeMs ||
        (a.jsonlPath < b.jsonlPath ? -1 : a.jsonlPath > b.jsonlPath ? 1 : 0),
    );
}

/** Stage 1 and 2: does any candidate line hold a match in a searchable field? */
async function confirmSession(
  entry: SessionEntry,
  matcher: Matcher,
  options: SearchOptions,
  signal: AbortSignal,
): Promise<boolean> {
  const state: ProjectionState = {
    includeToolOutput: options.includeToolOutput,
    searchCalls: new Set(),
  };
  const items = entry.source === 'claude' ? claudeRecordItems : codexRecordItems;
  let found = false;
  try {
    await scanFile(
      entry.jsonlPath,
      matcher,
      (line) => {
        const record = parseRecord(line);
        if (!record) return true; // the reader skips malformed lines too
        found = fieldsOf(items(record), state).some((field) =>
          matchField(field, matcher, options.redactor),
        );
        return !found;
      },
      { chunkBytes: options.chunkBytes, signal },
    );
  } catch (error) {
    if (isMissingPath(error)) return false; // rotated away since discovery
    throw error;
  }
  return found;
}

function parseRecord(line: string): Record<string, unknown> | null {
  try {
    const record: unknown = JSON.parse(line);
    return typeof record === 'object' && record !== null && !Array.isArray(record)
      ? (record as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function shortestUniqueId(result: SessionResult, known: SessionEntry[] | null): string {
  const id = result.session_id;
  if (!known) return id;
  const others = known
    .filter((entry) => entry.source === result.source && entry.sessionId !== id)
    .map((entry) => entry.sessionId.toLowerCase());
  for (let length = SHORT_ID_LENGTH; length < id.length; length++) {
    const prefix = id.slice(0, length).toLowerCase();
    if (!others.some((other) => other.startsWith(prefix))) return id.slice(0, length);
  }
  return id;
}
