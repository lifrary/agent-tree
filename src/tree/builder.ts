/**
 * MindMap builder — SPEC §7.4 (M2 heuristic slice)
 *
 * Shape: 2-depth mindmap
 *   root
 *   ├── topic segments (main session)
 *   └── 🔀 Sidechains branch (when at least one sidechain-only segment exists)
 *        └── sidechain topic segments
 *
 * Labels are heuristic (top dominant file + primary tool). M3 overlays
 * LLM-derived `label` / `summary` / `type` / `color` without changing the
 * traversal shape.
 *
 * Node IDs are assigned in DFS pre-order: n_001 = root, n_002 = first topic…
 */

import type {
  ContextSnapshot,
  MindMap,
  MindMapNode,
  NodeType,
  RawEvent,
  SessionGraph,
  TopicSegment,
} from '../types.js';
import type { Redactor } from '../utils/redact.js';

import {
  buildContinueSnapshot,
  buildForkSnapshot,
} from './context_snapshot.js';

export interface BuildMindMapOptions {
  jsonlPath: string;
  specVersion: string; // e.g. 'v0.3'
  generatedAt?: string; // ISO-8601; defaults to now
  collapseDepth?: number; // for payload.fold hint; used by render layer
  sessionTitle?: string | null; // override root label
  /**
   * Redactor applied to user-authored text BEFORE truncation. Render-stage
   * `redactDeep` can't catch secrets sliced below the regex's minimum length,
   * so this is the correct chokepoint for the text pulled out of `events`.
   */
  redactor?: Redactor;
}

export function buildMindMap(
  graph: SessionGraph,
  segments: TopicSegment[],
  opts: BuildMindMapOptions,
): MindMap {
  const generatedAt = opts.generatedAt ?? new Date().toISOString();
  const sessionId = graph.meta.sessionId;

  // Split segments into main + sidechain-only
  const main: TopicSegment[] = [];
  const sidechain: TopicSegment[] = [];
  for (const s of segments) {
    (s.is_sidechain_only ? sidechain : main).push(s);
  }

  const sessionStartMs = (() => {
    for (const e of graph.events) {
      const ts = Date.parse(e.timestamp);
      if (Number.isFinite(ts)) return ts;
    }
    return NaN;
  })();
  const offsetFor = (iso: string): number | undefined => {
    if (!Number.isFinite(sessionStartMs)) return undefined;
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return undefined;
    return Math.max(0, t - sessionStartMs);
  };

  const idAllocator = new IdAllocator();
  const rootId = idAllocator.next();
  const rootLabel = deriveSessionTitle(
    graph.events,
    sessionId,
    opts.sessionTitle,
    opts.redactor,
  );

  // For the root node, the meaningful "instruction" is the FIRST user turn
  // (the original ask), not the last. We anchor it as a single-element array
  // so the snapshot factory's last-user-text walker finds exactly that one.
  const firstUserEvent = graph.events.find((e) => e.type === 'user');
  const rootInstructionEvents = firstUserEvent ? [firstUserEvent] : [];

  const rootSnapInput = {
    sessionId,
    jsonlPath: opts.jsonlPath,
    nodeId: rootId,
    label: rootLabel,
    segment: null,
    generatedAt,
    events: rootInstructionEvents,
    redactor: opts.redactor,
  };

  const rootNode: MindMapNode = {
    id: rootId,
    type: 'root',
    label: rootLabel,
    summary: `Session ${shortId(sessionId)} — ${graph.events.length} events, ${segments.length} segments`,
    index_range: [0, Math.max(0, graph.events.length - 1)],
    event_uuids: graph.events.map((e) => e.uuid),
    files_touched: uniq(segments.flatMap((s) => s.dominant_files)),
    tools_used: uniq(segments.flatMap((s) => s.dominant_tools)),
    is_sidechain: false,
    children: [],
    context_snapshot_continue: buildContinueSnapshot(rootSnapInput),
    context_snapshot_fork: buildForkSnapshot(rootSnapInput),
    color: 'green',
    shape: 'rect',
    time_offset_ms: 0,
  };

  // ---------------------------------------------------------------------
  // Phase grouping — turn the flat segment list into a 2-level tree where
  // each "phase" is anchored by a significant user prompt and contains the
  // sub-actions (file edits, tool calls) that flowed from it.
  //
  //   📌 phase  = user prompt (≥ 10 chars, not system noise)
  //     ├─ 🔧 action = subsequent segment until the next phase opens
  //     └─ 🔧 action
  //
  // This is what makes the tree directly readable like a `tree`-command
  // file layout — the user can scan "what did I ask?" → "what happened?"
  // ---------------------------------------------------------------------
  const phases = groupSegmentsIntoPhases(main, graph.events);
  for (const phase of phases) {
    const phaseEvents = graph.events.slice(
      phase.headSegment.start_index,
      phase.headSegment.end_index + 1,
    );
    const phaseNode = buildSegmentNode(phase.headSegment, {
      idAllocator,
      sessionId,
      jsonlPath: opts.jsonlPath,
      generatedAt,
      parentIsSidechain: false,
      events: phaseEvents,
      redactor: opts.redactor,
      timeOffsetMs: offsetFor(phase.headSegment.time_range[0]),
      promotePhaseIcon: true,
    });
    for (const childSeg of phase.children) {
      phaseNode.children.push(
        buildSegmentNode(childSeg, {
          idAllocator,
          sessionId,
          jsonlPath: opts.jsonlPath,
          generatedAt,
          parentIsSidechain: false,
          events: graph.events.slice(childSeg.start_index, childSeg.end_index + 1),
          redactor: opts.redactor,
          timeOffsetMs: offsetFor(childSeg.time_range[0]),
        }),
      );
    }
    // Annotate the phase head with summary metadata so the renderer can show
    // `(7 actions · 3 files · 11min)` next to the user prompt.
    phaseNode.phase_meta = computePhaseMeta(phase, graph.events);
    rootNode.children.push(phaseNode);
  }

  // Sidechain bucket
  if (sidechain.length > 0) {
    const bucketId = idAllocator.next();
    const bucketLabel = '🔀 Sidechains';
    const bucketNode: MindMapNode = {
      id: bucketId,
      type: 'topic',
      label: bucketLabel,
      summary: `${sidechain.length} sidechain segment${sidechain.length === 1 ? '' : 's'} spawned by subagents`,
      index_range: coverageRange(sidechain),
      event_uuids: sidechain.flatMap((s) => s.event_uuids),
      files_touched: uniq(sidechain.flatMap((s) => s.dominant_files)),
      tools_used: uniq(sidechain.flatMap((s) => s.dominant_tools)),
      is_sidechain: true,
      children: [],
      context_snapshot_continue: buildContinueSnapshot({
        sessionId,
        jsonlPath: opts.jsonlPath,
        nodeId: bucketId,
        label: bucketLabel,
        segment: null,
        generatedAt,
      }),
      context_snapshot_fork: buildForkSnapshot({
        sessionId,
        jsonlPath: opts.jsonlPath,
        nodeId: bucketId,
        label: bucketLabel,
        segment: null,
        generatedAt,
      }),
      color: 'yellow',
      shape: 'rect',
    };
    for (const seg of sidechain) {
      bucketNode.children.push(
        buildSegmentNode(seg, {
          idAllocator,
          sessionId,
          jsonlPath: opts.jsonlPath,
          generatedAt,
          parentIsSidechain: true,
          events: graph.events.slice(seg.start_index, seg.end_index + 1),
          redactor: opts.redactor,
          timeOffsetMs: offsetFor(seg.time_range[0]),
        }),
      );
    }
    rootNode.children.push(bucketNode);
  }

  const durationMinutes = computeDurationMinutes(graph.events);
  const sidechainCount = graph.events.filter((e) => e.isSidechain).length;
  const totalToolCalls = countToolCalls(graph.events);
  const totalTurns = graph.events.filter(
    (e) => e.type === 'user' || e.type === 'assistant',
  ).length;

  return {
    session_id: sessionId,
    project_path: graph.events[0]?.cwd ?? '',
    generated_at: generatedAt,
    spec_version: opts.specVersion,
    root: rootNode,
    stats: {
      total_events: graph.events.length,
      total_turns: totalTurns,
      total_nodes: countNodes(rootNode),
      total_tool_calls: totalToolCalls,
      total_files_touched: uniq(segments.flatMap((s) => s.dominant_files))
        .length,
      duration_minutes: durationMinutes,
      sidechain_count: sidechainCount,
    },
  };
}

interface SegmentNodeCtx {
  idAllocator: IdAllocator;
  sessionId: string;
  jsonlPath: string;
  generatedAt: string;
  parentIsSidechain: boolean;
  events: RawEvent[]; // slice belonging to this segment, for verbatim user-text extraction
  redactor?: Redactor;
  timeOffsetMs?: number;
  /** When true, render this node with the 📌 phase icon instead of 🧩. */
  promotePhaseIcon?: boolean;
}

/**
 * Group consecutive segments into "phases" — each phase is anchored by a
 * segment whose first user turn is a meaningful instruction. Subsequent
 * segments without their own significant user turn become children of the
 * preceding phase. The first segment always opens phase #1 even if its user
 * turn isn't significant (so we never lose events).
 */
interface SegmentPhase {
  headSegment: TopicSegment;
  children: TopicSegment[];
}

function groupSegmentsIntoPhases(
  segments: TopicSegment[],
  events: RawEvent[],
): SegmentPhase[] {
  if (segments.length === 0) return [];
  const phases: SegmentPhase[] = [];
  let current: SegmentPhase | null = null;
  for (const seg of segments) {
    const segEvents = events.slice(seg.start_index, seg.end_index + 1);
    const userText = firstUserMessageText(segEvents);
    const isSignificant =
      !!userText && !looksLikeSystemNoise(userText) && userText.trim().length >= 10;
    if (!current || isSignificant) {
      current = { headSegment: seg, children: [] };
      phases.push(current);
    } else {
      current.children.push(seg);
    }
  }
  return phases;
}

/**
 * Compose a one-line summary for a phase head: action count, distinct files
 * touched, and rough wall-clock duration. Always includes action count;
 * file count and duration are dropped when zero so the label stays terse.
 */
function computePhaseMeta(phase: SegmentPhase, events: RawEvent[]): string {
  const allSegments = [phase.headSegment, ...phase.children];
  const fileSet = new Set<string>();
  for (const s of allSegments) for (const f of s.dominant_files) fileSet.add(f);
  const actionCount = phase.children.length;

  const startMs = Date.parse(phase.headSegment.time_range[0]);
  const lastSeg = allSegments[allSegments.length - 1];
  const endMs = Date.parse(lastSeg.time_range[1] || lastSeg.time_range[0]);
  let durationStr = '';
  if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs) {
    const min = Math.round((endMs - startMs) / 60_000);
    durationStr = min >= 60 ? `${Math.floor(min / 60)}h ${min % 60}m` : `${min}min`;
  }

  void events;
  const parts: string[] = [];
  parts.push(`${actionCount} action${actionCount === 1 ? '' : 's'}`);
  if (fileSet.size > 0) parts.push(`${fileSet.size} file${fileSet.size === 1 ? '' : 's'}`);
  if (durationStr) parts.push(durationStr);
  return parts.join(' · ');
}

function buildSegmentNode(seg: TopicSegment, ctx: SegmentNodeCtx): MindMapNode {
  const id = ctx.idAllocator.next();
  const label = deriveSegmentLabel(seg, ctx.events, ctx.redactor);
  const type: NodeType = 'topic';
  const icon = ctx.promotePhaseIcon ? '📌' : undefined;
  const snapshotInput = {
    sessionId: ctx.sessionId,
    jsonlPath: ctx.jsonlPath,
    nodeId: id,
    label,
    segment: seg,
    generatedAt: ctx.generatedAt,
    events: ctx.events,
    redactor: ctx.redactor,
  };
  const node: MindMapNode = {
    id,
    type,
    label,
    summary: deriveSegmentSummary(seg),
    index_range: [seg.start_index, seg.end_index],
    event_uuids: seg.event_uuids,
    files_touched: seg.dominant_files,
    tools_used: seg.dominant_tools,
    is_sidechain: seg.is_sidechain_only || ctx.parentIsSidechain,
    children: [],
    context_snapshot_continue: buildContinueSnapshot(
      snapshotInput,
    ) as ContextSnapshot,
    context_snapshot_fork: buildForkSnapshot(snapshotInput) as ContextSnapshot,
    color: seg.is_sidechain_only ? 'yellow' : 'green',
    shape: 'rect',
    segment_id: seg.id,
    time_offset_ms: ctx.timeOffsetMs,
    icon,
  };
  return node;
}

// ---------------------------------------------------------------------------
// Heuristic labels & helpers
// ---------------------------------------------------------------------------

/**
 * Build a user-meaningful label for a segment. Priority:
 *   1. First user instruction in the segment (intent — what the user asked for).
 *      This is the most scannable format because it answers "what was I trying
 *      to do here?" without needing to expand the snapshot.
 *   2. Fallback: dominant file + tool. Useful for system-driven segments
 *      (hook output, subagent activity) where there's no user turn.
 *
 * The seg_id is intentionally NOT included — it's available in `summary` and
 * via `--snapshot <id>`, and would crowd out the actual signal.
 */
function deriveSegmentLabel(
  seg: TopicSegment,
  events: RawEvent[],
  redactor?: Redactor,
): string {
  const userText = firstUserMessageText(events);
  // System-generated user turns (`<task-notification>...`, hook stdout, etc.)
  // are not meaningful intent labels — fall through to file/tool heuristics.
  if (userText && !looksLikeSystemNoise(userText)) {
    const cleaned = shortenPaths(userText.replace(/\s+/g, ' ').trim());
    const safe = redactor ? redactor.apply(cleaned) : cleaned;
    return `"${truncate(safe, 56)}"`;
  }

  const topFile = seg.dominant_files[0];
  const topTool = seg.dominant_tools[0];
  const eventCount = seg.event_uuids.length;
  if (topFile && topTool) return truncate(`${basename(topFile)} (${topTool})`, 60);
  if (topFile) return truncate(basename(topFile), 60);
  if (topTool) return truncate(topTool, 60);
  return `${eventCount} events`;
}

/**
 * Heuristic — Claude Code injects user-shaped messages with bracket-tag
 * prefixes (`<task-notification>`, `<system-reminder>`, `<command-name>`,
 * etc.) for hook output. Treat any user text starting with `<` as system
 * noise so it doesn't crowd out real user intent in segment labels.
 */
function looksLikeSystemNoise(text: string): boolean {
  const t = text.trim();
  return t.startsWith('<') || t.startsWith('[SYSTEM');
}

/**
 * Compress noisy absolute paths in user text to just the basename so the
 * actual user intent dominates the label. Conservative: only strips POSIX
 * absolute paths under common roots (`/Users/`, `/home/`, `/root/`, `/tmp/`)
 * — leaves relative paths and short paths untouched.
 */
function shortenPaths(text: string): string {
  return text.replace(
    /(\/(?:Users|home|root|tmp|var)\/[^\s,;:`'"]*)/g,
    (full) => {
      const last = full.lastIndexOf('/');
      return last >= 0 && last < full.length - 1 ? full.slice(last + 1) : full;
    },
  );
}

function deriveSegmentSummary(seg: TopicSegment): string {
  const reasons = seg.boundary_reasons.length
    ? ` (boundary: ${seg.boundary_reasons.join('+')})`
    : '';
  const files = seg.dominant_files.slice(0, 3).join(', ');
  const tools = seg.dominant_tools.slice(0, 3).join(', ');
  return `events ${seg.start_index}–${seg.end_index}${reasons}${
    files ? ` · files: ${files}` : ''
  }${tools ? ` · tools: ${tools}` : ''}`;
}

function deriveSessionTitle(
  events: RawEvent[],
  sessionId: string,
  override?: string | null,
  redactor?: Redactor,
): string {
  if (override) return truncate(override, 60);
  const firstUserText = firstUserMessageText(events);
  if (firstUserText) {
    const cleaned = shortenPaths(firstUserText.replace(/\s+/g, ' '));
    // Redact BEFORE truncating: a sliced secret fragment is shorter than the
    // regex's minimum character class and would slip past the render-stage
    // redactor.
    const safe = redactor ? redactor.apply(cleaned) : cleaned;
    return truncate(safe, 60);
  }
  return `Session ${shortId(sessionId)}`;
}

function firstUserMessageText(events: RawEvent[]): string | null {
  for (const e of events) {
    if (e.type !== 'user') continue;
    const content = (e.message as { content?: unknown } | undefined)?.content;
    if (typeof content === 'string' && content.trim().length > 0) return content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (
        block &&
        typeof block === 'object' &&
        (block as { type?: string }).type === 'text'
      ) {
        const text = (block as { text?: unknown }).text;
        if (typeof text === 'string' && text.trim().length > 0) return text;
      }
    }
  }
  return null;
}

function computeDurationMinutes(events: RawEvent[]): number {
  let earliest = Infinity;
  let latest = -Infinity;
  for (const e of events) {
    const t = Date.parse(e.timestamp);
    if (!Number.isFinite(t)) continue;
    if (t < earliest) earliest = t;
    if (t > latest) latest = t;
  }
  if (!Number.isFinite(earliest) || !Number.isFinite(latest)) return 0;
  return Math.round((latest - earliest) / 60_000);
}

function countToolCalls(events: RawEvent[]): number {
  let n = 0;
  for (const e of events) {
    if (e.type === 'tool_use') n += 1;
    else if (e.type === 'assistant') {
      const content = (e.message as { content?: unknown } | undefined)?.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (
            block &&
            typeof block === 'object' &&
            (block as { type?: string }).type === 'tool_use'
          ) {
            n += 1;
          }
        }
      }
    }
  }
  return n;
}

function countNodes(node: MindMapNode): number {
  let n = 1;
  for (const c of node.children) n += countNodes(c);
  return n;
}

function coverageRange(segs: TopicSegment[]): [number, number] {
  if (segs.length === 0) return [0, 0];
  let lo = Infinity;
  let hi = -Infinity;
  for (const s of segs) {
    if (s.start_index < lo) lo = s.start_index;
    if (s.end_index > hi) hi = s.end_index;
  }
  return [lo, hi];
}

function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

function basename(p: string): string {
  const idx = p.lastIndexOf('/');
  return idx >= 0 ? p.slice(idx + 1) : p;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max - 1)) + '…';
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

class IdAllocator {
  private counter = 0;
  next(): string {
    this.counter += 1;
    return `n_${String(this.counter).padStart(3, '0')}`;
  }
}
