import type { RawEvent } from '../types.js';
import { isRecord } from '../usage/normalize.js';
import type { SessionEntry } from './types.js';

/** Only structured spawn evidence establishes a link; ancestry is resolved by callers. */
export function findSpawnEvent(events: RawEvent[], child: SessionEntry): string | null {
  const agent = child.subagent;
  if (!agent) return null;
  if (child.source === 'claude') {
    if (agent.toolUseId) {
      const calls: string[] = [];
      for (const event of events) {
        if (event.type !== 'assistant' || !Array.isArray(event.message.content)) continue;
        for (const block of event.message.content) {
          if (block.type === 'tool_use' && block.id === agent.toolUseId) calls.push(event.uuid);
        }
      }
      if (calls.length > 0) return calls.length === 1 ? calls[0] : null;
    }
    const results: string[] = [];
    for (const event of events) {
      if (event.type !== 'user') continue;
      const result = (event as unknown as Record<string, unknown>).toolUseResult;
      if (isRecord(result) && result.agentId === agent.id) results.push(event.uuid);
    }
    return results.length === 1 ? results[0] : null;
  }

  const calls = new Map<string, { uuid: string; index: number; count: number; spawn: boolean }>();
  // Scan every occurrence first: a reused call ID after its result is ambiguous too.
  for (const [index, event] of events.entries()) {
    if (event.type !== 'tool_use') continue;
    const spawn =
      event.tool_use.name === 'spawn_agent' || event.tool_use.name === 'functions.spawn_agent';
    const call = calls.get(event.tool_use.id);
    if (call) {
      call.count += 1;
      call.spawn ||= spawn;
    } else {
      calls.set(event.tool_use.id, { uuid: event.uuid, index, count: 1, spawn });
    }
  }
  const matches = new Map<string, string>();
  for (const [index, event] of events.entries()) {
    if (event.type === 'tool_result') {
      const call = calls.get(event.tool_result.tool_use_id);
      if (!call?.spawn || call.index >= index) continue;
      const result = spawnResult(event.tool_result.content);
      if (
        result &&
        [result.agent_id, result.thread_id].some(
          (id) => typeof id === 'string' && id.toLowerCase() === agent.id.toLowerCase(),
        )
      ) {
        if (call.count !== 1) return null;
        matches.set(event.tool_result.tool_use_id, call.uuid);
      }
    }
  }
  return matches.size === 1 ? matches.values().next().value! : null;
}

function spawnResult(content: unknown): Record<string, unknown> | null {
  if (Array.isArray(content)) {
    // The Codex reader projects public output blocks to plain text blocks.
    if (
      !content.every(
        (block) => isRecord(block) && block.type === 'text' && typeof block.text === 'string',
      )
    )
      return null;
    content = content.map((block: { text: string }) => block.text).join('');
  }
  if (typeof content === 'string') {
    try {
      content = JSON.parse(content);
    } catch {
      return null;
    }
  }
  return isRecord(content) ? content : null;
}
