/**
 * Literal smart-case matching for --search. One query yields two matchers that
 * must agree: a byte-level prefilter over raw JSONL (stage 1) and a text
 * matcher over decoded, redacted fields (stage 2 and 3).
 */

export interface Matcher {
  readonly query: string;
  /** Any uppercase letter makes the search case-sensitive (ripgrep's smart case). */
  readonly caseSensitive: boolean;
  /** Index of the first match in decoded text, or -1. Case folding is ASCII-only. */
  indexIn(text: string): number;
  /**
   * Global RegExp over latin1-decoded bytes. A superset of every confirmable
   * match: it accepts the query as JSON writes it, escaped once (a string
   * field), escaped twice (a JSON string inside a string, such as Codex
   * function arguments) and with non-ASCII as `\uXXXX`.
   */
  readonly prefilter: RegExp;
  /** Longest prefilter alternative in bytes; chunks overlap by one less. */
  readonly maxNeedleBytes: number;
}

export function createMatcher(query: string): Matcher {
  const caseSensitive = query !== query.toLowerCase();
  const folded = caseSensitive ? null : new RegExp(foldAscii(query));
  const once = JSON.stringify(query).slice(1, -1);
  const needles = new Set([latin1(once), latin1(JSON.stringify(once).slice(1, -1))]);
  const alternatives = [...needles].map(escapeRegExp);
  let maxNeedleBytes = Math.max(...[...needles].map((needle) => needle.length));
  if (/[\u0080-\uffff]/.test(once)) {
    const escaped = unicodeEscapedPattern(once);
    alternatives.push(escaped.pattern);
    maxNeedleBytes = Math.max(maxNeedleBytes, escaped.bytes);
  }
  return {
    query,
    caseSensitive,
    indexIn: (text) => (folded ? (folded.exec(text)?.index ?? -1) : text.indexOf(query)),
    prefilter: new RegExp(alternatives.join('|'), caseSensitive ? 'g' : 'gi'),
    maxNeedleBytes,
  };
}

/** A pattern matching `text` with ASCII letters in either case and nothing else folded. */
function foldAscii(text: string): string {
  let pattern = '';
  for (const char of text) {
    pattern += /[a-zA-Z]/.test(char)
      ? `[${char.toLowerCase()}${char.toUpperCase()}]`
      : escapeRegExp(char);
  }
  return pattern;
}

/** The UTF-8 bytes of `text`, one latin1 character per byte. */
function latin1(text: string): string {
  return Buffer.from(text, 'utf8').toString('latin1');
}

/** Non-ASCII UTF-16 units as `\uXXXX` with hex digits of either case. */
function unicodeEscapedPattern(text: string): { pattern: string; bytes: number } {
  let pattern = '';
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    if (unit < 0x80) {
      pattern += escapeRegExp(text[i]);
      bytes += 1;
      continue;
    }
    pattern += '\\\\u';
    for (const digit of unit.toString(16).padStart(4, '0')) {
      pattern += /[a-f]/.test(digit) ? `[${digit}${digit.toUpperCase()}]` : digit;
    }
    bytes += 6;
  }
  return { pattern, bytes };
}

function escapeRegExp(text: string): string {
  return text.replace(/[\\^$.*+?()[\]{}|/-]/g, '\\$&');
}
