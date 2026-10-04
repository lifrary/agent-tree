/**
 * Anthropic SDK wrapper — SPEC §7.3 / §7.8
 *
 * Responsibilities:
 *   - Lazy import of @anthropic-ai/sdk (optionalDependency) — if the SDK isn't
 *     installed or the API key is absent, `createAnthropicClient` returns null
 *     and the caller falls back to the heuristic path.
 *   - Attach `cache_control: { type: 'ephemeral' }` to the system block so the
 *     Anthropic prompt cache (TTL 5 min) amortizes SYSTEM_PROMPT across every
 *     segment call in a single run.
 *   - Exact input preflight via messages.countTokens with the same prompt.
 *   - Optional custom retry/backoff, SDK retries disabled, 30s timeout.
 *   - Non-throwing contract: callSegmentLabel returns `{ ok: false, reason }`
 *     instead of throwing, so the labeler can degrade per segment without
 *     aborting the whole run.
 */

import type { LabelResponse } from './prompts.js';

/**
 * Minimal shape of the SDK methods we use. Real SDK matches; our tests inject
 * a compatible mock without importing the SDK itself.
 */
/**
 * Token counters from the real SDK use `number | null` (not `| undefined`) for
 * cache fields, so our mock-compatible shape has to accept both.
 */
export type MaybeNumber = number | null | undefined;

export interface AnthropicLike {
  messages: {
    countTokens(args: unknown): Promise<{ input_tokens: number }>;
    create(args: unknown): Promise<{
      content?: Array<{ type: string; text?: string }>;
      usage?: {
        input_tokens?: MaybeNumber;
        output_tokens?: MaybeNumber;
        cache_creation_input_tokens?: MaybeNumber;
        cache_read_input_tokens?: MaybeNumber;
      };
    }>;
  };
}

// ---------------------------------------------------------------------------
// Compile-time SDK compatibility guard — erased at runtime (`import type`).
// If Anthropic ever renames a response field we use or changes the
// messages.create/countTokens shapes, this function fails to typecheck and
// CI catches the drift before we ship.
//
// The function is exported ONLY so tsc+eslint don't flag it as dead code; it
// is never called. `@internal` hides it from API consumers of the bundle.
// ---------------------------------------------------------------------------
/** @internal — compile-time only, never called. */
export async function __sdkCompatibilityGuard(
  client: import('@anthropic-ai/sdk').default,
): Promise<void> {
  const request = buildLabelRequest({
    model: 'claude-sonnet-4-6',
    systemPrompt: 'sys',
    userMessage: 'user',
  });
  const count = await client.messages.countTokens(request);
  const _inputTokens: number = count.input_tokens;
  const res = await client.messages.create({
    ...request,
    max_tokens: 512,
  });
  // Fields we actually read in callSegmentLabel — compile error if SDK drops them.
  const _content: ReadonlyArray<{ type: string; text?: string }> | undefined = res.content;
  const _usage:
    | {
        input_tokens?: MaybeNumber;
        output_tokens?: MaybeNumber;
        cache_creation_input_tokens?: MaybeNumber;
        cache_read_input_tokens?: MaybeNumber;
      }
    | undefined = res.usage;
  void _content;
  void _usage;
  void _inputTokens;
}

export interface CreateClientOptions {
  apiKey?: string | undefined;
  timeoutMs?: number; // default 30_000
}

export async function createAnthropicClient(
  opts: CreateClientOptions = {},
): Promise<AnthropicLike | null> {
  const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  try {
    // Dynamic import keeps SDK truly optional. If the package isn't installed
    // (`--no-llm` users never need it) the import fails and we gracefully
    // return null.
    const mod = await import('@anthropic-ai/sdk').catch(() => null);
    if (!mod) return null;
    const Anthropic = (mod as { default?: unknown }).default ?? mod;
    const Ctor = Anthropic as unknown as new (cfg: {
      apiKey: string;
      timeout: number;
      maxRetries: number;
    }) => AnthropicLike;
    return new Ctor({ apiKey, timeout: opts.timeoutMs ?? 30_000, maxRetries: 0 });
  } catch {
    return null;
  }
}

export interface CallLabelInput {
  client: AnthropicLike;
  systemPrompt: string;
  userMessage: string;
  model: string;
  maxOutputTokens?: number; // default 512
  cache?: boolean;
  /**
   * Retries after the initial attempt; default 2. Failed attempts may be billed
   * without returning usage. The budgeted labeler sets this to 0.
   */
  maxRetries?: number;
  sleeper?: (ms: number) => Promise<void>; // DI for tests
}

export interface LabelUsage {
  inputTokens: number; // includes cache reads and writes
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

export type CallLabelResult =
  | {
      ok: true;
      label: LabelResponse;
      usage: LabelUsage;
    }
  | { ok: false; reason: string; usage?: LabelUsage };

function buildLabelRequest(
  inp: Pick<CallLabelInput, 'model' | 'systemPrompt' | 'userMessage' | 'cache'>,
) {
  return {
    model: inp.model,
    system: [
      {
        type: 'text' as const,
        text: inp.systemPrompt,
        ...(inp.cache !== false ? { cache_control: { type: 'ephemeral' as const } } : {}),
      },
    ],
    messages: [{ role: 'user' as const, content: inp.userMessage }],
  };
}

/** Fail closed: never substitute a character-based estimate for an API count. */
export async function countSegmentInputTokens(
  inp: CallLabelInput,
): Promise<{ ok: true; inputTokens: number } | { ok: false; reason: string }> {
  try {
    const count = await inp.client.messages.countTokens(buildLabelRequest(inp));
    if (!Number.isSafeInteger(count.input_tokens) || count.input_tokens < 0) {
      return { ok: false, reason: 'invalid input token count' };
    }
    return { ok: true, inputTokens: count.input_tokens };
  } catch (err) {
    return { ok: false, reason: `token count failed (${errMsg(err)})` };
  }
}

export async function callSegmentLabel(inp: CallLabelInput): Promise<CallLabelResult> {
  const maxOut = inp.maxOutputTokens ?? 512;
  const maxRetries = inp.maxRetries ?? 2;
  const sleeper = inp.sleeper ?? defaultSleep;

  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const response = await inp.client.messages.create({
        ...buildLabelRequest(inp),
        max_tokens: maxOut,
      });
      const cacheReadTokens = response.usage?.cache_read_input_tokens ?? 0;
      const cacheCreationTokens = response.usage?.cache_creation_input_tokens ?? 0;
      const usage: LabelUsage = {
        inputTokens: (response.usage?.input_tokens ?? 0) + cacheReadTokens + cacheCreationTokens,
        outputTokens: response.usage?.output_tokens ?? 0,
        cacheReadTokens,
        cacheCreationTokens,
      };

      const text = extractText(response);
      if (!text) {
        return { ok: false, reason: 'empty response content', usage };
      }

      const parsed = parseLabelJson(text);
      if (!parsed) {
        return {
          ok: false,
          reason: 'invalid label JSON',
          usage,
        };
      }

      return {
        ok: true,
        label: parsed,
        usage,
      };
    } catch (err) {
      lastErr = err;
      const status = extractStatus(err);
      if (status === 401 || status === 403) {
        return { ok: false, reason: `auth error (${status})` };
      }
      // Retry on 429 / 5xx / network with exponential backoff
      if (attempt < maxRetries && shouldRetry(status)) {
        const wait = 500 * 2 ** attempt;
        await sleeper(wait);
        continue;
      }
      break;
    }
  }

  return {
    ok: false,
    reason: `label request failed (${errMsg(lastErr)})`,
  };
}

function extractText(response: { content?: Array<{ type: string; text?: string }> }): string {
  if (!Array.isArray(response.content)) return '';
  return response.content
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text as string)
    .join('\n')
    .trim();
}

/** Strip markdown fences and parse the JSON object. Tolerant to prose wrappers. */
function parseLabelJson(text: string): LabelResponse | null {
  let candidate = text.trim();
  // Strip ```json fences
  const fenceMatch = candidate.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) candidate = fenceMatch[1].trim();
  // If the model prepended prose, locate the first {
  const firstBrace = candidate.indexOf('{');
  const lastBrace = candidate.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidate = candidate.slice(firstBrace, lastBrace + 1);
  }
  try {
    const parsed = JSON.parse(candidate);
    if (!parsed || typeof parsed !== 'object') return null;
    const obj = parsed as Record<string, unknown>;
    if (
      typeof obj.label !== 'string' ||
      typeof obj.summary !== 'string' ||
      typeof obj.type !== 'string' ||
      typeof obj.color !== 'string'
    ) {
      return null;
    }
    const steps = Array.isArray(obj.next_steps)
      ? obj.next_steps.filter((s) => typeof s === 'string')
      : [];
    return {
      label: obj.label.slice(0, 60),
      summary: obj.summary,
      type: clampEnum(obj.type, [
        'topic',
        'action',
        'decision',
        'error',
        'dead_end',
      ]) as LabelResponse['type'],
      color: clampEnum(obj.color, ['green', 'yellow', 'red']) as LabelResponse['color'],
      next_steps: steps as string[],
    };
  } catch {
    return null;
  }
}

function clampEnum(val: unknown, allowed: string[]): string {
  return allowed.includes(val as string) ? (val as string) : allowed[0];
}

function extractStatus(err: unknown): number | null {
  if (!err || typeof err !== 'object') return null;
  const e = err as { status?: unknown; response?: { status?: unknown } };
  if (typeof e.status === 'number') return e.status;
  if (typeof e.response?.status === 'number') return e.response.status;
  return null;
}

function shouldRetry(status: number | null): boolean {
  if (status === null) return true; // network error
  if (status === 429) return true;
  if (status >= 500 && status < 600) return true;
  return false;
}

function errMsg(err: unknown): string {
  // SDK error messages can contain request/response bodies or credentials.
  const status = extractStatus(err);
  return status === null ? 'network or client error' : `HTTP ${status}`;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
