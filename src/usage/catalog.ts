/** Opt-in catalog totals; discovery and its limit must run before this module is called. */
import type { ResolvedConfig } from '../cli/pipeline.js';
import { detectSegments } from '../analyzer/segments.js';
import { getSessionSource } from '../sources/index.js';
import { groupSegmentsIntoPhases } from '../tree/builder.js';
import { aggregateUsage, collectSessionUsage, type UsageNode } from './attach.js';
import type { CliOptions } from '../cli/options.js';
import type { SessionEntry } from '../sources/types.js';
import type { StepUsage } from '../types.js';
import type { Logger, LogLevel } from '../utils/logger.js';
import { redactDeep, type Redactor } from '../utils/redact.js';

/**
 * Only usage-enabled catalogs add these fields. `usage` retains StepUsage's
 * main-only counts and separate `subagents`; the two explicit totals add both.
 * Missing logs and unreadable/rotated files carry null, never invented zeros.
 */
export type CatalogUsageEntry = SessionEntry &
  (
    | {
        usage_status: 'available';
        usage: StepUsage;
        total_prompt_tokens: number;
        total_output_tokens: number;
      }
    | {
        usage_status: 'not_logged' | 'unavailable';
        usage: null;
        total_prompt_tokens: null;
        total_output_tokens: null;
      }
  );

interface CatalogUsageOptions {
  opts: Pick<CliOptions, 'cwd' | 'redactStrict'>;
  config: ResolvedConfig;
  logger: Logger;
  redactor: Redactor;
}

const UNAVAILABLE_CODES = new Set([
  'ENOENT',
  'ENOTDIR',
  'EACCES',
  'EPERM',
  'EISDIR',
  'EIO',
  'ESTALE',
  'ELOOP',
]);

/** Analyze only the already-limited entries, one at a time to bound memory. */
export async function addCatalogUsage(
  entries: SessionEntry[],
  options: CatalogUsageOptions,
): Promise<CatalogUsageEntry[]> {
  const { config, redactor } = options;
  // Readers can log transcript paths; diagnostics need the same policy as rows.
  const emit = (level: LogLevel, message: string, extra?: unknown) =>
    options.logger[level](redactor.apply(message), redactDeep(extra, redactor));
  const logger: Logger = {
    level: options.logger.level,
    trace: (message, extra) => emit('trace', message, extra),
    debug: (message, extra) => emit('debug', message, extra),
    info: (message, extra) => emit('info', message, extra),
    warn: (message, extra) => emit('warn', message, extra),
    error: (message, extra) => emit('error', message, extra),
  };
  const rows: CatalogUsageEntry[] = [];
  for (const entry of entries) {
    let usage: StepUsage | undefined;
    let status: 'not_logged' | 'unavailable' = 'not_logged';
    try {
      const { events, usage: samples } = await getSessionSource(entry.source).read(
        entry.jsonlPath,
        { logger },
      );
      const segments = detectSegments(events, {
        sidechainHandling: config.analyzer.sidechain_handling,
        gapMs: config.analyzer.topic_gap_minutes * 60_000,
        fileJaccardThreshold: config.analyzer.file_jaccard_threshold,
      });
      const main = segments.filter((segment) => !segment.is_sidechain_only);
      const sidechains = segments.filter((segment) => segment.is_sidechain_only);
      const root: UsageNode = {
        event_uuids: [],
        children: groupSegmentsIntoPhases(main, events).map((phase) => ({
          event_uuids: phase.headSegment.event_uuids,
          children: phase.children.map((segment) => ({
            event_uuids: segment.event_uuids,
            children: [],
          })),
        })),
      };
      if (sidechains.length > 0) {
        root.children.push({
          event_uuids: [],
          children: sidechains.map((segment) => ({
            event_uuids: segment.event_uuids,
            children: [],
          })),
        });
      }
      usage = aggregateUsage(
        root,
        await collectSessionUsage({
          source: entry.source,
          jsonlPath: entry.jsonlPath,
          events,
          samples,
          logger,
        }),
      );
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !UNAVAILABLE_CODES.has((error as NodeJS.ErrnoException).code ?? '')
      ) {
        throw error;
      }
      status = 'unavailable';
    }
    rows.push(
      usage
        ? {
            ...entry,
            usage_status: 'available',
            usage,
            total_prompt_tokens: usage.prompt_tokens + (usage.subagents?.prompt_tokens ?? 0),
            total_output_tokens: usage.output_tokens + (usage.subagents?.output_tokens ?? 0),
          }
        : {
            ...entry,
            usage_status: status,
            usage: null,
            total_prompt_tokens: null,
            total_output_tokens: null,
          },
    );
  }
  return redactDeep(rows, redactor);
}

export function formatCatalogUsage(entry: CatalogUsageEntry): string {
  if (entry.usage_status === 'not_logged') return 'usage not logged; totals unknown';
  if (entry.usage_status === 'unavailable') return 'usage unavailable; totals unknown';
  return (
    `total prompt ${entry.total_prompt_tokens} · total out ${entry.total_output_tokens}` +
    ' (main + subagents)'
  );
}
