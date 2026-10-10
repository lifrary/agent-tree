/** --open: start a new agent session from a step's continue or fork prompt. */
import { stat } from 'node:fs/promises';
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
}

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

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}
