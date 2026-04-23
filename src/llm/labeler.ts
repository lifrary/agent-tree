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

import type {
  MindMap,
  MindMapNode,
  RawEvent,
  SessionGraph,
  TopicSegment,
} from '../types.js';

import {
  callSegmentLabel,
  type AnthropicLike,
  type CallLabelResult,
} from './anthropic.js';
import type { Redactor } from '../utils/redact.js';

import {
  buildContinueSnapshot,
  buildForkSnapshot,
} from '../tree/context_snapshot.js';

import {
  SYSTEM_PROMPT,
  buildSegmentUserMessage,
} from './prompts.js';

export interface LabelerOptions {
  client: AnthropicLike;
  model: string; // e.g. 'claude-sonnet-4-6'
  maxInputTokens?: number; // budget ceiling for summed input across segments
  parallel?: number; // concurrent LLM calls; default 3
  logger?: { info?: (msg: string, extra?: unknown) => void; warn?: (msg: string, extra?: unknown) => void };
  redactor?: Redactor; // applied to userMessage before SDK call (SPEC §7.6)
  /**
   * Absolute path to the source JSONL — written into snapshot markdown so the
   * user can reference it. Required for snapshot rebuild after labeling.
   */
  jsonlPath: string;
}

export interface LabelerStats {
  segments_attempted: number;
  segments_labeled: number;
  segments_failed: number;
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
    total_input_tokens: 0,
    total_output_tokens: 0,
    cache_read_tokens: 0,
    cache_creation_tokens: 0,
  };

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
        const events = graph.events.slice(match.start_index, match.end_index + 1);
        nodesToLabel.push({ node, segment: match, events });
        return;
      }
    }
    for (const c of node.children) collectNodes(c);
  };
  collectNodes(mindmap.root);

  // Throttled parallel execution
  let cursor = 0;
  const workers: Promise<void>[] = [];
  for (let w = 0; w < parallel; w += 1) {
    workers.push(
      (async () => {
        for (;;) {
          const idx = cursor;
          cursor += 1;
          if (idx >= nodesToLabel.length) return;
          if (stats.total_input_tokens > maxInput) {
            opts.logger?.warn?.(
              'token budget exhausted, remaining segments keep heuristic labels',
              { limit: maxInput },
            );
            return;
          }
          const entry = nodesToLabel[idx];
          stats.segments_attempted += 1;
          const res = await labelOne(entry, opts);
          applyResult(entry, res, graph, opts.jsonlPath, opts.redactor, stats, opts.logger);
        }
      })(),
    );
  }
  await Promise.all(workers);

  return { mindmap, stats };
}

async function labelOne(
  entry: { node: MindMapNode; segment: TopicSegment; events: RawEvent[] },
  opts: LabelerOptions,
): Promise<CallLabelResult> {
  const rawMessage = buildSegmentUserMessage({
    segment: entry.segment,
    events: entry.events,
  });
  const userMessage = opts.redactor ? opts.redactor.apply(rawMessage) : rawMessage;
  return callSegmentLabel({
    client: opts.client,
    systemPrompt: SYSTEM_PROMPT,
    userMessage,
    model: opts.model,
  });
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
  if (!res.ok) {
    stats.segments_failed += 1;
    logger?.warn?.(`LLM label failed for ${entry.segment.id}`, {
      reason: res.reason,
    });
    return;
  }
  stats.segments_labeled += 1;
  stats.total_input_tokens += res.usage.inputTokens;
  stats.total_output_tokens += res.usage.outputTokens;
  stats.cache_read_tokens += res.usage.cacheReadTokens;
  stats.cache_creation_tokens += res.usage.cacheCreationTokens;

  const { label } = res;
  entry.node.label = label.label;
  entry.node.summary = label.summary;
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
  const snapInput = {
    sessionId: graph.meta.sessionId,
    jsonlPath,
    nodeId: entry.node.id,
    label: entry.node.label,
    segment: entry.segment,
    generatedAt: new Date().toISOString(),
    events: entry.events,
    llm: {
      label: label.label,
      summary: label.summary,
      next_steps: label.next_steps,
    },
    redactor,
  };
  entry.node.context_snapshot_continue = buildContinueSnapshot(snapInput);
  entry.node.context_snapshot_fork = buildForkSnapshot(snapInput);
}
