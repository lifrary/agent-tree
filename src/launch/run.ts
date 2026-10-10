/** Run an agent in the foreground on the inherited terminal and report how it ended. */
import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { constants } from 'node:os';

import type { LaunchPlan } from './command.js';

export type SpawnFn = (command: string, args: string[], options: SpawnOptions) => ChildProcess;

export type RunOutcome =
  { started: true; status: number } | { started: false; error: NodeJS.ErrnoException };

export interface RunHooks {
  spawn?: SpawnFn;
  /** Runs once the child is running, never when it failed to start. */
  onStart?: () => Promise<void> | void;
  /** Where SIGINT is ignored while the child runs; the process by default. */
  signals?: Pick<NodeJS.Process, 'on' | 'removeListener'>;
}

const ignoreSigint = (): void => {};

/**
 * The child owns the terminal, so a Ctrl-C reaches both processes; agent-tree
 * ignores it until the child is gone and then exits with the child's status,
 * 128 + the signal number when the child died of a signal (130 for SIGINT).
 */
export function runAgent(plan: LaunchPlan, hooks: RunHooks = {}): Promise<RunOutcome> {
  const signals = hooks.signals ?? process;
  signals.on('SIGINT', ignoreSigint);
  return new Promise<RunOutcome>((resolve) => {
    let started: Promise<void> = Promise.resolve();
    let settled = false;
    const settle = (outcome: RunOutcome) => {
      if (settled) return;
      settled = true;
      void started.then(() => resolve(outcome));
    };
    let child: ChildProcess;
    try {
      child = (hooks.spawn ?? nodeSpawn)(plan.command, plan.args, plan.options);
    } catch (error) {
      settle({ started: false, error: error as NodeJS.ErrnoException });
      return;
    }
    child.once('spawn', () => {
      started = Promise.resolve()
        .then(hooks.onStart)
        .catch(() => {});
    });
    child.once('error', (error: NodeJS.ErrnoException) => {
      if (child.pid === undefined) settle({ started: false, error });
    });
    child.once('exit', (code, signal) => {
      settle({ started: true, status: exitStatus(code, signal) });
    });
  }).finally(() => signals.removeListener('SIGINT', ignoreSigint));
}

export function exitStatus(code: number | null, signal: NodeJS.Signals | null): number {
  if (code !== null) return code;
  const number = signal ? constants.signals[signal] : undefined;
  return number === undefined ? 1 : 128 + number;
}
