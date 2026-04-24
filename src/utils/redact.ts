/**
 * Secret redaction — SPEC §7.6 / §19.2
 *
 * Applied at every sink that emits user-derived text:
 *   - LLM request body (before SDK call)
 *   - segment labels in `tree/builder.ts` (before truncation — earlier we had
 *     a regression where 60-char truncation sliced an API key below the
 *     20-char regex floor)
 *   - snapshot markdown returned by CLI/MCP (clipboard / stdout)
 *   - `--dump-json` artifacts on disk
 *   - verbose-mode aux cache (`graph.json`, `segments.json`)
 *
 * Regexes are kept broad but conservative: better to over-redact than leak.
 *
 * - Default ON via `defaultRedactor()`.
 * - `--redact-strict` adds PII patterns (email, phone, card, SSN/RRN).
 * - `--redact-dryrun` prints a preview of redactions to stderr.
 */

export interface RedactPattern {
  name: string;
  regex: RegExp;
  replacement: string; // may contain $1 to keep a prefix
}

const DEFAULT_PATTERNS: RedactPattern[] = [
  {
    name: 'anthropic_api_key',
    regex: /sk-ant-[A-Za-z0-9_-]{20,}/g,
    replacement: 'sk-ant-***REDACTED***',
  },
  {
    name: 'openai_api_key',
    regex: /sk-[A-Za-z0-9]{32,}/g,
    replacement: 'sk-***REDACTED***',
  },
  {
    name: 'github_pat',
    regex: /gh[pous]_[A-Za-z0-9]{30,}/g,
    replacement: 'gh*_***REDACTED***',
  },
  {
    name: 'slack_token',
    regex: /xox[bpoar]-[A-Za-z0-9-]{10,}/g,
    replacement: 'xox*-***REDACTED***',
  },
  {
    name: 'bearer_token',
    regex: /\bBearer\s+[A-Za-z0-9._-]{20,}/g,
    replacement: 'Bearer ***REDACTED***',
  },
  {
    name: 'aws_access_key_id',
    regex: /\bAKIA[0-9A-Z]{16}\b/g,
    replacement: 'AKIA***REDACTED***',
  },
  {
    name: 'aws_temp_key',
    regex: /\bASIA[0-9A-Z]{16}\b/g,
    replacement: 'ASIA***REDACTED***',
  },
  {
    // 35-char alphanumeric + `_-` suffix. `\b` at the end would fail when the
    // key happens to end in `-` (a non-word char), because the next char is
    // also typically non-word (space/`.`/EOF) and `\b` needs a word↔non-word
    // transition. `{35}` is fixed-length, so the engine can't shorten the
    // match to dodge the boundary — the whole key would leak unredacted.
    // Use a negative lookahead against the same class to terminate correctly
    // regardless of word-ness at the seam.
    name: 'gcp_api_key',
    regex: /\bAIza[0-9A-Za-z_-]{35}(?![A-Za-z0-9_-])/g,
    replacement: 'AIza***REDACTED***',
  },
  {
    name: 'gcp_oauth_token',
    regex: /\bya29\.[0-9A-Za-z_-]{20,}/g,
    replacement: 'ya29.***REDACTED***',
  },
  {
    // GitHub fine-grained PAT: `github_pat_<22 alnum>_<59 alnum_>` (≥82 total)
    name: 'github_pat_finegrained',
    regex: /\bgithub_pat_[A-Za-z0-9_]{82,}/g,
    replacement: 'github_pat_***REDACTED***',
  },
  {
    // OpenAI project / service-account / admin keys (added 2024)
    name: 'openai_project_key',
    regex: /\bsk-(?:proj|svcacct|admin)-[A-Za-z0-9_-]{20,}/g,
    replacement: 'sk-***REDACTED***',
  },
  {
    name: 'stripe_secret_key',
    regex: /\bsk_(?:live|test)_[A-Za-z0-9]{24,}/g,
    replacement: 'sk_***REDACTED***',
  },
  {
    name: 'huggingface_token',
    regex: /\bhf_[A-Za-z0-9]{30,}\b/g,
    replacement: 'hf_***REDACTED***',
  },
  {
    // npm automation / publish tokens — 36 alnum after `npm_`. Common in
    // `.npmrc` pastes that developers drop into chat while debugging
    // publish failures.
    name: 'npm_token',
    regex: /\bnpm_[A-Za-z0-9]{36}\b/g,
    replacement: 'npm_***REDACTED***',
  },
  {
    name: 'private_key_block',
    regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    replacement: '-----REDACTED PRIVATE KEY-----',
  },
  {
    // base64url (RFC 4648 §5) alphabet is `[A-Za-z0-9_-]` — signature portion
    // can legally end in `-` or `_`. Trailing `\b` required a word↔non-word
    // transition and would fail whenever the signature happened to end on a
    // `-`/`_` with non-word context after (space / EOF / punctuation). The
    // engine could sometimes backtrack within the `{10,}` to land on a word
    // char, leaking the trailing byte; when the signature was ≤10 chars of
    // trailing `-`s it couldn't match at all. Replace with a negative
    // lookahead against the same class.
    name: 'jwt',
    regex: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}(?![A-Za-z0-9_-])/g,
    replacement: 'eyJ***REDACTED.JWT***',
  },
];

const STRICT_EXTRA: RedactPattern[] = [
  {
    name: 'email',
    regex: /\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g,
    replacement: '[EMAIL]',
  },
  // IMPORTANT: ssn_us and rrn_ko are narrower patterns — they must run before
  // the generic phone regex, or the phone regex swallows their digit groups.
  {
    name: 'ssn_us',
    regex: /\b\d{3}-\d{2}-\d{4}\b/g,
    replacement: '[SSN]',
  },
  {
    name: 'rrn_ko',
    regex: /\b\d{6}-[1-4]\d{6}\b/g,
    replacement: '[RRN]',
  },
  {
    // International E.164 with required `+` prefix. Pure-digit bounded run,
    // no nested optionals → ReDoS-safe.
    name: 'phone_e164',
    regex: /\+\d{8,15}\b/g,
    replacement: '[PHONE]',
  },
  {
    // Local/domestic phone with ≥2 separators. Separators are REQUIRED — the
    // old regex had `[-.\s]?` at three positions plus an outer-optional
    // prefix group, yielding nested optionals whose backtracking was
    // catastrophic on long digit-only input (classic ReDoS). Requiring both
    // middle separators removes the ambiguity without losing common formats:
    //   ✓ 010-1234-5678   ✓ (415) 555-0123   ✓ +82 10-1234-5678
    // Pure-digit numbers like "01012345678" are intentionally not caught
    // here — phone_e164 above catches the `+` variant, and for separator-less
    // domestic strings the false-positive risk on long IDs (order numbers,
    // SKUs) outweighs the extra recall.
    name: 'phone',
    // (?<!\w) at the start — not \b — so that a leading `(` (not a word
    // char, breaks \b) is still matched when the prior byte is whitespace.
    // Without this, `US office (415) 555-0123` would match as
    // `415) 555-0123` and leave the paren outside the redaction.
    regex: /(?<!\w)(?:\+\d{1,3}[-.\s])?\(?\d{2,4}\)?[-.\s]\d{3,4}[-.\s]\d{3,4}\b/g,
    replacement: '[PHONE]',
  },
];

export interface Redactor {
  apply(text: string): string;
  applyWithStats(text: string): { text: string; hits: Record<string, number> };
  patterns: RedactPattern[];
}

export interface RedactorOptions {
  strict?: boolean;
  extraPatterns?: RedactPattern[];
}

export function defaultRedactor(opts: RedactorOptions = {}): Redactor {
  const patterns: RedactPattern[] = [
    ...DEFAULT_PATTERNS,
    ...(opts.strict ? STRICT_EXTRA : []),
    ...(opts.extraPatterns ?? []),
  ];

  return {
    patterns,
    apply(text: string): string {
      if (!text) return text;
      let out = text;
      for (const p of patterns) out = out.replace(p.regex, p.replacement);
      // Luhn-based card check — surgical so we don't touch order numbers
      out = redactCreditCards(out);
      return out;
    },
    applyWithStats(text: string) {
      const hits: Record<string, number> = {};
      if (!text) return { text, hits };
      let out = text;
      for (const p of patterns) {
        const matches = out.match(p.regex);
        if (matches && matches.length > 0) hits[p.name] = matches.length;
        out = out.replace(p.regex, p.replacement);
      }
      const cardResult = redactCreditCardsWithStats(out);
      if (cardResult.hits > 0) hits.credit_card = cardResult.hits;
      return { text: cardResult.text, hits };
    },
  };
}

/**
 * Recursively redact every string leaf inside a JSON-like value. Shape
 * (arrays, keys, numbers) is preserved; only string values are rewritten.
 */
export function redactDeep<T>(value: T, redactor: Redactor): T {
  if (value == null) return value;
  if (typeof value === 'string') return redactor.apply(value) as unknown as T;
  if (Array.isArray(value)) {
    return value.map((v) => redactDeep(v, redactor)) as unknown as T;
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redactDeep(v, redactor);
    }
    return out as T;
  }
  return value;
}

// ---------------------------------------------------------------------------
// Luhn-gated credit-card redaction
// ---------------------------------------------------------------------------

const CARD_RE = /\b(?:\d[ -]?){12,18}\d\b/g;

function redactCreditCards(text: string): string {
  return redactCreditCardsWithStats(text).text;
}

function redactCreditCardsWithStats(text: string): {
  text: string;
  hits: number;
} {
  let hits = 0;
  const result = text.replace(CARD_RE, (match) => {
    const digits = match.replace(/[^0-9]/g, '');
    if (digits.length < 13 || digits.length > 19) return match;
    if (!luhnValid(digits)) return match;
    hits += 1;
    return '[CARD]';
  });
  return { text: result, hits };
}

function luhnValid(digits: string): boolean {
  let sum = 0;
  let flip = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let d = digits.charCodeAt(i) - 48;
    if (d < 0 || d > 9) return false;
    if (flip) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    flip = !flip;
  }
  return sum % 10 === 0;
}
