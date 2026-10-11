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
  const projectDirs =
    opts.projectCwd === undefined
      ? (await readDirectory(root))
          .filter((entry) => entry.isDirectory())
          .map((entry) => entry.name)
      : [encodeProjectPath(opts.projectCwd)];
  const sessions: SessionEntry[] = [];
  for (const projectDir of projectDirs) {
    if (!projectDir) continue;
    const projectPath = join(root, projectDir);
    const projectInfo = await lstatIfPresent(projectPath);
    if (!projectInfo?.isDirectory()) continue;
    const projectSessions: SessionEntry[] = [];
    for (const file of await readDirectory(projectPath)) {
      if (opts.includeSubagents && file.isDirectory() && isFullUuid(file.name)) {
        projectSessions.push(...(await discoverChildren(projectPath, projectDir, file.name)));
      }
      if (!file.isFile() || !file.name.endsWith('.jsonl')) continue;
      const sessionId = file.name.slice(0, -'.jsonl'.length);
      if (!isFullUuid(sessionId)) continue;
      const jsonlPath = join(projectPath, file.name);
      const info = await lstatIfPresent(jsonlPath);
      if (!info?.isFile()) continue;
      projectSessions.push({
        source: 'claude',
        sessionId,
        projectDir,
        jsonlPath,
        mtimeMs: info.mtimeMs,
        sizeBytes: info.size,
      });
    }
    if (await isSameDirectory(projectPath, projectInfo)) {
      for (const session of projectSessions) sessions.push(session);
    }
  }
  return (await isSameDirectory(root, rootInfo)) ? sessions : [];
}

async function discoverChildren(
  projectPath: string,
  projectDir: string,
  parentSessionId: string,
): Promise<SessionEntry[]> {
  const parent = join(projectPath, parentSessionId);
  const parentInfo = await lstatIfPresent(parent);
  if (!parentInfo?.isDirectory()) return [];
  const directory = join(parent, 'subagents');
  const original = await lstatIfPresent(directory);
  if (!original?.isDirectory()) return [];
  const children: SessionEntry[] = [];
  for (const file of await readDirectory(directory)) {
    const match = /^agent-([A-Za-z0-9_-]{1,128})\.jsonl$/.exec(file.name);
    if (!file.isFile() || !match) continue;
    const jsonlPath = join(directory, file.name);
    const info = await lstatIfPresent(jsonlPath);
    if (!info?.isFile()) continue;
    const metadata = await readChildMeta(join(directory, `agent-${match[1]}.meta.json`));
    children.push({
      source: 'claude',
      sessionId: `agent-${match[1]}`,
      projectDir,
      jsonlPath,
      mtimeMs: info.mtimeMs,
      sizeBytes: info.size,
      subagent: { id: match[1], parentSessionId, ...metadata },
    });
  }
  return (await isSameDirectory(parent, parentInfo)) && (await isSameDirectory(directory, original))
    ? children
    : [];
}

async function readChildMeta(
  path: string,
): Promise<{ toolUseId?: string; parentAgentId?: string }> {
  try {
    const handle = await open(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size > 1024 * 1024) return {};
      const buffer = Buffer.alloc(1024 * 1024 + 1);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      if (bytesRead > 1024 * 1024) return {};
      const meta: unknown = JSON.parse(buffer.toString('utf8', 0, bytesRead));
      if (typeof meta !== 'object' || !meta || Array.isArray(meta)) return {};
      const record = meta as Record<string, unknown>;
      return {
        ...(typeof record.toolUseId === 'string' && record.toolUseId
          ? { toolUseId: record.toolUseId }
          : {}),
        ...(typeof record.parentAgentId === 'string' &&
        /^[A-Za-z0-9_-]{1,128}$/.test(record.parentAgentId)
          ? { parentAgentId: record.parentAgentId }
          : {}),
      };
    } finally {
      await handle.close();
    }
  } catch {
    // Metadata is optional: the child remains searchable without a proven parent step.
    return {};
  }
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
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
