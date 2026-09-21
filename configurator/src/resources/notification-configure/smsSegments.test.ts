import { describe, it, expect } from 'vitest';
import {
  measureSms,
  isGsm7,
  firstNonGsm7,
  SMS_SINGLE_GSM7,
  SMS_CONCAT_GSM7,
  SMS_SINGLE_UCS2,
  SMS_CONCAT_UCS2,
  SMS_PLACEHOLDER_ALLOWANCE,
} from './smsSegments';

describe('GSM-7 detection', () => {
  it('accepts the plain ASCII an English template is written in', () => {
    expect(isGsm7('Dear Citizen, complaint PGR-1 was resolved.')).toBe(true);
    expect(firstNonGsm7('Dear Citizen')).toBeUndefined();
  });

  it('accepts the accented + Greek characters that ARE in the default alphabet', () => {
    expect(isGsm7('Café costs 5£ — no')).toBe(false); // the em dash is NOT GSM-7
    expect(isGsm7('Café costs 5£')).toBe(true);
    expect(isGsm7('ΔΦΓΛΩΠΨΣΘΞ')).toBe(true);
  });

  it('rejects the characters that silently force UCS-2', () => {
    // These three are the ones that bite in practice: a curly apostrophe or an
    // em dash pasted from a word processor, and any Devanagari/Swahili accent.
    expect(firstNonGsm7('Don’t')).toBe('’');
    expect(firstNonGsm7('a — b')).toBe('—');
    expect(firstNonGsm7('प्रिय नागरिक')).toBe('प');
  });

  it('treats extension-table characters as GSM-7 but charges them double', () => {
    // { } are extension characters, so "{id}" costs 2+1+1+2 = 6 septets.
    const m = measureSms('{id}', { allowancePerPlaceholder: 0 });
    expect(m.encoding).toBe('GSM-7');
    expect(m.authoredUnits).toBe(6);
  });
});

describe('segment arithmetic', () => {
  it('counts an empty body as zero segments', () => {
    expect(measureSms('').segments).toBe(0);
  });

  it('uses the single-part budget up to the boundary and the concatenated one after', () => {
    expect(measureSms('a'.repeat(SMS_SINGLE_GSM7)).segments).toBe(1);
    expect(measureSms('a'.repeat(SMS_SINGLE_GSM7 + 1)).segments).toBe(2);
    // 2 * 153 = 306 fits exactly in two concatenated parts; one more spills.
    expect(measureSms('a'.repeat(SMS_CONCAT_GSM7 * 2)).segments).toBe(2);
    expect(measureSms('a'.repeat(SMS_CONCAT_GSM7 * 2 + 1)).segments).toBe(3);
  });

  it('falls off the UCS-2 cliff as soon as one character is not GSM-7', () => {
    const ascii = 'a'.repeat(100);
    expect(measureSms(ascii).segments).toBe(1);
    // Same length, one curly apostrophe: now 70/67 per part instead of 160/153.
    const withCurly = '’' + 'a'.repeat(99);
    const m = measureSms(withCurly);
    expect(m.encoding).toBe('UCS-2');
    expect(m.forcedUcs2By).toBe('’');
    expect(m.segments).toBe(2);
    expect(measureSms('a'.repeat(SMS_SINGLE_UCS2 - 1) + '’').segments).toBe(1);
    expect(measureSms('a'.repeat(SMS_SINGLE_UCS2) + '’').segments).toBe(2);
    expect(measureSms('’' + 'a'.repeat(SMS_CONCAT_UCS2 * 2 - 1)).segments).toBe(2);
  });

  it('bills an astral character as two UTF-16 code units', () => {
    const m = measureSms('😀');
    expect(m.encoding).toBe('UCS-2');
    expect(m.authoredUnits).toBe(2);
  });
});

describe('placeholder allowance', () => {
  it('adds the documented allowance once per placeholder occurrence', () => {
    const m = measureSms('Complaint {id} for {id}');
    expect(m.placeholders).toBe(2);
    expect(m.allowance).toBe(2 * SMS_PLACEHOLDER_ALLOWANCE);
    expect(m.units).toBe(m.authoredUnits + m.allowance);
  });

  it('ignores brace shapes pgr-services does not substitute', () => {
    // `{{id}}` and `{not a token}` are never replaced, so they carry no allowance.
    expect(measureSms('{not a token}').placeholders).toBe(0);
    expect(measureSms('{}').placeholders).toBe(0);
  });

  it('can be overridden for callers that want the raw authored length', () => {
    const m = measureSms('{id}{date}', { allowancePerPlaceholder: 0 });
    expect(m.allowance).toBe(0);
    expect(m.units).toBe(m.authoredUnits);
  });
});
