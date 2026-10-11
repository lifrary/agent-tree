/**
 * Stage 3 of --search: run the regular analysis pipeline (no LLM) on a session
 * with a confirmed match and report the matching events by display step, the
 * numbers `--snapshot` accepts.
 */
import { runPipeline, type ResolvedConfig } from '../cli/pipeline.js';
import type { RawEvent } from '../types.js';
import type { SessionEntry, SessionSourceId } from '../sources/types.js';
import { findSpawnEvent } from '../sources/relations.js';
import { isMissingPath } from '../sources/files.js';
import { listSessions } from '../utils/session_path.js';
import { buildStepIndex } from '../tree/steps.js';
import { createLoggerSync } from '../utils/logger.js';
import type { Redactor } from '../utils/redact.js';
import type { Matcher } from './matcher.js';
import { eventItems, fieldsOf } from './project.js';
import { matchField } from './snippet.js';
import type { SearchHit, SessionResult } from './types.js';

export const MAX_HITS_PER_SESSION = 10;

// Malformed-line warnings from hundreds of sessions are not search output.
const quietLogger = createLoggerSync('error');

export interface MapContext {
  matcher: Matcher;
  redactor: Redactor;
  includeToolOutput: boolean;
  config: ResolvedConfig;
  /** Directory for configuration-relative paths; the pipeline needs one. */
  cwd: string;
  entries?: SessionEntry[];
  relatedEntries?: Map<SessionSourceId, Promise<SessionEntry[]>>;
}

/** The session's matching steps, or null when no event in the tree matches. */
export async function mapSession(
  entry: SessionEntry,
  ctx: MapContext,
): Promise<SessionResult | null> {
  const { source, sessionId, projectDir, jsonlPath } = entry;
  const result = await runPipeline({
    match: { source, sessionId, projectDir, jsonlPath },
    opts: { llm: false, cwd: ctx.cwd },
    config: ctx.config,
    logger: quietLogger,
    quiet: true,
    usage: false,
  });
  if (result.isEmpty) return null;
  const steps = buildStepIndex(result.mindmap);
  const state = { includeToolOutput: ctx.includeToolOutput, searchCalls: new Set<string>() };
  const byStep = new Map<number, SearchHit>();
  for (const event of result.graph.events) {
    const items = eventItems(event as unknown as Record<string, unknown>);
    for (const field of fieldsOf(items, state)) {
      const match = matchField(field, ctx.matcher, ctx.redactor);
      if (!match) continue;
      const step = steps.stepOfEvent(event.uuid);
      if (step === undefined) continue;
      const hit = byStep.get(step);
      if (hit) {
        hit.matches_in_step += 1;
        continue;
      }
      byStep.set(step, {
        step,
        node_id: steps.nodeOfStep(step)?.id ?? '',
        field: match.field,
        timestamp: event.timestamp,
        snippet: match.snippet,
        matches_in_step: 1,
      });
    }
  }
  if (byStep.size === 0) return null;
  const hits = [...byStep.values()].sort((a, b) => a.step - b.step);
  return {
    source,
    session_id: ctx.redactor.apply(sessionId),
    project_dir: ctx.redactor.apply(
      source === 'claude' ? (firstCwd(result.graph.events) ?? projectDir) : projectDir,
    ),
    mtime: new Date(entry.mtimeMs).toISOString(),
    hits: hits.slice(0, MAX_HITS_PER_SESSION),
    more_hits: Math.max(0, hits.length - MAX_HITS_PER_SESSION),
    ...(entry.archived || entry.subagent ? { file: ctx.redactor.apply(jsonlPath) } : {}),
    ...(entry.archived ? { archived: true } : {}),
    ...(entry.subagent ? { subagent: await parentLink(entry, ctx) } : {}),
  };
}

async function parentLink(
  entry: SessionEntry,
  ctx: MapContext,
): Promise<NonNullable<SessionResult['subagent']>> {
  const child = entry.subagent!;
  const findParent = (entries: SessionEntry[]) =>
    child.parentAgentId
      ? entries.find(
          (candidate) =>
            candidate.jsonlPath !== entry.jsonlPath &&
            candidate.source === entry.source &&
            candidate.subagent?.id === child.parentAgentId &&
            candidate.subagent?.parentSessionId === child.parentSessionId,
        )
      : entries.find(
          (candidate) =>
            candidate.source === entry.source &&
            candidate.sessionId.toLowerCase() === child.parentSessionId?.toLowerCase() &&
            candidate.jsonlPath !== entry.jsonlPath,
        );
  let parent = findParent(ctx.entries ?? []);
  let step: number | null = null;
  try {
    if (!parent && child.parentSessionId) {
      // A child can change cwd. Project filtering must not erase its provenance.
      const cache = (ctx.relatedEntries ??= new Map());
      let entries = cache.get(entry.source);
      if (!entries) {
        entries = listSessions({
          source: entry.source,
          includeSubagents: true,
          includeArchived: true,
        });
        cache.set(entry.source, entries);
      }
      parent = findParent(await entries);
    }
    if (parent) {
      const result = await runPipeline({
        match: parent,
        opts: { llm: false, cwd: ctx.cwd, dryRun: true },
        config: ctx.config,
        logger: quietLogger,
        quiet: true,
        usage: false,
      });
      const event = findSpawnEvent(result.graph.events, entry);
      if (event) step = buildStepIndex(result.mindmap).stepOfEvent(event) ?? null;
    }
  } catch (error) {
    if (
      !isMissingPath(error) &&
      !['EACCES', 'EPERM', 'ESTALE'].includes((error as NodeJS.ErrnoException | null)?.code ?? '')
    )
      throw error;
  }
  return {
    id: ctx.redactor.apply(child.id),
    parent_session_id: parent
      ? ctx.redactor.apply(parent.sessionId)
      : child.parentSessionId === null
        ? null
        : ctx.redactor.apply(child.parentSessionId),
    parent_file: parent ? ctx.redactor.apply(parent.jsonlPath) : null,
    parent_step: step,
  };
}

/** Claude's project folder name is a lossy encoding; the events carry the real cwd. */
function firstCwd(events: RawEvent[]): string | undefined {
  return events.find((event) => event.cwd)?.cwd;
}
