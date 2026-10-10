/**
 * Commander wiring + parsed CLI shape — extracted from `cli.ts` so the main
 * orchestrator stays small and so `cli/pipeline.ts` / `cli/modes.ts` can share
 * the typed `CliOptions` without circular imports.
 */

import { Command, InvalidArgumentError, Option } from 'commander';
import { VERSION } from '../version.js';
import { REPOSITORY_URL } from '../utils/star_hint.js';
import type { SessionSourceId } from '../sources/types.js';
import { searchQueryProblem } from '../search/query.js';

export interface CliOptions {
  latest?: boolean;
  pick?: boolean;
  file?: string;
  source?: SessionSourceId;
  cwd?: string;
  sessions?: boolean;
  limit?: number;
  json?: boolean;
  strict?: boolean;
  llm?: boolean; // commander converts --no-llm to { llm: false }
  dumpJson?: string;
  verbose?: boolean;
  trace?: boolean;
  dryRun?: boolean;
  model?: string;
  maxLlmTokens?: number;
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
  search?: string; // --search <text> finds steps across sessions
  since?: number; // --since <days> limits --search to recent files
  includeToolOutput?: boolean; // --include-tool-output also matches tool results
  usage?: boolean; // --usage adds token columns to the tree
  open?: string; // --open <step> starts an agent session with the resume prompt
  agent?: SessionSourceId; // --agent picks the agent --open starts
  openDir?: string; // --open-dir overrides the directory --open starts in
}

export type ParsedArgs =
  { ok: true; opts: CliOptions; sessionArg: string | undefined } | { ok: false; exitCode: number };

export function parseCliArgs(argv: string[]): ParsedArgs {
  const program = new Command();
  program
    .name('agent-tree')
    .description(
      'Navigate Claude Code or Codex sessions as numbered trees and generate resume prompts.',
    )
    .version(VERSION, '-V, --version', 'print agent-tree version')
    .argument('[session-id]', 'session UUID or short prefix (e.g. 69c2f35e)')
    .option('--latest', 'use the most recently modified session')
    .option('--pick', 'interactive picker over recent sessions')
    .option('--file <path>', 'read a Claude Code or Codex JSONL file (auto-detected)')
    .addOption(
      new Option('--source <source>', 'session source (discovery: claude; search: both; file: auto)').choices([
        'claude',
        'codex',
      ]),
    )
    .option('--cwd <dir>', 'project directory for session discovery and configuration')
    .option('--sessions', 'list recent sessions without analyzing their contents')
    .option(
      '--limit <n>',
      'maximum sessions to list (default: 20) or report from --search (default: 10)',
      positiveInteger,
    )
    .option('--json', 'emit a redacted mindmap or session catalog as JSON')
    .option('--strict', 'reject malformed JSONL instead of skipping invalid lines')
    .option('--no-llm', 'skip LLM labeling and run heuristic-only')
    .option(
      '--dump-json <dir>',
      'dump intermediate artifacts (raw events / graph / segments / tree) as JSON',
    )
    .option('-v, --verbose', 'debug logging')
    .option('--trace', 'trace logging (implies --verbose)')
    .option('--dry-run', 'run the analysis pipeline but do not emit any output')
    .option('--model <name>', 'Anthropic model for LLM labeling')
    .option('--max-llm-tokens <n>', 'input token budget ceiling across segments', positiveInteger)
    .option('--redact-strict', 'add PII patterns (email/phone/SSN/RRN); card check is always on')
    .option('--redact-dryrun', 'print redaction hit counts to stderr')
    .option('--include-sidechains', 'keep sidechain segments as a branch (default)')
    .option('--flatten-sidechains', 'merge sidechains into main tree')
    .option('--drop-sidechains', 'omit sidechain events entirely')
    .option('--list', 'print numbered ASCII tree to stdout (skill-friendly)')
    .option('--snapshot <id>', "print single node's snapshot markdown to stdout")
    .addOption(new Option('--mode <mode>', 'snapshot mode').choices(['continue', 'fork']))
    .option('--tui', 'interactive readline prompt with numbered selection')
    .option(
      '--filter <kw>',
      'show only rows whose label/time/range matches keyword (case-insensitive)',
    )
    .option('--no-group', 'do not collapse consecutive same-file rows')
    .option('--no-color', 'force-disable ANSI color even on TTY')
    .option('--phases-only', 'show only phase headers (user prompts), hide sub-actions')
    .option('--picks', 'list every pick across every session (no session arg needed)')
    .option('--unstar <id>', 'remove the ⭐ from a previously-picked node')
    .option('--diff <ids...>', 'summarise what happened between two nodes (numbers or n_NNN ids)')
    .option('--search <text>', 'find the sessions and steps where the text appears')
    .option('--since <days>', 'limit --search to sessions changed in the last N days', positiveInteger)
    .option('--include-tool-output', 'let --search also match tool results')
    .option('--usage', 'show token usage per step in the tree')
    .option('--open <step>', 'start a new agent session from a step (continue or fork prompt)')
    .addOption(
      new Option('--agent <agent>', 'agent --open starts (default: the session source)').choices([
        'claude',
        'codex',
      ]),
    )
    .option('--open-dir <dir>', "directory --open starts in (default: the step's directory)")
    .addHelpText('after', `\nDocs and issues: ${REPOSITORY_URL}`)
    .exitOverride();

  try {
    program.parse(argv, { from: 'node' });
    const opts = program.opts<CliOptions>();
    const fail = (message: string) => program.error(message, { exitCode: 2 });
    const selectors = [opts.latest, opts.pick, opts.file, program.args[0]].filter(Boolean);
    if (selectors.length > 1) fail('use only one of session-id, --latest, --pick, or --file');
    const searching = opts.search !== undefined;
    const modes = [
      opts.list,
      opts.snapshot,
      opts.tui,
      opts.picks,
      opts.unstar,
      opts.diff,
      opts.sessions,
      searching,
      opts.open !== undefined,
    ].filter(Boolean);
    if (modes.length > 1) fail('output modes are mutually exclusive');
    const queryProblem = searching ? searchQueryProblem(opts.search!) : null;
    if (queryProblem) fail(`--search ${queryProblem}`);
    if ((opts.since !== undefined || opts.includeToolOutput) && !searching)
      fail('--since and --include-tool-output require --search');
    if (opts.open !== undefined && !opts.open.trim()) fail('--open needs a step number');
    if ((opts.agent || opts.openDir !== undefined) && opts.open === undefined)
      fail('--agent and --open-dir require --open');
    if (opts.open !== undefined && (opts.json || opts.dumpJson || opts.dryRun))
      fail('--open does not support --json, --dump-json or --dry-run');
    if (
      opts.usage &&
      (opts.sessions || opts.picks || searching || opts.open !== undefined || opts.snapshot ||
        opts.unstar || opts.diff)
    )
      fail('--usage only applies to tree output (--list, --tui, --json)');
    if (
      [opts.includeSidechains, opts.flattenSidechains, opts.dropSidechains].filter(Boolean).length >
      1
    ) {
      fail('sidechain modes are mutually exclusive');
    }
    if (opts.diff && opts.diff.length !== 2) fail('--diff requires exactly two node ids');
    if (opts.mode && !opts.snapshot && opts.open === undefined)
      fail('--mode requires --snapshot or --open');
    if (opts.limit !== undefined && !opts.sessions && !searching)
      fail('--limit requires --sessions or --search');
    const catalog = opts.sessions || opts.picks || searching;
    if (catalog && selectors.length)
      fail('--sessions, --picks and --search do not accept session selectors');
    if (opts.json && (opts.snapshot || opts.tui || opts.picks || opts.unstar || opts.diff)) {
      fail('--json supports tree output, --sessions and --search only');
    }
    if (opts.json && (opts.filter || opts.phasesOnly || opts.group === false)) {
      fail('--json exports the complete tree; display filters are not supported');
    }
    if (
      catalog &&
      (opts.dumpJson || opts.dryRun || opts.strict || opts.filter || opts.phasesOnly)
    ) {
      fail('--sessions, --picks and --search do not support analysis or tree display options');
    }
    if (
      catalog &&
      [
        'llm',
        'model',
        'maxLlmTokens',
        'includeSidechains',
        'flattenSidechains',
        'dropSidechains',
        'redactDryrun',
        'group',
        // Search highlights matches on a TTY, so --no-color applies to it.
        ...(searching ? [] : ['color']),
      ].some((option) => program.getOptionValueSource(option) === 'cli')
    ) {
      fail('--sessions, --picks and --search do not support LLM, sidechain or tree display options');
    }
    return {
      ok: true,
      opts,
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
    return { ok: false, exitCode: 2 };
  }
}

function positiveInteger(value: string): number {
  const number = Number(value);
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(number)) {
    throw new InvalidArgumentError('expected a positive safe integer');
  }
  return number;
}

/**
 * Resolve which output mode is active. Default rules:
 *   - --picks / --unstar / --diff / --open are all session-utility modes
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
  open: boolean;
}

export function resolveMode(opts: CliOptions, isTty: boolean): EffectiveMode {
  const utilityFlag =
    !!opts.picks || !!opts.unstar || !!opts.diff?.length || opts.open !== undefined;
  const flagSet = !!opts.list || !!opts.json || !!opts.snapshot || !!opts.tui || utilityFlag;
  return {
    list: !!opts.list || !!opts.json || (!flagSet && !isTty),
    snapshot: !!opts.snapshot,
    tui: !!opts.tui || (!flagSet && isTty),
    picks: !!opts.picks,
    unstar: !!opts.unstar,
    diff: !!opts.diff?.length,
    open: opts.open !== undefined,
  };
}
