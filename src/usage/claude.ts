/**
 * Claude Code usage from the main transcript's own events.
 *
 * One API response is written as several assistant records (one per content
 * block), each repeating the same `message.id` and the same usage, so a call
 * is counted once, at its first record. Records from `<synthetic>` (locally
 * generated) are not calls. Inline sidechain records, which older Claude Code
 * versions wrote into the main file, are subagent work and stay out of the
 * main numbers.
 */

import type { UsageSample } from '../sources/types.js';
import type { RawEvent } from '../types.js';
import { claudeCallTokens, isRecord, type CallTokens } from './normalize.js';
import type { CompactionAt, SubagentUsageAt } from './types.js';

export interface ClaudeCall {
  key: string;
  tokens: CallTokens;
  timestamp: string;
}

/**
 * The deduplicated calls in a stream of Claude Code records. Shared by the
 * main transcript and subagent transcripts; `seen` spans one session.
 */
export function claudeCall(record: Record<string, unknown>, seen: Set<string>): ClaudeCall | null {
  if (record.type !== 'assistant' || !isRecord(record.message)) return null;
  const message = record.message;
  if (message.model === '<synthetic>') return null;
  const tokens = claudeCallTokens(message.usage);
  if (!tokens) return null;
  const key =
    nonEmpty(message.id) ?? nonEmpty(record.requestId) ?? nonEmpty(record.uuid) ?? undefined;
  if (key === undefined || seen.has(key)) return null;
  seen.add(key);
  const timestamp = typeof record.timestamp === 'string' ? record.timestamp : '';
  return { key, tokens, timestamp };
}

function nonEmpty(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

export interface ClaudeMainUsage {
  samples: UsageSample[];
  compactions: CompactionAt[];
  /** Inline sidechain calls, grouped per agent. */
  sidechains: SubagentUsageAt[];
}

/** `seen` collects the calls counted here, for the subagent pass that follows. */
export function claudeMainUsage(events: RawEvent[], seen: Set<string>): ClaudeMainUsage {
  const samples: UsageSample[] = [];
  const compactions: CompactionAt[] = [];
  const sidechains = new Map<string, SubagentUsageAt>();
  for (const event of events) {
    if (event.type === 'system') {
      const compaction = compactBoundary(event.payload);
      if (compaction) compactions.push({ eventUuid: event.uuid, ...compaction });
      continue;
    }
    const call = claudeCall(event as unknown as Record<string, unknown>, seen);
    if (!call) continue;
    if (event.isSidechain) {
      const record = event as unknown as Record<string, unknown>;
      const agentId = nonEmpty(record.agentId) ?? 'sidechain';
      const agent = sidechains.get(agentId) ?? {
        agentId,
        eventUuid: event.uuid,
        calls: 0,
        prompt_tokens: 0,
        output_tokens: 0,
      };
      agent.calls += 1;
      agent.prompt_tokens += call.tokens.prompt_tokens;
      agent.output_tokens += call.tokens.output_tokens;
      sidechains.set(agentId, agent);
      continue;
    }
    samples.push({
      eventUuid: event.uuid,
      timestamp: call.timestamp,
      ...call.tokens,
      context_window: null,
    });
  }
  return { samples, compactions, sidechains: [...sidechains.values()] };
}

function compactBoundary(payload: Record<string, unknown>): Omit<CompactionAt, 'eventUuid'> | null {
  if (payload.subtype !== 'compact_boundary') return null;
  const meta = isRecord(payload.compactMetadata) ? payload.compactMetadata : {};
  return {
    pre_tokens: tokenCount(meta.preTokens),
    post_tokens: tokenCount(meta.postTokens),
    trigger: typeof meta.trigger === 'string' && meta.trigger ? meta.trigger : 'unknown',
  };
}

function tokenCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}
