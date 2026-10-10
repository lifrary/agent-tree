/** The exact argv --open hands to each agent, and the command that reproduces it. */
import { basename } from 'node:path';

import type { SessionSourceId } from '../sources/types.js';

export type AgentId = SessionSourceId;
export type ResumeMode = 'continue' | 'fork';

/**
 * One argument may not exceed 131,072 bytes on Linux (MAX_ARG_STRLEN); the
 * largest snapshot measured was 92,419 bytes. Above this, use --snapshot.
 */
export const MAX_PROMPT_BYTES = 100_000;

export interface LaunchPlan {
  command: string;
  args: string[];
  options: { cwd: string; stdio: 'inherit'; shell: false };
}

export type PlanResult = { ok: true; plan: LaunchPlan } | { ok: false; message: string };

/**
 * Claude Code takes the prompt as its only positional argument and has no
 * directory flag, so the child's cwd is the directory. Codex gets `-C` and a
 * `--` before the prompt (verified on Codex CLI 0.155.1). Whether Claude Code
 * honors `--` is unverified, so its prompt must never look like an option.
 */
export function planLaunch(
  agent: AgentId,
  binary: string,
  dir: string,
  prompt: string,
): PlanResult {
  const bytes = Buffer.byteLength(prompt, 'utf8');
  if (bytes > MAX_PROMPT_BYTES) {
    return {
      ok: false,
      message:
        `the prompt is ${bytes.toLocaleString('en-US')} bytes, over the ` +
        `${MAX_PROMPT_BYTES.toLocaleString('en-US')}-byte limit for one command-line argument; ` +
        'use --snapshot to copy it instead',
    };
  }
  if (prompt.startsWith('-')) {
    return {
      ok: false,
      message: 'internal error: the prompt starts with "-" and would read as an option',
    };
  }
  if (prompt.includes('\0')) {
    return {
      ok: false,
      message:
        'the prompt contains a NUL byte, which no argument can carry; use --snapshot instead',
    };
  }
  const args = agent === 'codex' ? ['-C', dir, '--', prompt] : [prompt];
  return {
    ok: true,
    plan: { command: binary, args, options: { cwd: dir, stdio: 'inherit', shell: false } },
  };
}

export interface OpenCommandInput {
  source: SessionSourceId;
  sessionId: string;
  jsonlPath: string;
  /** The session was opened with --file, so the command names the file too. */
  byFile: boolean;
  step: number | string;
  mode: ResumeMode;
}

/**
 * The `agent-tree ... --open` command a user can paste into their own terminal.
 * An id prefix is used only when the file name carries the id: a transcript
 * without a UUID gets a path hash as its id, which no prefix lookup finds.
 */
export function formatOpenCommand(input: OpenCommandInput): string {
  const findable = basename(input.jsonlPath).toLowerCase().includes(input.sessionId.toLowerCase());
  const selector =
    input.byFile || !findable
      ? `--file '${input.jsonlPath.replace(/'/g, "'\\''")}'`
      : input.sessionId.slice(0, 8);
  return `agent-tree --source ${input.source} ${selector} --open ${input.step} --mode ${input.mode}`;
}
