/** Confirming a match on redacted text and cutting the snippet shown for it. */
import type { Redactor } from '../utils/redact.js';
import type { Matcher } from './matcher.js';
import type { FieldText, SearchField } from './project.js';

export const SNIPPET_CONTEXT = 60;

export interface FieldMatch {
  field: SearchField;
  snippet: string;
}

// Controls (newlines, tabs, escape sequences) and bidirectional overrides would
// reshape a terminal line; runs of them and of whitespace become one space.
const UNPRINTABLE = /[\s\p{Cc}\u200e\u200f\u202a-\u202e\u2066-\u2069]+/gu;

/**
 * Matches on the REDACTED text, so a secret can neither be found nor confirmed.
 * The raw text is checked first only to skip redacting fields that cannot match.
 */
export function matchField(
  field: FieldText,
  matcher: Matcher,
  redactor: Redactor,
): FieldMatch | null {
  if (matcher.indexIn(field.text) < 0) return null;
  const safe = redactor.apply(field.text);
  const at = matcher.indexIn(safe);
  if (at < 0) return null;
  return { field: field.field, snippet: snippetAround(safe, at, matcher.query.length) };
}

/** Up to SNIPPET_CONTEXT characters either side of the match, on one line. */
export function snippetAround(text: string, at: number, length: number): string {
  let start = Math.max(0, at - SNIPPET_CONTEXT);
  let end = Math.min(text.length, at + length + SNIPPET_CONTEXT);
  // Never cut a surrogate pair in half.
  if (start > 0 && isLowSurrogate(text.charCodeAt(start))) start -= 1;
  if (end < text.length && isLowSurrogate(text.charCodeAt(end))) end += 1;
  const body = text.slice(start, end).replace(UNPRINTABLE, ' ').trim();
  return `${start > 0 ? '…' : ''}${body}${end < text.length ? '…' : ''}`;
}

function isLowSurrogate(unit: number): boolean {
  return unit >= 0xdc00 && unit <= 0xdfff;
}
