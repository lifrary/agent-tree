/**
 * Secret redaction — SPEC §7.6 / §19.2
 *
 * Applied before text leaves the machine (LLM request body) and before it
 * reaches the final HTML (`window.OMCM` bundle). Regexes are kept broad but
 * conservative: better to over-redact than leak.
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
    name: 'gcp_api_key',
    regex: /\bAIza[0-9A-Za-z_-]{35}\b/g,
    replacement: 'AIza***REDACTED***',
  },
  {
    name: 'private_key_block',
    regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    replacement: '-----REDACTED PRIVATE KEY-----',
  },
  {
    name: 'jwt',
    regex: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
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
    // International E.164 or local 10-15 digit with separators
    name: 'phone',
    regex: /\b(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}\b/g,
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
