/**
 * Path-safety helpers — defense for sinks that spawn subprocesses or compose
 * filesystem paths from untrusted input.
 *
 * Threat model: Claude Code session JSONLs include user-pasted content (a
 * `cwd` field on every event), and MCP tool callers can pass arbitrary
 * `cwd` strings. Both flow into `getGitContext` which spawns `git` — and
 * `git` will auto-execute `core.pager` / `core.fsmonitor` hooks from a
 * poisoned `.git/config` (CVE-2022-24765) when the user has weakened
 * `safe.directory` (e.g. set to `*`, common on dev boxes).
 */

import { realpath } from 'node:fs/promises';
import { isAbsolute } from 'node:path';

/**
 * Resolve a cwd value safe to feed to `getGitContext`. Both candidates can
 * come from untrusted sources — `eventsCwd` is extracted from JSONL stream
 * (user-paste vector) and `callerCwd` is the MCP tool's `cwd` argument.
 *
 * Mitigations:
 *   - reject non-absolute paths (relative could escape via `..`)
 *   - reject null bytes (path-truncation tricks)
 *   - resolve symlinks via `realpath` (detects symlink-to-/etc style escapes)
 *
 * Returns the first trustworthy candidate, or `null` to skip git context
 * entirely if neither is safe.
 */
export async function safeGitCwd(
  eventsCwd: string | undefined,
  callerCwd: string,
): Promise<string | null> {
  for (const candidate of [eventsCwd, callerCwd]) {
    if (!candidate || candidate.includes('\0') || !isAbsolute(candidate)) {
      continue;
    }
    try {
      const real = await realpath(candidate);
      if (isAbsolute(real)) return real;
    } catch {
      // path doesn't exist / not readable — try next candidate
    }
  }
  return null;
}
