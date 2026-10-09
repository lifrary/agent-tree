/**
 * One-time GitHub star hint for the interactive CLI.
 *
 * Shown on stderr after the first successful interactive run on a machine,
 * and never again. Scripts, CI, JSON output and the MCP server never see it:
 * the caller invokes this only from the interactive path, and the checks
 * below refuse anything that is not a human at a terminal.
 *
 * The marker file is created with an exclusive open before the hint is
 * written, so concurrent runs show it at most once and an unwritable cache
 * directory shows nothing rather than repeating it on every run.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export const REPOSITORY_URL = 'https://github.com/lifrary/agent-tree';
export const STAR_HINT_OPT_OUT_ENV = 'AGENT_TREE_NO_STAR_HINT';

export const STAR_HINT_TEXT =
  `If agent-tree saves you a scroll, a ⭐ on GitHub helps others find it: ${REPOSITORY_URL}\n` +
  `(shown once; set ${STAR_HINT_OPT_OUT_ENV}=1 to never see it)\n`;

export interface StarHintContext {
  env: NodeJS.ProcessEnv;
  stdoutIsTTY: boolean;
  stderrIsTTY: boolean;
  json?: boolean;
  dumpJson?: string;
  markerPath?: string;
  write?: (text: string) => void;
}

export type StarHintDecision =
  | 'show'
  | 'opted-out'
  | 'ci'
  | 'agent'
  | 'not-a-terminal'
  | 'machine-output'
  | 'already-shown'
  | 'marker-unwritable';

export function defaultStarHintMarker(): string {
  return join(homedir(), '.cache', 'agent-tree', 'star-hint-shown');
}

/** Pure part of the decision: everything except the marker file. */
export function starHintBlocker(ctx: StarHintContext): StarHintDecision | null {
  const optOut = ctx.env[STAR_HINT_OPT_OUT_ENV];
  if (optOut === '1' || optOut === 'true') return 'opted-out';
  if (ctx.env.CI) return 'ci';
  // Claude Code sets CLAUDECODE for its tools; an agent at a terminal must not use up the hint.
  if (ctx.env.CLAUDECODE) return 'agent';
  if (!ctx.stdoutIsTTY || !ctx.stderrIsTTY) return 'not-a-terminal';
  if (ctx.json || ctx.dumpJson) return 'machine-output';
  return null;
}

export async function maybeShowStarHint(ctx: StarHintContext): Promise<StarHintDecision> {
  const blocker = starHintBlocker(ctx);
  if (blocker) return blocker;
  const markerPath = ctx.markerPath ?? defaultStarHintMarker();
  try {
    await mkdir(dirname(markerPath), { recursive: true, mode: 0o700 });
  } catch {
    return 'marker-unwritable';
  }
  try {
    await writeFile(markerPath, `${new Date().toISOString()}\n`, { flag: 'wx', mode: 0o600 });
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EEXIST' ? 'already-shown' : 'marker-unwritable';
  }
  (ctx.write ?? ((text: string) => process.stderr.write(text)))(STAR_HINT_TEXT);
  return 'show';
}
