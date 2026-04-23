/**
 * Topic segmentation — SPEC §7.2
 *
 * Boundary signals (any-of, OR):
 *   1. gap_before_ms > GAP_MS (default 5 min)
 *   2. file-set Jaccard ≤ FILE_JACCARD_THRESHOLD (default 0.3)
 *   3. user message contains topic-shift phrase (ko/en; see signals.ts)
 *   4. slash-command invocation (user turn starting with `/`)
 *   5. isSidechain transition (main ↔ sidechain)
 *   6. turn count within current segment > TURN_FORCE_SPLIT (default 30)
 *
 * The first event always opens seg_001 (no gap_before, no prior files — so
 * boundary_reasons is an empty array for segment 0).
 */

import type { BoundarySignal, RawEvent, TopicSegment } from '../types.js';

import { extractSignals, jaccard, type EventSignals } from './signals.js';

export interface SegmentOptions {
  gapMs?: number;
  fileJaccardThreshold?: number;
  turnForceSplit?: number;
  includeSidechains?: boolean; // include | flatten | drop — only `include` for M1
  sidechainHandling?: 'include' | 'flatten' | 'drop';
}

const DEFAULTS: Required<
  Pick<
    SegmentOptions,
    'gapMs' | 'fileJaccardThreshold' | 'turnForceSplit' | 'sidechainHandling'
  >
> = {
  gapMs: 5 * 60 * 1000,
  fileJaccardThreshold: 0.3,
  turnForceSplit: 30,
  sidechainHandling: 'include',
};

interface WorkingSegment {
  start_index: number;
  end_index: number;
  event_uuids: string[];
  files: Map<string, number>; // path → count
  tools: Map<string, number>;
  is_sidechain_only: boolean;
  time_start: string;
  time_end: string;
  gap_before_ms: number;
  turns: number;
  boundary_reasons: BoundarySignal[];
}

export function detectSegments(
  events: RawEvent[],
  opts: SegmentOptions = {},
): TopicSegment[] {
  const {
    gapMs,
    fileJaccardThreshold,
    turnForceSplit,
    sidechainHandling,
  } = { ...DEFAULTS, ...opts };

  const filtered = filterBySidechainMode(events, sidechainHandling);
  if (filtered.length === 0) return [];

  const signals = extractSignals(filtered);
  const segments: WorkingSegment[] = [];
  let current: WorkingSegment | null = null;
  let prevSignals: EventSignals | null = null;

  for (let i = 0; i < filtered.length; i += 1) {
    const sig = signals[i];

    const reasons = current
      ? detectBoundary(current, sig, prevSignals, {
          gapMs,
          fileJaccardThreshold,
          turnForceSplit,
        })
      : [];

    if (!current || reasons.length > 0) {
      if (current) segments.push(current);
      const gapBefore = computeGap(prevSignals, sig);
      current = startSegment(sig, reasons, gapBefore);
    }
    extendSegment(current, sig, filtered[i]);
    prevSignals = sig;
  }

  if (current) segments.push(current);

  // Post-process: merge "micro" segments (≤1 event) into the next segment.
  // These are usually isolated system attachments / hook output that boundary
  // signals over-segmented; keeping them separate adds visual noise without
  // user-meaningful information. Sidechain-transition boundaries are not
  // collapsed (they're a real semantic break).
  const merged = mergeMicroSegments(segments);
  return merged.map((w, idx) => finalize(w, idx));
}

function mergeMicroSegments(segments: WorkingSegment[]): WorkingSegment[] {
  if (segments.length <= 1) return segments;
  const out: WorkingSegment[] = [];
  let pending: WorkingSegment | null = null;
  for (const seg of segments) {
    if (pending) {
      // Merge pending micro into the start of this segment.
      seg.event_uuids = [...pending.event_uuids, ...seg.event_uuids];
      seg.start_index = pending.start_index;
      for (const [k, v] of pending.files) {
        seg.files.set(k, (seg.files.get(k) ?? 0) + v);
      }
      for (const [k, v] of pending.tools) {
        seg.tools.set(k, (seg.tools.get(k) ?? 0) + v);
      }
      seg.is_sidechain_only = seg.is_sidechain_only && pending.is_sidechain_only;
      seg.time_start = pending.time_start || seg.time_start;
      seg.gap_before_ms = pending.gap_before_ms;
      seg.turns += pending.turns;
      pending = null;
    }
    const isMicro =
      seg.event_uuids.length <= 1 &&
      !seg.boundary_reasons.includes('sidechain_transition');
    if (isMicro) {
      pending = seg;
    } else {
      out.push(seg);
    }
  }
  if (pending) out.push(pending); // tail micro: nothing to merge into
  return out;
}

function filterBySidechainMode(
  events: RawEvent[],
  mode: 'include' | 'flatten' | 'drop',
): RawEvent[] {
  switch (mode) {
    case 'drop':
      return events.filter((e) => !e.isSidechain);
    case 'flatten':
    case 'include':
    default:
      return events;
  }
}

function detectBoundary(
  current: WorkingSegment,
  sig: EventSignals,
  prev: EventSignals | null,
  opts: {
    gapMs: number;
    fileJaccardThreshold: number;
    turnForceSplit: number;
  },
): BoundarySignal[] {
  const reasons: BoundarySignal[] = [];

  // 1. Gap — use prior signal's timestamp as the cutoff
  if (prev && Number.isFinite(sig.timestamp) && Number.isFinite(prev.timestamp)) {
    if (sig.timestamp - prev.timestamp > opts.gapMs) reasons.push('gap');
  }

  // 2. File-set shift — compare current segment's files to this event's files.
  //    Only meaningful when both sides have at least one file.
  if (current.files.size > 0 && sig.files.length > 0) {
    const a = new Set(current.files.keys());
    const b = new Set(sig.files);
    const j = jaccard(a, b);
    if (j <= opts.fileJaccardThreshold) reasons.push('file_shift');
  }

  // 3. Topic-shift phrase
  if (sig.hasTopicShiftPhrase) reasons.push('topic_shift_phrase');

  // 4. Slash-command invocation
  if (sig.slashCommand) reasons.push('slash_command');

  // 5. Sidechain transition
  if (prev && prev.isSidechain !== sig.isSidechain) {
    reasons.push('sidechain_transition');
  }

  // 6. Force split when a single segment exceeds the turn cap
  if (current.turns >= opts.turnForceSplit) reasons.push('turn_force_split');

  return reasons;
}

function startSegment(
  sig: EventSignals,
  reasons: BoundarySignal[],
  gapBeforeMs: number,
): WorkingSegment {
  return {
    start_index: sig.index,
    end_index: sig.index,
    event_uuids: [],
    files: new Map(),
    tools: new Map(),
    is_sidechain_only: true,
    time_start: '',
    time_end: '',
    gap_before_ms: gapBeforeMs,
    turns: 0,
    boundary_reasons: reasons,
  };
}

function computeGap(prev: EventSignals | null, cur: EventSignals): number {
  if (!prev) return 0;
  if (!Number.isFinite(prev.timestamp) || !Number.isFinite(cur.timestamp)) {
    return 0;
  }
  const diff = cur.timestamp - prev.timestamp;
  return diff > 0 ? diff : 0;
}

function extendSegment(
  seg: WorkingSegment,
  sig: EventSignals,
  ev: RawEvent,
): void {
  seg.end_index = sig.index;
  seg.event_uuids.push(sig.uuid);
  for (const f of sig.files) seg.files.set(f, (seg.files.get(f) ?? 0) + 1);
  for (const t of sig.tools) seg.tools.set(t, (seg.tools.get(t) ?? 0) + 1);
  if (!ev.isSidechain) seg.is_sidechain_only = false;
  if (!seg.time_start) seg.time_start = ev.timestamp;
  if (ev.timestamp) seg.time_end = ev.timestamp;
  if (sig.isTurn) seg.turns += 1;
}

function finalize(w: WorkingSegment, idx: number): TopicSegment {
  const dominantFiles = topN(w.files, 5);
  const dominantTools = topN(w.tools, 5);
  return {
    id: `seg_${String(idx + 1).padStart(3, '0')}`,
    start_index: w.start_index,
    end_index: w.end_index,
    event_uuids: w.event_uuids,
    dominant_files: dominantFiles,
    dominant_tools: dominantTools,
    is_sidechain_only: w.is_sidechain_only,
    time_range: [w.time_start || '', w.time_end || ''],
    gap_before_ms: w.gap_before_ms,
    boundary_reasons: w.boundary_reasons,
  };
}

function topN(counts: Map<string, number>, n: number): string[] {
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k]) => k);
}
