/**
 * Git context probe — collects branch / recent commits / dirty status for the
 * snapshot's source cwd so a fresh `claude` session pasted with the snapshot
 * markdown knows what state the original session was working against.
 *
 * Best-effort: any failure (no git, missing dir, detached HEAD) yields a
 * partial result. Never throws; never blocks.
 */

import { spawn } from 'node:child_process';

export interface GitContext {
  cwd: string;
  available: boolean;
  branch?: string;
  shortHead?: string;
  recentCommits?: string[]; // up to 3, oneline
  status?: string; // condensed `git status -s` (truncated)
  reason?: string; // when `available === false`
}

const TIMEOUT_MS = 1500;

export async function getGitContext(cwd: string): Promise<GitContext> {
  if (!cwd) return { cwd, available: false, reason: 'no cwd' };

  // Probe `git rev-parse --is-inside-work-tree` first to short-circuit when
  // the directory isn't a git repo.
  const inside = await runGit(cwd, ['rev-parse', '--is-inside-work-tree']);
  if (!inside.ok || inside.stdout.trim() !== 'true') {
    return { cwd, available: false, reason: 'not a git repo' };
  }

  // Run the rest in parallel — they're all read-only and quick.
  const [branchR, headR, logR, statusR] = await Promise.all([
    runGit(cwd, ['symbolic-ref', '--short', 'HEAD']),
    runGit(cwd, ['rev-parse', '--short', 'HEAD']),
    runGit(cwd, ['log', '-3', '--pretty=format:%h %s']),
    runGit(cwd, ['status', '--short']),
  ]);

  return {
    cwd,
    available: true,
    branch: branchR.ok ? branchR.stdout.trim() : '(detached)',
    shortHead: headR.ok ? headR.stdout.trim() : undefined,
    recentCommits: logR.ok
      ? logR.stdout
          .split('\n')
          .map((l) => l.trim())
          .filter((l) => l.length > 0)
      : undefined,
    status: statusR.ok ? truncate(statusR.stdout.trim(), 800) : undefined,
  };
}

interface RunResult {
  ok: boolean;
  stdout: string;
}

function runGit(cwd: string, args: string[]): Promise<RunResult> {
  return new Promise((resolve) => {
    let settled = false;
    const child = spawn('git', args, { cwd, stdio: ['ignore', 'pipe', 'ignore'] });
    let stdout = '';
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        child.kill();
      } catch {
        // ignore
      }
      resolve({ ok: false, stdout: '' });
    }, TIMEOUT_MS);

    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.on('error', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: false, stdout: '' });
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: code === 0, stdout });
    });
  });
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max - 1)) + '…';
}

export function formatGitContextMarkdown(ctx: GitContext): string | null {
  if (!ctx.available) return null;
  const lines: string[] = [];
  lines.push('## Git context (at snapshot time)');
  if (ctx.branch) lines.push(`- branch: \`${ctx.branch}\``);
  if (ctx.shortHead) lines.push(`- HEAD: \`${ctx.shortHead}\``);
  if (ctx.recentCommits && ctx.recentCommits.length > 0) {
    lines.push('- recent commits:');
    for (const c of ctx.recentCommits) lines.push(`  - \`${c}\``);
  }
  if (ctx.status && ctx.status.length > 0) {
    lines.push('- working tree:');
    lines.push('  ```');
    for (const line of ctx.status.split('\n').slice(0, 20)) {
      lines.push(`  ${line}`);
    }
    lines.push('  ```');
  } else if (ctx.status === '') {
    lines.push('- working tree: clean');
  }
  return lines.join('\n');
}
