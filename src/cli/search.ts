/** --search: find the sessions and steps where a text appears. */
import { formatSessionBlocks, formatSummary } from '../search/format.js';
import { searchSessions, type SearchOutcome, type SearchProgress } from '../search/run.js';
import type { Logger } from '../utils/logger.js';
import type { Redactor } from '../utils/redact.js';
import type { CliOptions } from './options.js';
import type { ResolvedConfig } from './pipeline.js';

export const DEFAULT_SEARCH_LIMIT = 10;
const PROGRESS_DELAY_MS = 2000;
const PROGRESS_INTERVAL_MS = 200;

export interface SearchModeContext {
  opts: CliOptions;
  config: ResolvedConfig;
  logger: Logger;
  /** Set when --cwd limits the search to one project; undefined searches every project. */
  projectCwd?: string;
  redactor: Redactor;
}

/** Exit 0 when the search completed (matches or not), 1 on I/O or internal errors. */
export async function runSearchMode(ctx: SearchModeContext): Promise<number> {
  const { opts, redactor } = ctx;
  const limit = opts.limit ?? DEFAULT_SEARCH_LIMIT;
  const progress = progressLine(process.stderr);
  let outcome: SearchOutcome;
  try {
    outcome = await searchSessions({
      query: opts.search ?? '',
      sources: opts.source ? [opts.source] : ['claude', 'codex'],
      projectCwd: ctx.projectCwd,
      sinceDays: opts.since,
      limit,
      includeToolOutput: Boolean(opts.includeToolOutput),
      redactor,
      config: ctx.config,
      cwd: opts.cwd ?? process.cwd(),
      onProgress: progress.update,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`error: search failed: ${redactor.apply(message)}`);
    return 1;
  } finally {
    progress.stop();
  }

  const { report } = outcome;
  if (opts.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    return 0;
  }
  const color = opts.color !== false && !!process.stdout.isTTY && !process.env.NO_COLOR;
  const blocks = formatSessionBlocks(report, {
    commandId: outcome.commandId,
    highlight: color ? outcome.matcher : undefined,
  });
  if (blocks.length > 0) process.stdout.write(blocks.join('\n\n') + '\n');
  if (report.total_sessions === 0) console.error('No matches.');
  else if (report.scanned.stopped_early || process.stderr.isTTY)
    console.error(formatSummary(report, limit));
  return 0;
}

/** A self-overwriting stderr line, only on a terminal and only for slow searches. */
function progressLine(stream: NodeJS.WriteStream): {
  update(progress: SearchProgress): void;
  stop(): void;
} {
  const started = Date.now();
  let lastDrawn = 0;
  let drawn = false;
  return {
    update(progress) {
      const now = Date.now();
      if (!stream.isTTY || now - started < PROGRESS_DELAY_MS) return;
      if (now - lastDrawn < PROGRESS_INTERVAL_MS) return;
      lastDrawn = now;
      drawn = true;
      stream.write(
        `\rSearching… ${progress.scanned}/${progress.total} sessions, ${progress.matched} with matches`,
      );
    },
    stop() {
      if (drawn) stream.write('\r\x1b[K');
      drawn = false;
    },
  };
}
