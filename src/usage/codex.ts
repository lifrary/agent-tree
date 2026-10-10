/**
 * Codex usage samples, collected while the reader streams a rollout.
 *
 * Two record kinds log the same calls. Newer CLIs (0.155 onward) also write
 * `token_usage_record` (one per response, unique `response_id`); every
 * version writes `event_msg` `token_count`, which repeats a response whenever
 * its cumulative total did not move. A file with any token_usage_record uses those alone; otherwise the
 * token_count events minus repeats. `rate_limits`, a sibling of `info` in
 * token_count, is account data and is never read.
 */

import type { UsageSample } from '../sources/types.js';
import type { RawEvent } from '../types.js';
import { codexCallTokens, codexTotalKey, contextWindow, isRecord } from './normalize.js';
import type { CompactionAt } from './types.js';

/** A sample before its event is known: `after` indexes the last event candidate. */
interface PendingSample extends Omit<UsageSample, 'eventUuid'> {
  after: number;
}

export interface CodexUsageCollector {
  tokenUsageRecord(payload: unknown, timestamp: string, after: number): void;
  tokenCount(payload: Record<string, unknown>, timestamp: string, after: number): void;
  /** Resolve each sample's event once fallback suppression has run. */
  finish(eventAt: (after: number) => string | null): UsageSample[];
  /** Usage records whose shape was not recognized and were skipped. */
  readonly unrecognized: number;
}

export function createCodexUsageCollector(): CodexUsageCollector {
  const records: PendingSample[] = [];
  const counts: PendingSample[] = [];
  const responses = new Set<string>();
  // Records precede the token_count of the same response, which carries the
  // context window the record lacks.
  let awaitingWindow: PendingSample[] = [];
  let latestWindow: number | null = null;
  let previousTotal: string | null = null;
  let unrecognized = 0;

  return {
    get unrecognized() {
      return unrecognized;
    },
    tokenUsageRecord(payload, timestamp, after) {
      if (!isRecord(payload)) {
        unrecognized += 1;
        return;
      }
      const responseId = typeof payload.response_id === 'string' ? payload.response_id : '';
      if (responseId && responses.has(responseId)) return;
      const tokens = codexCallTokens(payload.usage);
      if (!tokens) {
        unrecognized += 1;
        return;
      }
      if (responseId) responses.add(responseId);
      const sample = { ...tokens, timestamp, context_window: latestWindow, after };
      records.push(sample);
      awaitingWindow.push(sample);
    },
    tokenCount(payload, timestamp, after) {
      const info = payload.info;
      if (info === null || info === undefined) return;
      if (!isRecord(info)) {
        unrecognized += 1;
        return;
      }
      const window = contextWindow(info.model_context_window);
      if (window !== null) {
        latestWindow = window;
        for (const sample of awaitingWindow) sample.context_window = window;
        awaitingWindow = [];
      }
      const total = codexTotalKey(info.total_token_usage);
      if (total !== null && total === previousTotal) return;
      if (total !== null) previousTotal = total;
      const tokens = codexCallTokens(info.last_token_usage);
      if (!tokens) {
        unrecognized += 1;
        return;
      }
      counts.push({ ...tokens, timestamp, context_window: window ?? latestWindow, after });
    },
    finish(eventAt) {
      return (records.length > 0 ? records : counts).map(({ after, ...sample }) => ({
        ...sample,
        eventUuid: eventAt(after),
      }));
    },
  };
}

/** The reader turns `compacted` records into compaction events; they log no token counts. */
export function codexCompactions(events: RawEvent[]): CompactionAt[] {
  const compactions: CompactionAt[] = [];
  for (const event of events) {
    if (event.type === 'system' && event.payload.type === 'compaction') {
      compactions.push({
        eventUuid: event.uuid,
        pre_tokens: null,
        post_tokens: null,
        trigger: 'unknown',
      });
    }
  }
  return compactions;
}
