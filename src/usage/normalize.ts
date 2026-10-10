/**
 * Token counts from one model call, normalized across sources. Claude Code's
 * `input_tokens` excludes cache reads and writes; Codex's `input_tokens`
 * already includes `cached_input_tokens`. Both become one `prompt_tokens`.
 *
 * Any shape these functions do not recognize returns null: the call is "no
 * data", never zero, and never a strict-mode error, because both agents keep
 * changing their logs.
 */

export interface CallTokens {
  prompt_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/** Absent is zero; present but not a count makes the whole call unrecognized. */
function optionalCount(value: unknown): number | null {
  return value === undefined || value === null ? 0 : count(value);
}

/** Claude Code `message.usage`. */
export function claudeCallTokens(usage: unknown): CallTokens | null {
  if (!isRecord(usage)) return null;
  const input = count(usage.input_tokens);
  const output = count(usage.output_tokens);
  const cacheWrite = optionalCount(usage.cache_creation_input_tokens);
  const cacheRead = optionalCount(usage.cache_read_input_tokens);
  const details = usage.output_tokens_details;
  const thinking = optionalCount(isRecord(details) ? details.thinking_tokens : undefined);
  if (input === null || output === null || cacheWrite === null || cacheRead === null) return null;
  if (thinking === null) return null;
  return {
    prompt_tokens: input + cacheWrite + cacheRead,
    cache_read_tokens: cacheRead,
    cache_write_tokens: cacheWrite,
    output_tokens: output,
    reasoning_tokens: thinking,
  };
}

/** Codex `last_token_usage` (token_count) or `usage` (token_usage_record). */
export function codexCallTokens(usage: unknown): CallTokens | null {
  if (!isRecord(usage)) return null;
  const input = count(usage.input_tokens);
  const output = count(usage.output_tokens);
  const cached = optionalCount(usage.cached_input_tokens);
  const cacheWrite = optionalCount(usage.cache_write_input_tokens);
  const reasoning = optionalCount(usage.reasoning_output_tokens);
  if (input === null || output === null || cached === null) return null;
  if (cacheWrite === null || reasoning === null) return null;
  return {
    prompt_tokens: input,
    cache_read_tokens: cached,
    cache_write_tokens: cacheWrite,
    output_tokens: output,
    reasoning_tokens: reasoning,
  };
}

/** Identity of a Codex cumulative total, to drop a response reported twice. */
export function codexTotalKey(total: unknown): string | null {
  if (!isRecord(total)) return null;
  const fields = [
    'input_tokens',
    'cached_input_tokens',
    'cache_write_input_tokens',
    'output_tokens',
    'reasoning_output_tokens',
    'total_tokens',
  ].map((key) => (total[key] === undefined ? null : count(total[key])));
  return fields.every((field) => field === null) ? null : fields.join(',');
}

export function contextWindow(value: unknown): number | null {
  const window = count(value);
  return window !== null && window > 0 ? window : null;
}
