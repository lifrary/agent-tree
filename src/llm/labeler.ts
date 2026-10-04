/**
 * LLM labeler orchestrator — SPEC §7.3 / §12 M3
 *
 * Takes a heuristic-built MindMap + the underlying graph/segments and mutates
 * topic nodes with LLM-derived label/summary/type/color + upgrades
 * continue/fork snapshot markdown using verbatim last-user-msg and LLM bullets.
 *
 * Graceful degrade per §7.8: each segment is independent. If the LLM call
 * fails for one, that segment keeps its heuristic label and the rest of the
 * run proceeds.
 */

import type { MindMap, MindMapNode, RawEvent, SessionGraph, TopicSegment } from '../types.js';

import {
  callSegmentLabel,
  countSegmentInputTokens,
  type AnthropicLike,
  type CallLabelInput,
  type CallLabelResult,
} from './anthropic.js';
import type { Redactor } from '../utils/redact.js';
import { eventsForSegment } from '../analyzer/segments.js';

import { buildContinueSnapshot, buildForkSnapshot } from '../tree/context_snapshot.js';

import { SYSTEM_PROMPT, buildSegmentUserMessage } from './prompts.js';

export interface LabelerOptions {
  client: AnthropicLike;
  model: string; // e.g. 'claude-sonnet-4-6'
  /**
   * Ceiling for preflight input reservations, including cached input.
   * Not a monetary spending cap: provider counts/billing may differ, output
   * is billed separately, and failed attempts may be billed without usage.
   * Each reserved segment gets one create attempt, with no retry or refund.
   */
  maxInputTokens?: number;
  parallel?: number; // concurrent LLM calls; default 3
  maxOutputTokens?: number;
  cache?: boolean;
  lang?: 'auto' | 'ko' | 'en';
  logger?: {
    info?: (msg: string, extra?: unknown) => void;
    warn?: (msg: string, extra?: unknown) => void;
  };
  redactor?: Redactor; // applied to userMessage before SDK call (SPEC §7.6)
  /**
   * Absolute path to the source JSONL — written into snapshot markdown so the
   * user can reference it. Required for snapshot rebuild after labeling.
   */
  jsonlPath: string;
}

export interface LabelerStats {
  segments_attempted: number; // count failures + paid attempts; budget skips excluded
  segments_labeled: number;
  segments_failed: number;
  reserved_input_tokens: number; // exact preflight counts, retained on failure
  // Provider-reported usage, including invalid/empty responses. Usage from
  // failed requests with no response is unknown, not assumed to be free.
  total_input_tokens: number;
  total_output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
}

export interface LabelerResult {
  mindmap: MindMap; // same reference, mutated in place
  stats: LabelerStats;
}

export async function labelMindMap(
  mindmap: MindMap,
  graph: SessionGraph,
  segments: TopicSegment[],
  opts: LabelerOptions,
): Promise<LabelerResult> {
  const parallel = Math.max(1, opts.parallel ?? 3);
  const maxInput = opts.maxInputTokens ?? 50_000;
  const stats: LabelerStats = {
    segments_attempted: 0,
    segments_labeled: 0,
    segments_failed: 0,
    reserved_input_tokens: 0,
    total_input_tokens: 0,
    total_output_tokens: 0,
    cache_read_tokens: 0,
    cache_creation_tokens: 0,
  };
  if (!Number.isSafeInteger(maxInput) || maxInput < 0) {
    opts.logger?.warn?.('invalid input token budget, keeping heuristic labels');
    return { mindmap, stats };
  }

  // Flatten all topic segment nodes across the tree. The root + 🔀 Sidechains
  // bucket are containers — they keep their heuristic labels. Only segment
  // leaves get LLM labels.
  const nodesToLabel: Array<{
    node: MindMapNode;
    segment: TopicSegment;
    events: RawEvent[];
  }> = [];

  // Index segments by id once — O(1) lookup per node, exact-match (no more
  // first-uuid identity which could collide if two segments coincidentally
  // started at the same uuid).
  const segmentById = new Map(segments.map((s) => [s.id, s]));

  const collectNodes = (node: MindMapNode) => {
    if (node.type === 'topic' && node.segment_id) {
      const match = segmentById.get(node.segment_id);
      if (match) {
        const events = eventsForSegment(graph.events, match);
        nodesToLabel.push({ node, segment: match, events });
      }
    }
    for (const c of node.children) collectNodes(c);
  };
  collectNodes(mindmap.root);

  // Each worker counts and then reserves before create. There is no await
  // between the budget check and increment, so reservations are atomic even
  // when concurrent counts finish together. Never release failed reservations:
  // the provider may have accepted/billed a request whose response was lost.
  let cursor = 0;
  const workers: Promise<void>[] = [];
  for (let w = 0; w < Math.min(parallel, nodesToLabel.length); w += 1) {
    workers.push(
      (async () => {
        for (;;) {
          const idx = cursor;
          cursor += 1;
          if (idx >= nodesToLabel.length) return;
          if (stats.reserved_input_tokens >= maxInput) {
            opts.logger?.warn?.(
              'token budget exhausted, remaining segments keep heuristic labels',
              { limit: maxInput },
            );
            return;
          }
          const entry = nodesToLabel[idx];
          const input = prepareLabelInput(entry, opts);
          const count = await countSegmentInputTokens(input);
          if (!count.ok) {
            stats.segments_attempted += 1;
            applyResult(entry, count, graph, opts.jsonlPath, opts.redactor, stats, opts.logger);
            continue;
          }
          if (
            stats.reserved_input_tokens >= maxInput ||
            count.inputTokens > maxInput - stats.reserved_input_tokens
          ) {
            opts.logger?.warn?.(
              `input token budget cannot fit ${entry.segment.id}, keeping heuristic label`,
              { limit: maxInput, inputTokens: count.inputTokens },
            );
            continue;
          }
          stats.reserved_input_tokens += count.inputTokens;
          stats.segments_attempted += 1;
          const res = await callSegmentLabel(input);
          applyResult(entry, res, graph, opts.jsonlPath, opts.redactor, stats, opts.logger);
        }
      })(),
    );
  }
  await Promise.all(workers);

  return { mindmap, stats };
}

function prepareLabelInput(
  entry: { node: MindMapNode; segment: TopicSegment; events: RawEvent[] },
  opts: LabelerOptions,
): CallLabelInput {
  const rawMessage = buildSegmentUserMessage({
    segment: entry.segment,
    events: entry.events,
  });
  const userMessage = opts.redactor ? opts.redactor.apply(rawMessage) : rawMessage;
  const language = opts.lang === 'ko' ? 'Korean' : opts.lang === 'en' ? 'English' : null;
  const systemPrompt = language
    ? SYSTEM_PROMPT.replace(
        /^- Language:.*$/m,
        `- Language: Write label, summary, and next_steps in ${language}, regardless of the user turns' language. Keep JSON keys and enum values unchanged.`,
      )
    : SYSTEM_PROMPT;
  return {
    client: opts.client,
    systemPrompt,
    userMessage,
    model: opts.model,
    maxOutputTokens: opts.maxOutputTokens,
    cache: opts.cache,
    maxRetries: 0,
  };
}

function applyResult(
  entry: { node: MindMapNode; segment: TopicSegment; events: RawEvent[] },
  res: CallLabelResult,
  graph: SessionGraph,
  jsonlPath: string,
  redactor: Redactor | undefined,
  stats: LabelerStats,
  logger?: LabelerOptions['logger'],
): void {
  if (res.usage) {
    stats.total_input_tokens += res.usage.inputTokens;
    stats.total_output_tokens += res.usage.outputTokens;
    stats.cache_read_tokens += res.usage.cacheReadTokens;
    stats.cache_creation_tokens += res.usage.cacheCreationTokens;
  }
  if (!res.ok) {
    stats.segments_failed += 1;
    logger?.warn?.(`LLM label failed for ${entry.segment.id}`, {
      reason: res.reason,
    });
    return;
  }
  stats.segments_labeled += 1;

  const { label } = res;
  // Defense-in-depth: the LLM was given a redacted userMessage so it
  // shouldn't *see* secrets to echo, but if it ever hallucinates a
  // key-shaped string (or the redactor missed an entry we add later) the
  // raw model output would land directly in the tree label. Re-apply the
  // redactor at the assignment chokepoint so the snapshot factory + render
  // layer never see un-redacted LLM output.
  const safeLabel = redactor ? redactor.apply(label.label) : label.label;
  const safeSummary = redactor ? redactor.apply(label.summary) : label.summary;
  entry.node.label = safeLabel;
  entry.node.summary = safeSummary;
  entry.node.type = label.type;
  entry.node.color = label.color;
  entry.node.shape = label.type === 'decision' ? 'diamond' : entry.node.shape;
  if (label.type === 'dead_end') {
    entry.node.shape = 'circle';
    entry.node.icon = '💀';
  }

  // Rebuild snapshots from scratch with LLM enrichment. Cleaner than the old
  // regex-replace dance — the snapshot factory handles both heuristic and
  // enriched cases, and we never have stale "M3 placeholder" strings linger.
  // Pre-redact next_steps too so the snapshot factory doesn't have to know
  // which fields are LLM-derived vs user-text.
  const safeNextSteps = redactor
    ? label.next_steps.map((s) => redactor.apply(s))
    : label.next_steps;
  const snapInput = {
    sessionId: graph.meta.sessionId,
    jsonlPath,
    nodeId: entry.node.id,
    label: entry.node.label,
    segment: entry.segment,
    generatedAt: new Date().toISOString(),
    events: entry.events,
    llm: {
      label: safeLabel,
      summary: safeSummary,
      next_steps: safeNextSteps,
    },
    redactor,
  };
  entry.node.context_snapshot_continue = buildContinueSnapshot(snapInput);
  entry.node.context_snapshot_fork = buildForkSnapshot(snapInput);
}
