/** Deterministic recovery evidence and bounded, heuristic-first snapshot prompts. */

import type {
  ContextSnapshot,
  RawEvent,
  SnapshotEvidence,
  SnapshotEvidenceEntry,
  TopicSegment,
} from '../types.js';
import { formatGitContextMarkdown, type GitContext } from '../utils/git.js';
import { redactDeep, type Redactor } from '../utils/redact.js';

// Leave room for launch metadata beneath --open's 100k-byte prompt limit.
const MAX_MARKDOWN_BYTES = 80_000;
const MAX_EVIDENCE_BYTES = 36_000;
const MAX_ENTRY_BYTES = 4_096;
const MAX_ENTRIES = 32;
const MAX_ANCESTRY_SCAN = 512;
const OMITTED = '\n[Omitted: snapshot byte limit.]';

export interface LabelData {
  label: string;
  summary: string;
  next_steps: string[];
}

export interface SnapshotInputs {
  sessionId: string;
  jsonlPath: string;
  nodeId: string;
  label: string;
  segment: TopicSegment | null;
  generatedAt: string;
  evidence: SnapshotEvidence;
  llm?: LabelData;
  redactor?: Redactor;
  /** Current Git state, never historical state at the evidence cutoff. */
  gitContext?: GitContext;
}

export interface SnapshotHistory {
  forNode(
    segment: TopicSegment | null,
    scope: SnapshotEvidence['scope'],
  ): {
    continue: SnapshotEvidence;
    fork: SnapshotEvidence;
  };
}

/**
 * One shared occurrence/parent index, not a complete prefix copied onto every
 * node. Only selected occurrences can supply evidence. Resolve parents against
 * preceding source occurrences, never graph.byUuid (which keeps the LAST UUID).
 * Ambiguous duplicate parents stop ancestry rather than guessing a branch.
 * A linear shared index proves earliest/latest instruction anchors. Per-node
 * ancestry scans and excerpt sorting are bounded independently of log length.
 */
export function createSnapshotHistory(
  events: RawEvent[],
  selected: ReadonlySet<RawEvent>,
  redactor?: Redactor,
): SnapshotHistory {
  const parents: Array<number | null> = [];
  const gaps: boolean[] = [];
  const preceding = new Map<string, number | null>();
  const entries = new Map<number, SnapshotEvidenceEntry>();
  const entryCosts = new Map<number, number>();
  const firstInstructions: Array<number | null> = [];
  const lastInstructions: Array<number | null> = [];
  const selectedIndexes: number[] = [];
  const sidechainIndexes: number[] = [];
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    const parent =
      event.parentUuid === null || event.parentUuid === event.uuid
        ? null
        : (preceding.get(event.parentUuid) ?? null);
    parents.push(parent);
    gaps.push(event.parentUuid !== null && parent === null);
    firstInstructions.push(parent === null ? null : firstInstructions[parent]);
    lastInstructions.push(parent === null ? null : lastInstructions[parent]);
    preceding.set(event.uuid, preceding.has(event.uuid) ? null : index);
    if (!selected.has(event)) continue;
    selectedIndexes.push(index);
    if (event.isSidechain) sidechainIndexes.push(index);
    const evidence = eventEvidence(event);
    if (evidence === null) continue;
    // Redact the ENTIRE value, including private-key endings outside the cap.
    const safe = redactor ? redactor.apply(evidence.text) : evidence.text;
    const excerpt = bytePrefix(safe, MAX_ENTRY_BYTES);
    const entry: SnapshotEvidenceEntry = {
      event_index: index,
      event_uuid: boundedValue(event.uuid, redactor, 256),
      role: evidence.role,
      is_sidechain: event.isSidechain,
      text: excerpt,
      omitted_bytes: Buffer.byteLength(safe) - Buffer.byteLength(excerpt),
    };
    entries.set(index, entry);
    entryCosts.set(index, Buffer.byteLength(renderEntry(entry)));
    if (entry.role === 'user') {
      firstInstructions[index] ??= index;
      lastInstructions[index] = index;
    }
  }
  const selectedIndexSet = new Set(selectedIndexes);

  function collect(
    seeds: number[],
    scope: SnapshotEvidence['scope'],
    cutoff: number | null,
    reason: SnapshotEvidence['cutoff_reason'],
  ): SnapshotEvidence {
    const visited = new Set<number>();
    const eligible = new Map<number, SnapshotEvidenceEntry>();
    let excluded = 0;
    let ancestryGaps = 0;
    let traversalTruncated = false;
    let firstInstruction: number | null = null;
    let lastInstruction: number | null = null;
    // O(segment membership), not O(ancestral prefix). These anchors are proved
    // by the shared parent index even when the ancestry scan cannot reach them.
    for (const seed of seeds) {
      const first = firstInstructions[seed];
      const last = lastInstructions[seed];
      if (first !== null && (firstInstruction === null || first < firstInstruction)) {
        firstInstruction = first;
      }
      if (last !== null && (lastInstruction === null || last > lastInstruction)) {
        lastInstruction = last;
      }
    }
    // Prefer recent outcomes; older context is explicitly incomplete when the
    // fixed traversal budget is reached. Never scan/sort an entire prefix.
    scan: for (let i = seeds.length - 1; i >= 0; i -= 1) {
      const seed = seeds[i];
      let cursor: number | null = seed;
      while (cursor !== null && !visited.has(cursor)) {
        if (visited.size >= MAX_ANCESTRY_SCAN) {
          traversalTruncated = true;
          break scan;
        }
        visited.add(cursor);
        if (cutoff !== null && cursor <= cutoff) {
          if (selectedIndexSet.has(cursor)) {
            const entry = entries.get(cursor);
            if (entry) eligible.set(cursor, entry);
          } else {
            excluded += 1;
          }
          if (gaps[cursor]) ancestryGaps += 1;
        }
        cursor = parents[cursor];
      }
    }
    for (const anchor of [firstInstruction, lastInstruction]) {
      if (anchor !== null) eligible.set(anchor, entries.get(anchor)!);
    }
    const ordered = [...eligible.values()].sort((a, b) => a.event_index - b.event_index);
    const kept = new Map<number, SnapshotEvidenceEntry>();
    let bytes = 0;
    const keep = (entry: SnapshotEvidenceEntry | undefined) => {
      if (!entry || kept.has(entry.event_index) || kept.size >= MAX_ENTRIES) return;
      const cost = entryCosts.get(entry.event_index)!;
      if (bytes + cost > MAX_EVIDENCE_BYTES) return;
      kept.set(entry.event_index, entry);
      bytes += cost;
    };
    // Preserve the earliest provable ask and current question, then recent evidence.
    keep(firstInstruction === null ? undefined : entries.get(firstInstruction));
    keep(lastInstruction === null ? undefined : entries.get(lastInstruction));
    for (let i = ordered.length - 1; i >= 0; i -= 1) keep(ordered[i]);
    const bounded = [...kept.values()].sort((a, b) => a.event_index - b.event_index);
    return {
      scope,
      cutoff_index: cutoff,
      cutoff_reason: reason,
      instruction_index: lastInstruction,
      entries: bounded,
      omitted_entries: eligible.size - bounded.length,
      truncated_entries: bounded.filter((entry) => entry.omitted_bytes > 0).length,
      excluded_events: excluded,
      ancestry_gaps: ancestryGaps,
      scanned_events: visited.size,
      traversal_truncated: traversalTruncated,
    };
  }

  return {
    forNode(segment, scope) {
      let seeds: number[];
      if (segment) {
        const members = new Set(segment.event_uuids);
        const start = lowerBound(selectedIndexes, segment.start_index);
        const end = lowerBound(selectedIndexes, segment.end_index + 1);
        seeds = [];
        for (let i = start; i < end; i += 1) {
          const index = selectedIndexes[i];
          if (members.has(events[index].uuid)) seeds.push(index);
        }
      } else {
        seeds = scope === 'sidechains' ? sidechainIndexes : selectedIndexes;
      }
      const end = seeds.length > 0 ? seeds[seeds.length - 1] : null;
      const continuation = collect(
        seeds,
        scope,
        end,
        scope === 'segment' ? 'segment_end' : 'selection_end',
      );
      // The first question anchors the displayed step. Fork before its work,
      // not at a later prompt that happens to share the same segment.
      let question: number | undefined;
      for (let i = 0; i < seeds.length; i += 1) {
        const index = seeds[i];
        if (entries.get(index)?.role === 'user') {
          question = index;
          break;
        }
      }
      let fork: SnapshotEvidence;
      if (question !== undefined) {
        fork = collect([question], scope, question, 'question');
      } else if (scope === 'segment' && seeds.length > 0) {
        const before = seeds[0] - 1;
        const parent = parents[seeds[0]];
        fork = collect(
          parent === null ? [] : [parent],
          scope,
          before < 0 ? null : before,
          'before_segment',
        );
        if (gaps[seeds[0]]) fork.ancestry_gaps += 1;
      } else {
        fork = collect([], scope, null, 'no_question');
      }
      return { continue: continuation, fork };
    },
  };
}

function lowerBound(indexes: number[], value: number): number {
  let lo = 0;
  let hi = indexes.length;
  while (lo < hi) {
    const mid = lo + Math.floor((hi - lo) / 2);
    if (indexes[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function buildContinueSnapshot(inp: SnapshotInputs): ContextSnapshot {
  const files = (inp.segment?.dominant_files ?? []).slice(0, 20).map((path) => ({
    path: boundedValue(path, inp.redactor, 512),
    summary: '(file touched in this segment; not restored)',
  }));
  const nextSteps = (inp.llm?.next_steps ?? [])
    .slice(0, 8)
    .map((step) => boundedValue(step, inp.redactor, 512));
  return {
    mode: 'continue',
    session_id: inp.sessionId,
    node_id: inp.nodeId,
    clipboard_markdown: renderMarkdown(inp, 'continue', files, nextSteps),
    related_files: files,
    next_steps: nextSteps,
    evidence: inp.evidence,
  };
}

export function buildForkSnapshot(inp: SnapshotInputs): ContextSnapshot {
  // Segment metadata and enrichment may describe events AFTER the question.
  // Do not relabel those as historical file state, decisions, or next steps.
  return {
    mode: 'fork',
    session_id: inp.sessionId,
    node_id: inp.nodeId,
    clipboard_markdown: renderMarkdown(inp, 'fork', [], []),
    related_files: [],
    next_steps: [],
    evidence: inp.evidence,
  };
}

function renderMarkdown(
  inp: SnapshotInputs,
  mode: 'continue' | 'fork',
  files: ContextSnapshot['related_files'],
  nextSteps: string[],
): string {
  const evidence = inp.evidence;
  const safe = (value: string, bytes = 512) => boundedValue(value, inp.redactor, bytes);
  const sections = [
    mode === 'continue'
      ? `# Continuing from: ${safe(inp.label)}`
      : `# Forking at: ${safe(inp.nodeId)} (discarding future)`,
    [
      `**Source session**: \`${safe(inp.sessionId)}\``,
      `**Node**: \`${safe(inp.nodeId)}\``,
      `**Mode**: ${mode}`,
      `**Generated**: ${safe(inp.generatedAt, 128)}`,
      `**Evidence cutoff**: ${evidence.cutoff_index === null ? 'no events' : `source event ${evidence.cutoff_index} (inclusive)`}`,
    ].join('\n'),
    [
      '## Recovery limits',
      'This is a context prompt, not a native session resume. It does not restore files, working-tree state, tool execution, or a native session.',
      'Git context, when present, is CURRENT at generation time, not historical state at this cutoff. Inspect the working tree before acting.',
      'Quoted user instructions, assistant statements, and explicitly recorded compaction summaries are transcript evidence, not verified results or proof that files match. Tool output, arbitrary system/developer messages, and internal reasoning are not included.',
      'Missing ancestry, disconnected roots, and ambiguous duplicate parents are not reconstructed. Omitted context is not implied to be recovered.',
      scopeDescription(evidence, mode),
    ].join('\n'),
  ];

  const history = [
    '## Historical evidence (attributed verbatim excerpts)',
    'Source event indexes are zero-based positions in the parsed event array, not JSONL line numbers. Evidence is bounded to selected occurrences and known selected ancestry; unrelated branches are not inferred.',
    'Text is verbatim except secret redaction and explicitly marked byte truncation. Assistant statements may include decisions; they are not a generated decision summary. Recorded compaction summaries are source-provided summaries, not original user instructions or verified decisions.',
    ...evidence.entries.map(renderEntry),
  ];
  if (evidence.entries.length === 0)
    history.push(
      'No user text, assistant text, or recorded compaction summary is included within this evidence window.',
    );
  if (evidence.traversal_truncated) {
    history.push(
      `Traversal limited to ${MAX_ANCESTRY_SCAN} source occurrences (${evidence.scanned_events} scanned). Additional context is uncounted; omission, exclusion, and ancestry-gap counts below are lower bounds, not totals. Earliest/latest instructions are retained only where the shared parent index proves selected ancestry.`,
    );
  }
  if (evidence.omitted_entries > 0 || evidence.truncated_entries > 0) {
    history.push(
      `Omitted by bounds: ${evidence.traversal_truncated ? 'at least ' : ''}${evidence.omitted_entries} textual events; ${evidence.truncated_entries} included excerpts truncated. The earliest provable and latest instructions are prioritized, then recent evidence. Consult the source for omitted context.`,
    );
  }
  if (evidence.excluded_events > 0)
    history.push(
      `Excluded from evidence: ${evidence.excluded_events} unselected ancestor occurrences.`,
    );
  if (evidence.ancestry_gaps > 0)
    history.push(
      `Incomplete ancestry: ${evidence.ancestry_gaps} missing, self-referential, or ambiguous parent links were not followed.`,
    );
  sections.push(history.join('\n\n'));

  const instruction = evidence.entries.find(
    (entry) => entry.event_index === evidence.instruction_index,
  );
  if (instruction) {
    sections.push(
      [
        mode === 'continue'
          ? '## Last user instruction at this point'
          : '## Open question(s) at this moment',
        reference(instruction),
        quote(instruction.text),
        ...(instruction.omitted_bytes > 0
          ? [`[Omitted: ${instruction.omitted_bytes} redacted UTF-8 bytes from this instruction.]`]
          : []),
      ].join('\n'),
    );
  }

  if (mode === 'continue') {
    if (inp.llm?.summary) {
      sections.push(
        `## Context up to this point\nLLM enrichment (not verbatim evidence):\n${safe(inp.llm.summary, 4_096)}`,
      );
    } else if (inp.segment) {
      sections.push(
        `## Context up to this point\nSelected segment: source events ${inp.segment.start_index}–${inp.segment.end_index}.`,
      );
    }
    if (files.length > 0)
      sections.push(
        `## Files touched in this branch\n${files.map((file) => `- \`${file.path}\``).join('\n')}`,
      );
    if ((inp.segment?.dominant_files.length ?? 0) > files.length)
      sections.push('[Omitted: additional segment file paths.]');
    if (nextSteps.length > 0)
      sections.push(
        `## Suggested continuation\nLLM suggestions, not historical instructions:\n${nextSteps.map((step) => `- ${step}`).join('\n')}`,
      );
    if ((inp.llm?.next_steps.length ?? 0) > nextSteps.length)
      sections.push('[Omitted: additional suggested continuation items.]');
  } else {
    sections.push(
      '## What I want you to DO\n- Ignore the original session’s work after the evidence cutoff.\n- Re-approach the quoted question, or the work immediately after the stated boundary, fresh.\n- Verify files and assumptions before making changes.',
    );
  }
  if (inp.gitContext) {
    // The Git formatter limits status lines; redact full fields before that
    // happens (a multiline credential may end beyond those retained lines).
    const currentGit = inp.redactor ? redactDeep(inp.gitContext, inp.redactor) : inp.gitContext;
    const git = formatGitContextMarkdown(currentGit);
    if (git) {
      sections.push(`Current Git context only; NOT historical evidence:\n${safe(git, 8_192)}`);
      if ((currentGit.status?.split('\n').length ?? 0) > 20) {
        sections.push('[Omitted: current Git status lines beyond the first 20.]');
      }
    }
  }
  sections.push(
    [
      '## Full session reference',
      `- jsonl: \`${safe(inp.jsonlPath, 2_048)}\``,
      `- evidence ends at source event: ${evidence.cutoff_index ?? 'none'}`,
      '- The source can contain excluded branches and later events; do not treat them as evidence for this cutoff.',
    ].join('\n'),
  );
  if (mode === 'continue') {
    sections.push(
      'Please continue from the evidenced point. Respect the quoted instructions and evaluate recorded decisions against the current files; omitted context is not assumed to be known.',
    );
  }
  return limitWithNotice(sections.join('\n\n') + '\n', MAX_MARKDOWN_BYTES);
}

function scopeDescription(evidence: SnapshotEvidence, mode: 'continue' | 'fork'): string {
  const scope =
    evidence.scope === 'root'
      ? 'Root selection'
      : evidence.scope === 'sidechains'
        ? 'Sidechains container'
        : 'Selected segment';
  if (evidence.cutoff_reason === 'no_question')
    return `${scope}: no selected textual user question exists; fork evidence is empty.`;
  if (evidence.cutoff_reason === 'before_segment')
    return `${scope}: no textual user question in this segment. Fork stops immediately before the segment; evidence is bounded to known selected ancestry.`;
  if (mode === 'fork')
    return `${scope}: fork stops at the first selected textual user question in this scope, before its subsequent work. Segment-wide metadata and LLM enrichment are omitted.`;
  if (evidence.scope === 'segment')
    return `${scope}: continue uses bounded evidence from selected segment outcomes and known selected ancestry, not later segments.`;
  return `${scope}: continue uses bounded evidence from selected ${evidence.scope === 'sidechains' ? 'sidechain events and known selected ancestry' : 'events'}. This can cover multiple branches, not one linear decision path; select a segment to isolate a branch.`;
}

function eventEvidence(event: RawEvent): Pick<SnapshotEvidenceEntry, 'role' | 'text'> | null {
  if (event.type === 'system') {
    if (
      event.payload.type !== 'compaction' ||
      typeof event.payload.message !== 'string' ||
      !event.payload.message.trim()
    )
      return null;
    return { role: 'compaction', text: event.payload.message };
  }
  if (event.type !== 'user' && event.type !== 'assistant') return null;
  const content = event.message.content;
  if (typeof content === 'string') {
    return content.trim() ? { role: event.type, text: content } : null;
  }
  const parts: string[] = [];
  for (const block of content) {
    if (block && block.type === 'text' && typeof block.text === 'string') parts.push(block.text);
  }
  const text = parts.join('\n');
  return text.trim() ? { role: event.type, text } : null;
}

function reference(entry: SnapshotEvidenceEntry): string {
  const attribution =
    entry.role === 'user'
      ? 'User instruction'
      : entry.role === 'assistant'
        ? 'Assistant statement'
        : 'Recorded compaction summary';
  return `Source event ${entry.event_index} · uuid \`${entry.event_uuid}\` · ${attribution}${entry.is_sidechain ? ' · sidechain' : ''}`;
}

function renderEntry(entry: SnapshotEvidenceEntry): string {
  return [
    reference(entry),
    quote(entry.text),
    ...(entry.omitted_bytes > 0
      ? [`[Omitted: ${entry.omitted_bytes} redacted UTF-8 bytes from this event.]`]
      : []),
  ].join('\n');
}

function quote(text: string): string {
  return text
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
}

function boundedValue(text: string, redactor: Redactor | undefined, bytes: number): string {
  return limitWithNotice(redactor ? redactor.apply(text) : text, bytes);
}

function limitWithNotice(text: string, bytes: number): string {
  if (Buffer.byteLength(text) <= bytes) return text;
  return bytePrefix(text, bytes - Buffer.byteLength(OMITTED)) + OMITTED;
}

function bytePrefix(text: string, bytes: number): string {
  if (Buffer.byteLength(text) <= bytes) return text;
  const buffer = Buffer.from(text);
  let end = Math.max(0, bytes);
  while (end > 0 && (buffer[end] & 0xc0) === 0x80) end -= 1;
  return buffer.subarray(0, end).toString('utf8');
}
