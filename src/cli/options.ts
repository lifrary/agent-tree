/**
 * Commander wiring + parsed CLI shape — extracted from `cli.ts` so the main
 * orchestrator stays small and so `cli/pipeline.ts` / `cli/modes.ts` can share
 * the typed `CliOptions` without circular imports.
 */

import { Command } from 'commander';

// Injected by esbuild from package.json at build time. `tsx` source-mode
// runs (npm run cli) read package.json directly; everything else gets the
// build-time-baked value.
declare const __PKG_VERSION__: string | undefined;
const PKG_VERSION = (() => {
  try {
    return __PKG_VERSION__;
  } catch {
    return undefined;
  }
})() ?? '0.0.0-source';

export interface CliOptions {
  latest?: boolean;
  pick?: boolean;
  llm?: boolean; // commander converts --no-llm to { llm: false }
  dumpJson?: string;
  verbose?: boolean;
  trace?: boolean;
  dryRun?: boolean;
  model?: string;
  maxLlmTokens?: string;
  redactStrict?: boolean;
  redactDryrun?: boolean;
  includeSidechains?: boolean;
  flattenSidechains?: boolean;
  dropSidechains?: boolean;
  // Output modes (terminal-only)
  list?: boolean;
  snapshot?: string;
  mode?: 'continue' | 'fork';
  tui?: boolean;
  filter?: string;
  group?: boolean; // --no-group disables consecutive-file collapsing
  color?: boolean; // --no-color disables ANSI even on TTY
  phasesOnly?: boolean; // --phases-only collapses sub-actions
  picks?: boolean; // --picks lists every pick across every session
  unstar?: string; // --unstar <node-id-or-number> removes the ⭐
  diff?: string[]; // --diff <a> <b> compares two nodes
}

export type ParsedArgs =
  | { ok: true; opts: CliOptions; sessionArg: string | undefined }
  | { ok: false; exitCode: number };

export function parseCliArgs(argv: string[]): ParsedArgs {
  const program = new Command();
  program
    .name('agent-tree')
    .description(
      'Navigate a Claude Code session as a numbered file-tree in your terminal and resume from any node.',
    )
    .version(PKG_VERSION, '-V, --version', 'print agent-tree version')
    .argument('[session-id]', 'session UUID or short prefix (e.g. 69c2f35e)')
    .option('--latest', 'use the most recently modified session')
    .option('--pick', 'interactive picker over recent sessions')
    .option('--no-llm', 'skip LLM labeling and run heuristic-only')
    .option('--dump-json <dir>', 'dump intermediate artifacts (raw events / graph / segments / tree) as JSON')
    .option('-v, --verbose', 'debug logging')
    .option('--trace', 'trace logging (implies --verbose)')
    .option('--dry-run', 'run the analysis pipeline but do not emit any output')
    .option(
      '--model <name>',
      'Anthropic model for LLM labeling',
      'claude-sonnet-4-6',
    )
    .option(
      '--max-llm-tokens <n>',
      'input token budget ceiling across segments',
      '50000',
    )
    .option('--redact-strict', 'enable PII patterns (email/phone/SSN/RRN/card)')
    .option('--redact-dryrun', 'print redaction hit counts to stderr')
    .option('--include-sidechains', 'keep sidechain segments as a branch (default)')
    .option('--flatten-sidechains', 'merge sidechains into main tree')
    .option('--drop-sidechains', 'omit sidechain events entirely')
    .option('--list', 'print numbered ASCII tree to stdout (skill-friendly)')
    .option('--snapshot <id>', 'print single node\'s snapshot markdown to stdout')
    .option(
      '--mode <continue|fork>',
      'snapshot mode (used with --snapshot)',
      'continue',
    )
    .option('--tui', 'interactive readline prompt with numbered selection')
    .option('--filter <kw>', 'show only rows whose label/time/range matches keyword (case-insensitive)')
    .option('--no-group', 'do not collapse consecutive same-file rows')
    .option('--no-color', 'force-disable ANSI color even on TTY')
    .option('--phases-only', 'show only phase headers (user prompts), hide sub-actions')
    .option('--picks', 'list every pick across every session (no session arg needed)')
    .option('--unstar <id>', 'remove the ⭐ from a previously-picked node')
    .option(
      '--diff <ids...>',
      'summarise what happened between two nodes (numbers or n_NNN ids)',
    )
    .exitOverride();

  try {
    program.parse(argv, { from: 'node' });
    return {
      ok: true,
      opts: program.opts<CliOptions>(),
      sessionArg: program.args[0],
    };
  } catch (err) {
    const commanderErr = err as { exitCode?: number; code?: string };
    if (
      commanderErr.code === 'commander.helpDisplayed' ||
      commanderErr.code === 'commander.version'
    ) {
      return { ok: false, exitCode: 0 };
    }
    return { ok: false, exitCode: commanderErr.exitCode ?? 1 };
  }
}

/**
 * Resolve which output mode is active. Default rules:
 *   - --picks / --unstar / --diff are all session-utility modes
 *   - --list / --snapshot / --tui explicit → that mode
 *   - none + TTY stdout → tui (interactive)
 *   - none + non-TTY → list (machine-readable for skill use)
 */
export interface EffectiveMode {
  list: boolean;
  snapshot: boolean;
  tui: boolean;
  picks: boolean;
  unstar: boolean;
  diff: boolean;
}

export function resolveMode(opts: CliOptions, isTty: boolean): EffectiveMode {
  const utilityFlag = !!opts.picks || !!opts.unstar || !!opts.diff?.length;
  const flagSet = !!opts.list || !!opts.snapshot || !!opts.tui || utilityFlag;
  return {
    list: !!opts.list || (!flagSet && !isTty),
    snapshot: !!opts.snapshot,
    tui: !!opts.tui || (!flagSet && isTty),
    picks: !!opts.picks,
    unstar: !!opts.unstar,
    diff: !!opts.diff?.length,
  };
}
