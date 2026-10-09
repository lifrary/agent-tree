import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { readJsonl } from '../reader/jsonl.js';
import { isFullUuid, isSameDirectory, lstatIfPresent, readDirectory } from './files.js';
import type { DiscoverOptions, SessionEntry, SessionSource } from './types.js';

export function getProjectsRoot(): string {
  return resolve(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'projects');
}

/** Claude's project encoding is lossy; it is a hint, not a reversible cwd. */
export function encodeProjectPath(absPath: string): string {
  return absPath.replace(/[^a-zA-Z0-9]/g, '-');
}

async function discover(opts: DiscoverOptions): Promise<SessionEntry[]> {
  const root = resolve(opts.root ?? getProjectsRoot());
  const rootInfo = await lstatIfPresent(root);
  if (!rootInfo?.isDirectory()) return [];
  const projectDirs = opts.projectCwd === undefined
    ? (await readDirectory(root)).filter((entry) => entry.isDirectory()).map((entry) => entry.name)
    : [encodeProjectPath(opts.projectCwd)];
  const sessions: SessionEntry[] = [];
  for (const projectDir of projectDirs) {
    if (!projectDir) continue;
    const projectPath = join(root, projectDir);
    const projectInfo = await lstatIfPresent(projectPath);
    if (!projectInfo?.isDirectory()) continue;
    const projectSessions: SessionEntry[] = [];
    for (const file of await readDirectory(projectPath)) {
      if (!file.isFile() || !file.name.endsWith('.jsonl')) continue;
      const sessionId = file.name.slice(0, -'.jsonl'.length);
      if (!isFullUuid(sessionId)) continue;
      const jsonlPath = join(projectPath, file.name);
      const info = await lstatIfPresent(jsonlPath);
      if (!info?.isFile()) continue;
      projectSessions.push({ source: 'claude', sessionId, projectDir, jsonlPath,
        mtimeMs: info.mtimeMs, sizeBytes: info.size });
    }
    if (await isSameDirectory(projectPath, projectInfo)) sessions.push(...projectSessions);
  }
  return await isSameDirectory(root, rootInfo) ? sessions : [];
}

export const claudeSource: SessionSource = {
  id: 'claude',
  discover,
  accepts: (record) =>
    (typeof record.uuid === 'string' && typeof record.type === 'string') ||
    record.type === 'permission-mode' ||
    (typeof record.sessionId === 'string' && typeof record.type === 'string'),
  read: readJsonl,
};
