/**
 * Cross-platform clipboard helper — best-effort, non-fatal.
 *
 * Used by the snapshot/TUI flow so the user gets "✓ copied" feedback instead
 * of having to remember `| pbcopy` themselves. Falls back silently when no
 * clipboard tool is available (CI, headless Linux, etc.) — the markdown is
 * still on stdout, so piping always works.
 */

import { spawn } from 'node:child_process';
import { platform } from 'node:os';

export interface ClipboardResult {
  ok: boolean;
  command?: string;
  reason?: string;
}

/**
 * Pipe `text` to a platform-appropriate clipboard daemon. Returns once the
 * child has been spawned and stdin is closed. Resolves to `{ok:false}` on any
 * error so the caller can degrade gracefully.
 */
export function copyToClipboard(text: string): Promise<ClipboardResult> {
  const cmd = pickCommand();
  if (!cmd) return Promise.resolve({ ok: false, reason: 'no clipboard tool detected' });

  return new Promise((resolve) => {
    try {
      const child = spawn(cmd.command, cmd.args, { stdio: ['pipe', 'ignore', 'ignore'] });
      child.on('error', (err) => {
        resolve({ ok: false, command: cmd.command, reason: err.message });
      });
      child.on('exit', (code) => {
        if (code === 0) resolve({ ok: true, command: cmd.command });
        else resolve({ ok: false, command: cmd.command, reason: `exit ${code}` });
      });
      child.stdin?.end(text, 'utf8');
    } catch (err) {
      resolve({
        ok: false,
        command: cmd.command,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  });
}

interface ClipboardCommand {
  command: string;
  args: string[];
}

function pickCommand(): ClipboardCommand | null {
  const plat = platform();
  switch (plat) {
    case 'darwin':
      return { command: 'pbcopy', args: [] };
    case 'win32':
      return { command: 'clip', args: [] };
    default:
      // Linux / BSD — try wl-copy first (Wayland), then xclip, then xsel.
      // We can't easily probe for installed binaries cheaply here, so just
      // pick xclip — most common, fails silently if absent.
      return { command: 'xclip', args: ['-selection', 'clipboard'] };
  }
}
