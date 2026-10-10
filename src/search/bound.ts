/** Keeping a search report small enough for a model's context (the MCP reply). */
import type { SearchReport, SessionResult } from './types.js';

/**
 * A copy of `report` whose compact JSON fits `maxBytes`. Hits go first, from
 * the sessions holding the most, and are counted in `more_hits`; every session
 * keeps its first hit. Only then are the oldest sessions dropped, which
 * `total_sessions` still counts.
 */
export function boundReport(report: SearchReport, maxBytes: number): SearchReport {
  const results = report.results.map((result) => ({ ...result, hits: [...result.hits] }));
  const bounded: SearchReport = { ...report, results };
  let size = jsonBytes(bounded);
  while (size > maxBytes && results.length > 0) {
    const fullest = mostHits(results);
    const hit = fullest?.hits.pop();
    if (fullest && hit) {
      fullest.more_hits += 1;
      size -= jsonBytes(hit) + 1;
    } else {
      size -= jsonBytes(results.pop()) + 1;
    }
    // The estimate ignores digits gained by more_hits; confirm before stopping.
    if (size <= maxBytes) size = jsonBytes(bounded);
  }
  return bounded;
}

/** The session with the most hits beyond its first; the older one on a tie. */
function mostHits(results: SessionResult[]): SessionResult | undefined {
  let best: SessionResult | undefined;
  for (const result of results) {
    if (result.hits.length > 1 && (!best || result.hits.length >= best.hits.length)) best = result;
  }
  return best;
}

function jsonBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value) ?? '');
}
