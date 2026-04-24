/**
 * CLI entry — orchestrator only.
 *
 * Terminal-only product. The mindmap is always rendered as a numbered ASCII
 * tree (or interactive TUI); resume context is emitted as markdown to stdout
 * for clipboard-paste into a fresh `claude` session.
 *
 * Heavy lifting lives in:
 *   - `cli/options.ts`  — argv parsing, mode resolution
 *   - `cli/pipeline.ts` — full analysis pipeline (parse → graph → segments → mindmap → LLM)
 *   - `cli/modes.ts`    — per-mode output handlers (list / snapshot / tui)
 *   - `utils/picker.ts` — interactive session picker
 */

import { resolve } from 'node:path';

import { parseCliArgs, resolveMode } from './cli/options.js';
import { runPipeline } from './cli/pipeline.js';
import {
  dumpArtifacts,
  runDiffMode,
  runListMode,
  runPicksMode,
  runSnapshotMode,
  runTuiMode,
  runUnstarMode,
} from './cli/modes.js';
import { loadConfig } from './config/loader.js';
import { createLoggerSync, type LogLevel } from './utils/logger.js';
import { pickSession } from './utils/picker.js';
import {
  findLatestSession,
  findLatestSessionInProject,
  locateSession,
  type SessionMatch,
} from './utils/session_path.js';

export async function main(argv: string[] = process.argv): Promise<number> {
  const parsed = parseCliArgs(argv);
  if (!parsed.ok) return parsed.exitCode;
  const { opts, sessionArg } = parsed;

  const level: LogLevel = opts.trace ? 'trace' : opts.verbose ? 'debug' : 'info';
  const logger = createLoggerSync(level);
  const { config } = await loadConfig({ logger });

  // --picks is session-independent (lists picks across every session); handle
  // before the session-resolution step.
  if (opts.picks) {
    return runPicksMode();
  }

  // No explicit selector → smart default: latest session in current project,
  // falling back to globally latest if this project has no sessions yet.
  const resolved = await resolveSession(sessionArg, opts, logger);
  if (!resolved.ok) {
    // 130 = SIGINT-style "user cancelled" (conventional for interactive pick
    // aborts). 2 = POSIX "misuse / not found". Discriminated union makes
    // this mapping explicit instead of leaning on null-vs-undefined.
    return resolved.reason === 'cancelled' ? 130 : 2;
  }
  const match = resolved.match;

  // Demoted from `info` → `debug`: surfacing the JSONL path on every run is
  // chat noise; users with `--verbose` still get it.
  logger.debug(`session located`, {
    sessionId: match.sessionId,
    jsonl: match.jsonlPath,
  });

  const mode = resolveMode(opts, !!process.stdout.isTTY);

  // Quiet the [N/5] progress lines for skill-friendly + interactive modes.
  // Only the explicit `--verbose` / `--trace` flags reveal them. Otherwise the
  // user's chat / TUI stays clean — they don't need ingestion telemetry.
  const quiet = (mode.list || mode.snapshot || mode.tui) && !opts.verbose && !opts.trace;

  const result = await runPipeline({ match, opts, config, logger, quiet });
  if (result.isEmpty) {
    console.error('No turns found — empty session. Exiting.');
    return 0;
  }

  if (opts.dumpJson) {
    await dumpArtifacts(
      opts.dumpJson,
      result.graph,
      result.segments,
      result.mindmap,
      result.redactor,
    );
    logger.info(`dumped JSON artifacts`, { dir: resolve(opts.dumpJson) });
  }

  if (opts.dryRun) {
    process.stderr.write('Dry-run — analysis complete, no output written.\n');
    return 0;
  }

  const ctx = {
    match,
    opts,
    config,
    logger,
    mindmap: result.mindmap,
    graph: result.graph,
    segments: result.segments,
    redactor: result.redactor,
    cacheHash: result.cacheHash,
  };

  if (mode.unstar) return runUnstarMode(ctx);
  if (mode.diff) return runDiffMode(ctx);
  if (mode.list) return runListMode(ctx);
  if (mode.snapshot) return runSnapshotMode(ctx);
  if (mode.tui) return runTuiMode(ctx);

  // Should not reach: at least one mode is always selected by resolveMode.
  console.error('internal error: no output mode resolved');
  return 1;
}

/**
 * Resolve session by (in priority order):
 *   1. --pick (interactive)
 *   2. --latest (globally latest across all projects)
 *   3. positional session id / prefix
 *   4. smart default: latest session in current project, then globally latest
 *
 * Returns a discriminated union so callers can map the failure mode onto a
 * specific exit code without inspecting truthiness of `null` vs `undefined`:
 *   - `{ ok: true, match }` — continue
 *   - `{ ok: false, reason: 'cancelled' }` — user aborted an interactive pick (exit 130)
 *   - `{ ok: false, reason: 'not_found' }` — no matching session (exit 2)
 */
type SessionResolution =
  | { ok: true; match: SessionMatch }
  | { ok: false; reason: 'cancelled' | 'not_found' };

async function resolveSession(
  sessionArg: string | undefined,
  opts: { pick?: boolean; latest?: boolean },
  logger: { info(msg: string, extra?: unknown): void; debug(msg: string, extra?: unknown): void },
): Promise<SessionResolution> {
  if (opts.pick) {
    const picked = await pickSession();
    if (!picked) {
      console.error('Selection cancelled.');
      return { ok: false, reason: 'cancelled' };
    }
    return { ok: true, match: picked };
  }
  if (opts.latest) {
    const latest = await findLatestSession();
    if (!latest) {
      console.error('error: no sessions found under ~/.claude/projects/.');
      return { ok: false, reason: 'not_found' };
    }
    return { ok: true, match: latest };
  }
  if (!sessionArg) {
    // Smart default — try this project's latest first
    const inProject = await findLatestSessionInProject(process.cwd());
    if (inProject) {
      logger.debug('smart default → this project\'s latest session', {
        sessionId: inProject.sessionId,
      });
      return { ok: true, match: inProject };
    }
    // Fall back to globally latest with a brief notice
    const global = await findLatestSession();
    if (global) {
      console.error(
        `(no session in this project — falling back to globally latest: ${global.sessionId.slice(0, 8)} from ${global.projectDir})`,
      );
      return { ok: true, match: global };
    }
    console.error('error: no sessions found under ~/.claude/projects/.');
    return { ok: false, reason: 'not_found' };
  }
  const matches = await locateSession(sessionArg);
  if (matches.length === 0) {
    console.error(
      `error: no session matched "${sessionArg}" under ~/.claude/projects/.`,
    );
    return { ok: false, reason: 'not_found' };
  }
  if (matches.length > 1) {
    const lines = matches
      .slice(0, 5)
      .map((m) => `  • ${m.sessionId}  (${m.projectDir})`)
      .join('\n');
    console.error(
      `error: "${sessionArg}" is ambiguous; ${matches.length} matches:\n${lines}\n` +
        `\nRe-run with a longer prefix.`,
    );
    return { ok: false, reason: 'not_found' };
  }
  return { ok: true, match: matches[0] };
}

const invokedDirectly =
  typeof process !== 'undefined' &&
  process.argv[1] &&
  /(^|\/)(cli\.(m?js|ts)|agent-tree|atree)$/.test(
    process.argv[1],
  );

if (invokedDirectly) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      // eslint-disable-next-line no-console
      console.error('fatal:', err);
      process.exit(1);
    },
  );
}
