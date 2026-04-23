/**
 * Analysis pipeline — shared between every output mode.
 *
 *   JSONL → events → graph → segments → MindMap → (optional) LLM labels
 *
 * Output is a `PipelineResult` that the per-mode runners in `cli/modes.ts`
 * consume. Keeping all the heavy lifting here means the mode handlers stay
 * focused on formatting/dispatch.
 */

import { detectSegments } from '../analyzer/segments.js';
import { computeInputHash, writeJsonCache } from '../cache/disk.js';
import { graphToDump } from '../reader/graph.js';
import { createAnthropicClient } from '../llm/anthropic.js';
import { labelMindMap } from '../llm/labeler.js';
import { buildGraph } from '../reader/graph.js';
import { readJsonl } from '../reader/jsonl.js';
import { buildMindMap } from '../tree/builder.js';
import type { MindMap, SessionGraph, TopicSegment } from '../types.js';
import type { Logger } from '../utils/logger.js';
import { defaultRedactor, type Redactor } from '../utils/redact.js';
import type { SessionMatch } from '../utils/session_path.js';

import type { ClaudeMapConfig } from '../config/schema.js';

import type { CliOptions } from './options.js';

/** Resolved config returned by `loadConfig` — re-aliased here for clarity. */
export type ResolvedConfig = ClaudeMapConfig;

export const SPEC_VERSION = 'v0.3';

export interface PipelineDeps {
  match: SessionMatch;
  opts: CliOptions;
  config: ResolvedConfig;
  logger: Logger;
  /** Suppress [N/5] stderr progress lines (used by --list / --snapshot). */
  quiet?: boolean;
}

export interface PipelineResult {
  graph: SessionGraph;
  segments: TopicSegment[];
  mindmap: MindMap;
  redactor: Redactor;
  cacheHash: string;
  isEmpty: boolean;
}

export async function runPipeline(deps: PipelineDeps): Promise<PipelineResult> {
  const { match, opts, config, logger, quiet = false } = deps;
  const progress = (msg: string) => {
    if (!quiet) process.stderr.write(msg);
  };

  const redactor = buildRedactor(opts, config, logger);
  const sidechainHandling = pickSidechainMode(opts, config);

  const cacheHash = await computeInputHash({
    jsonlPath: match.jsonlPath,
    configJson: JSON.stringify({
      llm: opts.llm !== false,
      model: opts.model,
      maxTok: opts.maxLlmTokens,
      redactStrict: Boolean(opts.redactStrict),
      sidechainHandling,
    }),
    specVersion: SPEC_VERSION,
  });

  // [1/5] Parsing JSONL
  progress('[1/5] Parsing JSONL...       ');
  const { meta, events, malformedCount, skippedMetaCount } = await readJsonl(
    match.jsonlPath,
    { logger },
  );
  progress(`✔ ${events.length} events`);
  if (malformedCount > 0) progress(`  (${malformedCount} malformed)`);
  if (skippedMetaCount > 0) progress(`  (${skippedMetaCount} meta lines)`);
  progress('\n');

  if (events.length === 0) {
    // Caller decides how to surface "empty session" — just return a stub.
    const emptyMindmap: MindMap = {
      session_id: meta.sessionId,
      project_path: '',
      generated_at: new Date().toISOString(),
      spec_version: SPEC_VERSION,
      root: {
        id: 'n_001',
        type: 'root',
        label: '(empty session)',
        summary: 'No events found in this jsonl.',
        index_range: [0, 0],
        event_uuids: [],
        files_touched: [],
        tools_used: [],
        is_sidechain: false,
        children: [],
        context_snapshot_continue: emptySnapshot('continue', meta.sessionId),
        context_snapshot_fork: emptySnapshot('fork', meta.sessionId),
      },
      stats: {
        total_events: 0,
        total_turns: 0,
        total_nodes: 1,
        total_tool_calls: 0,
        total_files_touched: 0,
        duration_minutes: 0,
        sidechain_count: 0,
      },
    };
    return {
      graph: { meta, events: [], childrenOf: new Map(), roots: [], byUuid: new Map() },
      segments: [],
      mindmap: emptyMindmap,
      redactor,
      cacheHash,
      isEmpty: true,
    };
  }

  // [2/5] Building graph
  progress('[2/5] Building graph...      ');
  const graph = buildGraph(meta, events, { logger });
  const sidechainCount = graph.events.reduce(
    (acc, e) => (e.isSidechain ? acc + 1 : acc),
    0,
  );
  progress(`✔ ${pl(graph.roots.length, 'root')}, ${pl(sidechainCount, 'sidechain')}\n`);

  // [3/5] Segments
  progress('[3/5] Detecting segments...  ');
  const segments = detectSegments(graph.events, { sidechainHandling });
  progress(`✔ ${pl(segments.length, 'segment')}\n`);

  // [4/5] Mindmap (heuristic)
  progress('[4/5] Building mindmap...    ');
  const mindmap = buildMindMap(graph, segments, {
    jsonlPath: match.jsonlPath,
    specVersion: SPEC_VERSION,
    redactor,
  });
  progress(
    `✔ ${pl(mindmap.stats.total_nodes, 'node')} across depth ${treeDepth(mindmap)}\n`,
  );

  // LLM labeling (optional)
  const llmEnabled = opts.llm !== false && config.llm.enabled;
  if (!llmEnabled) {
    logger.debug('LLM labeling disabled (flag or config).');
  } else {
    const client = await createAnthropicClient({});
    if (!client) {
      logger.warn(
        'LLM labeling unavailable (no ANTHROPIC_API_KEY or SDK missing) — heuristic labels retained.',
      );
    } else {
      progress('[LLM ] Labeling segments...  ');
      const maxTok =
        parseInt(opts.maxLlmTokens ?? String(config.llm.max_input_tokens), 10) ||
        config.llm.max_input_tokens;
      const model = opts.model ?? config.llm.model;
      const { stats } = await labelMindMap(mindmap, graph, segments, {
        client,
        model,
        maxInputTokens: maxTok,
        parallel: 3,
        logger,
        redactor,
        jsonlPath: match.jsonlPath,
      });
      const cacheRatio =
        stats.total_input_tokens > 0
          ? Math.round((stats.cache_read_tokens / stats.total_input_tokens) * 100)
          : 0;
      progress(
        `✔ ${stats.segments_labeled}/${stats.segments_attempted} labeled` +
          `  (cached ${cacheRatio}%, ${stats.total_input_tokens} in / ${stats.total_output_tokens} out)\n`,
      );
      if (stats.segments_failed > 0) {
        logger.warn(`${stats.segments_failed} segment(s) kept heuristic label`);
      }
    }
  }

  // SPEC §18.3 — verbose mode mirrors intermediate artifacts to the per-input
  // cache dir so users can poke at them without re-running the pipeline.
  if (opts.verbose || opts.trace) {
    await Promise.all([
      writeJsonCache(cacheHash, 'segments.json', {
        session_id: graph.meta.sessionId,
        count: segments.length,
        segments,
      }).catch((err) =>
        logger.warn('aux cache write failed (segments)', { error: String(err) }),
      ),
      writeJsonCache(cacheHash, 'tree.json', mindmap).catch((err) =>
        logger.warn('aux cache write failed (tree)', { error: String(err) }),
      ),
      writeJsonCache(cacheHash, 'graph.json', graphToDump(graph)).catch((err) =>
        logger.warn('aux cache write failed (graph)', { error: String(err) }),
      ),
    ]);
    logger.debug('mirrored intermediate artifacts to cache', { cacheHash });
  }

  return { graph, segments, mindmap, redactor, cacheHash, isEmpty: false };
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function buildRedactor(
  opts: CliOptions,
  config: ResolvedConfig,
  logger: Logger,
): Redactor {
  return defaultRedactor({
    strict: Boolean(opts.redactStrict) || config.redaction.strict,
    extraPatterns: (config.redaction.extra_patterns ?? [])
      .map((pattern, i) => {
        try {
          return {
            name: `extra_${i}`,
            regex: new RegExp(pattern, 'g'),
            replacement: '[REDACTED]',
          };
        } catch {
          logger.warn('invalid redaction.extra_patterns entry', { pattern });
          return null;
        }
      })
      .filter((x): x is NonNullable<typeof x> => x !== null),
  });
}

function pickSidechainMode(
  opts: CliOptions,
  config: ResolvedConfig,
): 'include' | 'flatten' | 'drop' {
  if (opts.dropSidechains) return 'drop';
  if (opts.flattenSidechains) return 'flatten';
  if (opts.includeSidechains) return 'include';
  return config.analyzer.sidechain_handling;
}

function pl(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function treeDepth(mindmap: MindMap): number {
  const walk = (n: { children: { children: unknown[] }[] }, d: number): number => {
    if (n.children.length === 0) return d;
    let best = d;
    for (const c of n.children as { children: unknown[] }[]) {
      const cd = walk(c as { children: { children: unknown[] }[] }, d + 1);
      if (cd > best) best = cd;
    }
    return best;
  };
  return walk(mindmap.root as unknown as { children: { children: unknown[] }[] }, 0);
}

function emptySnapshot(
  mode: 'continue' | 'fork',
  sessionId: string,
): MindMap['root']['context_snapshot_continue'] {
  return {
    mode,
    session_id: sessionId,
    node_id: 'n_001',
    clipboard_markdown: `# ${mode === 'continue' ? 'Continuing' : 'Forking'} from empty session\n\n_(no events were parsed.)_\n`,
    related_files: [],
    next_steps: [],
  };
}
