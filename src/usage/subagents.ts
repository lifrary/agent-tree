/**
 * Claude Code subagent usage. Claude Code writes each subagent's transcript to
 * `<dir of the session file>/<session>/subagents/agent-<id>.jsonl`, with a
 * sidecar `agent-<id>.meta.json` whose `toolUseId` names the Agent tool_use
 * block that started it. Only usage fields are read from these files; their
 * text never leaves this module.
 *
 * Linking, in order: the sidecar's `toolUseId` to the main assistant event
 * holding that tool_use; the sidecar's `parentAgentId` to the parent agent's
 * link (nested subagents); a main user record whose `toolUseResult.agentId`
 * names the agent. An agent nothing links stays session-level (null).
 */

import { createHash } from 'node:crypto';
import { constants, type Stats } from 'node:fs';
import { open, type FileHandle } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { isMissingPath, lstatIfPresent, readDirectory } from '../sources/files.js';
import type { RawEvent } from '../types.js';
import type { Logger } from '../utils/logger.js';
import { claudeCall } from './claude.js';
import { isRecord } from './normalize.js';
import type { SubagentUsageAt } from './types.js';

const AGENT_FILE = /^agent-([A-Za-z0-9_-]{1,128})\.jsonl$/;

/** Where Claude Code keeps a session's subagent transcripts. */
export function subagentFolder(jsonlPath: string): string {
  return join(dirname(jsonlPath), basename(jsonlPath, '.jsonl'), 'subagents');
}

/**
 * A hash of the subagent folder's file names, sizes and modification times,
 * so a cache keyed on the main transcript also notices a subagent that is
 * still writing. One directory listing and one lstat per file; '' when there
 * is no folder.
 */
export async function subagentSignature(jsonlPath: string): Promise<string> {
  const directory = subagentFolder(jsonlPath);
  try {
    const info = await lstatIfPresent(directory);
    if (!info?.isDirectory()) return '';
    const hash = createHash('sha256');
    const names = (await readDirectory(directory))
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .sort();
    for (const name of names) {
      const file = await lstatIfPresent(join(directory, name));
      if (file) hash.update(`${name}\0${file.size}\0${file.mtimeMs}\0`);
    }
    return hash.digest('hex');
  } catch {
    return 'unreadable';
  }
}
const META_LIMIT = 1024 * 1024;
const CHUNK_BYTES = 1024 * 1024;
const NEWLINE = 0x0a;
const USAGE_KEY = Buffer.from('"usage"');

interface AgentFile {
  id: string;
  calls: number;
  prompt_tokens: number;
  output_tokens: number;
  toolUseId: string | null;
  parentAgentId: string | null;
}

/**
 * Undefined when the session has no readable subagent folder: "no data", not
 * zero agents. `seen` holds the main transcript's calls, which a forked
 * subagent's transcript repeats.
 */
export async function readClaudeSubagents(
  jsonlPath: string,
  events: RawEvent[],
  seen: Set<string>,
  logger?: Logger,
): Promise<SubagentUsageAt[] | undefined> {
  const directory = subagentFolder(jsonlPath);
  let names: string[];
  try {
    const info = await lstatIfPresent(directory);
    if (!info?.isDirectory()) return undefined;
    names = (await readDirectory(directory))
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    // Usage is optional data: an unreadable folder must never fail the tree.
    logger?.debug('skipped an unreadable subagent folder', {
      code: (error as NodeJS.ErrnoException | null)?.code,
    });
    return undefined;
  }
  const agents: AgentFile[] = [];
  for (const name of names) {
    const match = AGENT_FILE.exec(name);
    if (!match) continue;
    try {
      const totals = await readAgentUsage(join(directory, name), seen);
      if (!totals) continue;
      const meta = await readAgentMeta(join(directory, `agent-${match[1]}.meta.json`));
      agents.push({ id: match[1], ...totals, ...meta });
    } catch (error) {
      if (!isMissingPath(error)) {
        logger?.debug('skipped an unreadable subagent transcript', {
          code: (error as NodeJS.ErrnoException | null)?.code,
        });
      }
    }
  }
  if (agents.length === 0) return undefined;
  const link = linker(events, agents);
  return agents.map((agent) => ({
    agentId: agent.id,
    eventUuid: link(agent.id),
    calls: agent.calls,
    prompt_tokens: agent.prompt_tokens,
    output_tokens: agent.output_tokens,
  }));
}

/** Opens only a regular file, never through a symlink, never blocking on a FIFO. */
async function openRegular(path: string): Promise<{ handle: FileHandle; info: Stats } | null> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  const info = await handle.stat();
  if (!info.isFile()) {
    await handle.close();
    return null;
  }
  return { handle, info };
}

async function readAgentUsage(
  path: string,
  seen: Set<string>,
): Promise<Pick<AgentFile, 'calls' | 'prompt_tokens' | 'output_tokens'> | null> {
  const opened = await openRegular(path);
  if (!opened) return null;
  const totals = { calls: 0, prompt_tokens: 0, output_tokens: 0 };
  try {
    for await (const line of linesContaining(opened.handle, USAGE_KEY)) {
      let record: unknown;
      try {
        record = JSON.parse(line);
      } catch {
        continue;
      }
      if (!isRecord(record)) continue;
      const call = claudeCall(record, seen);
      if (!call) continue;
      totals.calls += 1;
      totals.prompt_tokens += call.tokens.prompt_tokens;
      totals.output_tokens += call.tokens.output_tokens;
    }
  } finally {
    await opened.handle.close().catch(() => undefined);
  }
  return totals;
}

/**
 * The lines holding `needle`, decoded one at a time. Only assistant records
 * carry usage and they are a small share of a transcript's bytes, so the rest
 * is never decoded or split: a byte scan reads a subagent folder of 411 MiB in
 * about a quarter of the time line splitting takes.
 */
async function* linesContaining(handle: FileHandle, needle: Buffer): AsyncGenerator<string> {
  const chunk = Buffer.allocUnsafe(CHUNK_BYTES);
  let carry = Buffer.alloc(0);
  for (;;) {
    const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
    const finished = bytesRead === 0;
    const data = finished ? carry : Buffer.concat([carry, chunk.subarray(0, bytesRead)]);
    // Only whole lines are scanned; a partial last line waits for the next chunk.
    const end = finished ? data.length : data.lastIndexOf(NEWLINE) + 1;
    let at = data.indexOf(needle);
    while (at !== -1 && at < end) {
      const start = data.lastIndexOf(NEWLINE, at) + 1;
      const stop = data.indexOf(NEWLINE, at);
      const lineEnd = stop === -1 || stop >= end ? end : stop;
      yield data.toString('utf8', start, lineEnd);
      at = data.indexOf(needle, lineEnd);
    }
    if (finished) return;
    carry = Buffer.from(data.subarray(end));
  }
}

async function readAgentMeta(
  path: string,
): Promise<Pick<AgentFile, 'toolUseId' | 'parentAgentId'>> {
  const none = { toolUseId: null, parentAgentId: null };
  let opened: Awaited<ReturnType<typeof openRegular>> = null;
  try {
    opened = await openRegular(path);
    if (!opened || opened.info.size > META_LIMIT) return none;
    const meta: unknown = JSON.parse(await opened.handle.readFile({ encoding: 'utf8' }));
    if (!isRecord(meta)) return none;
    return {
      toolUseId: typeof meta.toolUseId === 'string' && meta.toolUseId ? meta.toolUseId : null,
      parentAgentId:
        typeof meta.parentAgentId === 'string' && meta.parentAgentId ? meta.parentAgentId : null,
    };
  } catch {
    return none;
  } finally {
    await opened?.handle.close().catch(() => undefined);
  }
}

function linker(events: RawEvent[], agents: AgentFile[]): (id: string) => string | null {
  const toolUseEvent = new Map<string, string>();
  const resultEvent = new Map<string, string>();
  for (const event of events) {
    if (event.type === 'assistant' && Array.isArray(event.message.content)) {
      for (const block of event.message.content) {
        if (
          block.type === 'tool_use' &&
          typeof block.id === 'string' &&
          !toolUseEvent.has(block.id)
        )
          toolUseEvent.set(block.id, event.uuid);
      }
    } else if (event.type === 'user') {
      const result = (event as unknown as Record<string, unknown>).toolUseResult;
      if (
        isRecord(result) &&
        typeof result.agentId === 'string' &&
        !resultEvent.has(result.agentId)
      )
        resultEvent.set(result.agentId, event.uuid);
    }
  }
  const byId = new Map(agents.map((agent) => [agent.id, agent]));
  const resolve = (id: string, visiting: Set<string>): string | null => {
    const agent = byId.get(id);
    if (agent?.toolUseId && toolUseEvent.has(agent.toolUseId))
      return toolUseEvent.get(agent.toolUseId)!;
    if (agent?.parentAgentId && !visiting.has(id)) {
      visiting.add(id);
      const parent = resolve(agent.parentAgentId, visiting);
      if (parent !== null) return parent;
    }
    return resultEvent.get(id) ?? null;
  };
  return (id) => resolve(id, new Set());
}
