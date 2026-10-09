/**
 * Interactive session picker — SPEC §17.2 `--pick`
 *
 * Lists the N most-recently-modified sessions under the configured projects
 * root and prompts the user for a number. Returns the chosen SessionMatch or
 * null on abort (Ctrl-C / EOF / empty input / invalid selection).
 */

import { createInterface } from 'node:readline/promises';

import { listSessions, type SessionMatch, type SessionSelection } from './session_path.js';
import { defaultRedactor, type Redactor } from './redact.js';

export interface PickOptions extends SessionSelection {
  limit?: number; // default 10
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  redactor?: Redactor;
}

export async function pickSession(opts: PickOptions = {}): Promise<SessionMatch | null> {
  const candidates = await listSessions({
    root: opts.root,
    source: opts.source,
    projectCwd: opts.projectCwd,
    limit: opts.limit ?? 10,
  });
  if (candidates.length === 0) return null;

  const out = opts.output ?? process.stderr;
  const redactor = opts.redactor ?? defaultRedactor();
  out.write(`Recent ${opts.source === 'codex' ? 'Codex' : 'Claude Code'} sessions:\n`);
  candidates.forEach((c, i) => {
    const when = new Date(c.mtimeMs).toISOString().replace('T', ' ').slice(0, 16);
    out.write(
      redactor.apply(
        `  ${String(i + 1).padStart(2, ' ')}. ${c.sessionId.slice(0, 8)}  ${when}  ${c.projectDir}\n`,
      ),
    );
  });

  const rl = createInterface({
    input: opts.input ?? process.stdin,
    output: opts.output ?? process.stderr,
  });
  const controller = new AbortController();
  const abort = () => controller.abort();
  rl.once('SIGINT', abort);
  rl.once('close', abort);

  try {
    const answer = (
      await rl.question('Pick a number (blank to cancel): ', {
        signal: controller.signal,
      })
    ).trim();
    if (!/^\d+$/.test(answer)) return null;
    const idx = Number(answer);
    if (!Number.isSafeInteger(idx) || idx < 1 || idx > candidates.length) {
      return null;
    }
    const picked = candidates[idx - 1];
    return {
      source: picked.source,
      sessionId: picked.sessionId,
      projectDir: picked.projectDir,
      jsonlPath: picked.jsonlPath,
    };
  } catch (error) {
    if (controller.signal.aborted && error instanceof Error && error.name === 'AbortError') {
      return null;
    }
    throw error;
  } finally {
    rl.off('SIGINT', abort);
    rl.off('close', abort);
    rl.close();
  }
}
