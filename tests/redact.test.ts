import { describe, expect, it } from 'vitest';

import { defaultRedactor, redactDeep } from '../src/utils/redact.js';

describe('defaultRedactor — built-in patterns', () => {
  const r = defaultRedactor();

  it.each([
    ['sk-ant-' + 'A'.repeat(60), 'sk-ant-***REDACTED***'],
    ['sk-' + '1'.repeat(48), 'sk-***REDACTED***'],
    ['ghp_' + 'a'.repeat(40), 'gh*_***REDACTED***'],
    ['gho_' + 'b'.repeat(40), 'gh*_***REDACTED***'],
    ['xoxb-1234-abcd-efghij', 'xox*-***REDACTED***'],
    ['Bearer ' + 'X'.repeat(40), 'Bearer ***REDACTED***'],
    ['AKIA' + '1'.repeat(16), 'AKIA***REDACTED***'],
    ['ASIA' + '2'.repeat(16), 'ASIA***REDACTED***'],
    ['AIza' + 'x'.repeat(35), 'AIza***REDACTED***'],
    [
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.5mhBHqs5_DTLdINd9p5m7ZJ6XD0Xc55kIaCRY5r6HRA',
      'eyJ***REDACTED.JWT***',
    ],
  ])('redacts %s', (input, expected) => {
    expect(r.apply(input)).toBe(expected);
  });

  it('redacts PEM-style private key blocks in full', () => {
    const input = `-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----`;
    expect(r.apply(input)).toBe('-----REDACTED PRIVATE KEY-----');
  });

  it('leaves regular prose untouched', () => {
    const input = 'Just a normal sentence about src/foo.ts and Edit tool use.';
    expect(r.apply(input)).toBe(input);
  });

  it('redacts Luhn-valid credit card', () => {
    // 4111 1111 1111 1111 is the canonical Visa test card (Luhn-valid).
    expect(r.apply('card 4111 1111 1111 1111 please')).toBe('card [CARD] please');
  });

  it('leaves Luhn-INVALID digit runs alone', () => {
    // 1234567890123456 isn't Luhn-valid, so no redaction.
    expect(r.apply('tracking id 1234567890123456')).toBe(
      'tracking id 1234567890123456',
    );
  });
});

describe('strict mode extras', () => {
  const r = defaultRedactor({ strict: true });

  it('redacts email addresses', () => {
    expect(r.apply('ping me at user@example.com thanks')).toContain('[EMAIL]');
  });

  it('redacts SSN-looking patterns', () => {
    expect(r.apply('SSN 123-45-6789')).toContain('[SSN]');
  });

  it('redacts Korean RRN-looking patterns', () => {
    expect(r.apply('주민등록번호 900101-1234567')).toContain('[RRN]');
  });

  it('basic mode does NOT redact email', () => {
    const basic = defaultRedactor();
    expect(basic.apply('user@example.com')).toBe('user@example.com');
  });
});

describe('applyWithStats', () => {
  it('counts hits per pattern', () => {
    const r = defaultRedactor();
    const { hits } = r.applyWithStats(
      'sk-ant-' + 'a'.repeat(40) + ' and AKIA1234567890123456 and AKIAAAAAAAAAAAAAAAAA',
    );
    expect(hits.anthropic_api_key).toBe(1);
    expect(hits.aws_access_key_id).toBeGreaterThan(0);
  });
});

describe('redactDeep', () => {
  it('rewrites string leaves inside nested objects', () => {
    const r = defaultRedactor();
    const result = redactDeep(
      {
        a: 'sk-ant-' + 'x'.repeat(40),
        b: { c: ['Bearer ' + 'y'.repeat(40), 42, null] },
      },
      r,
    );
    expect(result.a).toBe('sk-ant-***REDACTED***');
    const arr = (result.b as { c: unknown[] }).c;
    expect(arr[0]).toBe('Bearer ***REDACTED***');
    expect(arr[1]).toBe(42);
    expect(arr[2]).toBeNull();
  });
});
