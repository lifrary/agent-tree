/**
 * Interactive session picker — SPEC §17.2 `--pick`
 *
 * Lists the N most-recently-modified sessions across every project under
 * ~/.claude/projects/ and prompts the user for a number. Returns the chosen
 * SessionMatch or null on abort (Ctrl-C / empty input / invalid selection).
 */

import { readdir, stat } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { join } from 'node:path';

import { CLAUDE_PROJECTS_ROOT, type SessionMatch } from './session_path.js';

export interface PickOptions {
  limit?: number; // default 10
  projectsRoot?: string;
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
}

export async function pickSession(
  opts: PickOptions = {},
): Promise<SessionMatch | null> {
  const limit = opts.limit ?? 10;
  const candidates = await listRecentSessions(
    opts.projectsRoot ?? CLAUDE_PROJECTS_ROOT,
    limit,
  );
  if (candidates.length === 0) return null;

  const out = opts.output ?? process.stderr;
  out.write('Recent Claude Code sessions:\n');
  candidates.forEach((c, i) => {
    const when = new Date(c.mtimeMs).toISOString().replace('T', ' ').slice(0, 16);
    out.write(
      `  ${String(i + 1).padStart(2, ' ')}. ${c.sessionId.slice(0, 8)}  ${when}  ${c.projectDir}\n`,
    );
  });

  const rl = createInterface({
    input: opts.input ?? process.stdin,
    output: opts.output ?? process.stderr,
  });
  const answer = (await rl.question('Pick a number (blank to cancel): ')).trim();
  rl.close();
  if (answer.length === 0) return null;
  const idx = parseInt(answer, 10);
  if (Number.isNaN(idx) || idx < 1 || idx > candidates.length) return null;
  const picked = candidates[idx - 1];
  return {
    sessionId: picked.sessionId,
    projectDir: picked.projectDir,
    jsonlPath: picked.jsonlPath,
  };
}

interface Candidate extends SessionMatch {
  mtimeMs: number;
}

async function listRecentSessions(
  root: string,
  limit: number,
): Promise<Candidate[]> {
  const projectDirs = await safeReaddir(root);
  const out: Candidate[] = [];
  for (const projectDir of projectDirs) {
    const projectPath = join(root, projectDir);
    const files = await safeReaddir(projectPath);
    for (const fname of files) {
      if (!fname.endsWith('.jsonl')) continue;
      const jsonlPath = join(projectPath, fname);
      let mtimeMs = 0;
      try {
        mtimeMs = (await stat(jsonlPath)).mtimeMs;
      } catch {
        continue;
      }
      out.push({
        sessionId: fname.slice(0, -'.jsonl'.length),
        projectDir,
        jsonlPath,
        mtimeMs,
      });
    }
  }
  out.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return out.slice(0, limit);
}

async function safeReaddir(p: string): Promise<string[]> {
  try {
    return await readdir(p);
  } catch {
    return [];
  }
}
