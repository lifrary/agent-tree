/** Find an agent binary on PATH without running a shell. */
import { constants } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import { delimiter, isAbsolute, join } from 'node:path';

/**
 * First executable regular file named `name` in the PATH entries, as an
 * absolute path, or null. Empty and relative entries are skipped: a shell
 * reads them against the current directory, and --open starts the agent in a
 * directory taken from the transcript, so a planted `./claude` must not win.
 */
export async function findOnPath(
  name: string,
  pathEnv: string | undefined,
): Promise<string | null> {
  for (const dir of (pathEnv ?? '').split(delimiter)) {
    if (!dir || !isAbsolute(dir)) continue;
    const candidate = join(dir, name);
    try {
      if (!(await stat(candidate)).isFile()) continue;
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // missing or not executable: keep looking, as a shell would
    }
  }
  return null;
}
