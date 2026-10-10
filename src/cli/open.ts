/** --open: start a new agent session from a step's continue or fork prompt. */
import { stat } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { isatty } from 'node:tty';

import { planLaunch, type AgentId } from '../launch/command.js';
import { resolveLaunchDir } from '../launch/directory.js';
import { findOnPath } from '../launch/path.js';
import { runAgent, type SpawnFn } from '../launch/run.js';
import { recordPick } from '../utils/picks.js';
import { buildSnapshotPrompt, type ModeContext } from './modes.js';

export interface OpenDeps {
  env: NodeJS.ProcessEnv;
  interactive: () => boolean;
  spawn?: SpawnFn;
  /** Shows the question on the terminal; resolves true to start the agent. */
  confirm?: (question: string) => Promise<boolean>;
}

const PREVIEW_LINES = 20;
const PREVIEW_WIDTH = 160;
/** The section that tells the new agent what to do; the preview starts there. */
const INSTRUCTION_HEADING = /^## (Last user instruction|Open question)/;
/** Control and bidi characters a terminal would act on instead of showing. */
// eslint-disable-next-line no-control-regex -- matching control characters is the purpose
const INVISIBLE = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;

const defaultDeps: OpenDeps = {
  env: process.env,
  interactive: () => isatty(0) && isatty(1),
};

export type OpenPreflight = { ok: true; binary: string } | { ok: false; status: number };

/**
 * The refusals that need no analysis: a missing binary (127), a nested agent
 * session or a non-terminal (2). Cheap and repeatable, so the CLI can run it
 * before the pipeline and runOpenMode runs it again.
 */
export async function preflightOpen(
  agent: AgentId,
  deps: OpenDeps = defaultDeps,
): Promise<OpenPreflight> {
  const binary = await findOnPath(agent, deps.env.PATH);
  if (!binary) {
    console.error(
      `error: ${agent} not found on PATH; install it or use --snapshot to copy the prompt`,
    );
    return { ok: false, status: 127 };
  }
  if (deps.env.CLAUDECODE === '1') {
    console.error(
      'error: --open refuses to run inside an agent session (CLAUDECODE=1), where nobody is at ' +
        'the keyboard of the new agent; run it from your own terminal, or use --snapshot',
    );
    return { ok: false, status: 2 };
  }
  if (!deps.interactive()) {
    console.error(
      'error: --open needs an interactive terminal on stdin and stdout; use --snapshot to print the prompt instead',
    );
    return { ok: false, status: 2 };
  }
  return { ok: true, binary };
}

/**
 * Refusals come first and record nothing. The pick is recorded only once the
 * agent is running, and agent-tree then exits with the agent's status.
 */
export async function runOpenMode(ctx: ModeContext, deps: OpenDeps = defaultDeps): Promise<number> {
  const agent: AgentId = ctx.opts.agent ?? ctx.match.source;
  const preflight = await preflightOpen(agent, deps);
  if (!preflight.ok) return preflight.status;
  const { binary } = preflight;

  const mode = ctx.opts.mode ?? 'continue';
  const prompt = await buildSnapshotPrompt(ctx, ctx.opts.open!, mode);
  if (!prompt) {
    console.error(`error: no node matches "${ctx.opts.open}". Run --list to see numbers.`);
    return 2;
  }
  const directory = await resolveLaunchDir(ctx.graph, prompt.node, ctx.opts.openDir);
  if (!directory.ok) {
    console.error(ctx.redactor.apply(`error: ${directory.message}`));
    return 2;
  }
  const planned = planLaunch(agent, binary, directory.dir, prompt.markdown);
  if (!planned.ok) {
    console.error(`error: ${planned.message}`);
    return 2;
  }

  // A session file may come from someone else: its prompt and directory get a
  // human look before they reach an agent. Discovered local sessions start directly.
  if (ctx.opts.file && !ctx.opts.yes) {
    const question = ctx.redactor.apply(
      confirmationText(agent, directory.dir, mode, prompt.step, prompt.node.id, prompt.markdown),
    );
    if (!(await (deps.confirm ?? askOnTerminal)(question))) {
      console.error('Cancelled; nothing was started.');
      return 130;
    }
  }

  console.error(
    ctx.redactor.apply(
      `Starting ${agent} in ${directory.dir} with the ${mode} prompt for step ${prompt.step} (${prompt.node.id}).`,
    ),
  );
  const outcome = await runAgent(planned.plan, {
    spawn: deps.spawn,
    onStart: () =>
      recordPick(ctx.match.sessionId, prompt.node.id, mode, { source: ctx.match.source }).catch(
        (err) => ctx.logger.warn?.('pick history write failed', { error: String(err) }),
      ),
  });
  if (!outcome.started) {
    // spawn reports a vanished cwd as ENOENT too; name the directory then.
    if (outcome.error.code === 'ENOENT' && !(await isDirectory(directory.dir))) {
      console.error(
        ctx.redactor.apply(
          `error: the directory disappeared before ${agent} started: ${directory.dir}`,
        ),
      );
      return 2;
    }
    console.error(`error: could not start ${binary}: ${outcome.error.message}`);
    return outcome.error.code === 'ENOENT' ? 127 : 126;
  }
  return outcome.status;
}

export function confirmationText(
  agent: AgentId,
  dir: string,
  mode: string,
  step: number | string,
  nodeId: string,
  markdown: string,
): string {
  const lines = markdown.split('\n');
  const start = lines.findIndex((line) => INSTRUCTION_HEADING.test(line));
  const picked =
    start > 0
      ? [lines[0], ...lines.slice(start, start + PREVIEW_LINES - 1)]
      : lines.slice(0, PREVIEW_LINES);
  const shown = picked.map((line) => {
    const plain = visible(line);
    return `  ${plain.length > PREVIEW_WIDTH ? `${plain.slice(0, PREVIEW_WIDTH - 1)}…` : plain}`;
  });
  const rest = lines.length - picked.length;
  return [
    `About to start ${agent} in ${visible(dir)} with the ${mode} prompt for step ${step} (${nodeId}).`,
    'The prompt comes from a session file; check what it tells the agent:',
    ...shown,
    ...(rest > 0
      ? [`  … ${rest} more line${rest === 1 ? '' : 's'}; --snapshot ${step} prints the whole prompt`]
      : []),
    'Press Enter to start, or Ctrl-C to cancel (--yes skips this question).',
  ].join('\n');
}

/** Shows control and bidi characters as escapes, so the preview cannot hide text. */
export function visible(text: string): string {
  return text.replace(INVISIBLE, (char) => {
    const code = char.codePointAt(0)!;
    return code < 0x100
      ? `\\x${code.toString(16).padStart(2, '0')}`
      : `\\u${code.toString(16).padStart(4, '0')}`;
  });
}

/** Enter, "y" or "yes" starts; anything else, Ctrl-C or end of input cancels. */
function askOnTerminal(question: string): Promise<boolean> {
  // stdout, not stderr: the preflight guarantees stdout is the terminal.
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  return new Promise<boolean>((resolve) => {
    rl.once('SIGINT', () => resolve(false));
    rl.once('close', () => resolve(false));
    rl.question(`${question}\n`, (answer) =>
      resolve(['', 'y', 'yes'].includes(answer.trim().toLowerCase())),
    );
  }).finally(() => rl.close());
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}
