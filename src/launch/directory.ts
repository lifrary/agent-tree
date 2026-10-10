/** Choose the directory --open starts the agent in. */
import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { MindMapNode, SessionGraph } from '../types.js';
import { safeGitCwd } from '../utils/safe_path.js';

export type DirectoryResult = { ok: true; dir: string } | { ok: false; message: string };

/**
 * `--open-dir` wins. Otherwise the step's most recent event that recorded a
 * cwd decides (a session may change directory), then the session's first
 * event. The path must pass the same checks git context uses (absolute, no
 * NUL, resolvable) and name a directory; a missing one is refused, never
 * swapped for another, so the agent cannot start somewhere unexpected.
 */
export async function resolveLaunchDir(
  graph: SessionGraph,
  node: MindMapNode,
  openDir: string | undefined,
): Promise<DirectoryResult> {
  if (openDir !== undefined) {
    const wanted = resolve(openDir);
    const dir = await existingDirectory(wanted);
    return dir
      ? { ok: true, dir }
      : {
          ok: false,
          message: `--open-dir is not an existing directory: ${JSON.stringify(wanted)}`,
        };
  }
  const recorded = stepCwd(graph, node) ?? graph.events[0]?.cwd;
  if (!recorded) {
    return {
      ok: false,
      message: 'the session records no working directory; choose one with --open-dir <dir>',
    };
  }
  const dir = await existingDirectory(recorded);
  if (!dir) {
    return {
      ok: false,
      message:
        `the step's directory no longer exists: ${JSON.stringify(recorded)}; ` +
        'choose one with --open-dir <dir>',
    };
  }
  return { ok: true, dir };
}

function stepCwd(graph: SessionGraph, node: MindMapNode): string | undefined {
  const members = new Set(node.event_uuids);
  for (let i = graph.events.length - 1; i >= 0; i--) {
    const event = graph.events[i];
    if (members.has(event.uuid) && event.cwd) return event.cwd;
  }
  return undefined;
}

/** The resolved path when it passes the git-context checks and is a directory. */
async function existingDirectory(path: string): Promise<string | null> {
  const real = await safeGitCwd(path, '');
  if (!real) return null;
  try {
    return (await stat(real)).isDirectory() ? real : null;
  } catch {
    return null;
  }
}
