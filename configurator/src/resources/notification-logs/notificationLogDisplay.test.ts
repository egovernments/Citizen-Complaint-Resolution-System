import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { maskRecipient, recipientDisplay } from './notificationLogDisplay';

// The same rule as novu-bridge's PiiMask (backend/novu-bridge/.../util/PiiMask.java, PiiMaskTest):
// ids are ids, emails keep the first character and the domain, phones keep their last 3 digits.
describe('maskRecipient', () => {
  it('shows a user uuid as it is, even when its hex holds a 7-digit run', () => {
    // Field finding: one uuid came back as it is and the other masked like a phone.
    expect(maskRecipient('2f9a1c34-5b6d-4e7f-8a90-ab12cd34ef56')).toBe('2f9a1c34-5b6d-4e7f-8a90-ab12cd34ef56');
    expect(maskRecipient('0b7e5a10-3c2d-4f1e-9a8b-d1234966d08b')).toBe('0b7e5a10-3c2d-4f1e-9a8b-d1234966d08b');
    expect(maskRecipient('12345678-1234-1234-1234-123456789012')).toBe('12345678-1234-1234-1234-123456789012');
  });

  it('masks a phone to its last three digits, keeping the prefix around it', () => {
    expect(maskRecipient('+254712345678')).toBe('+***678');
    expect(maskRecipient('0712345678')).toBe('***678');
    expect(maskRecipient('ke:+254712345678')).toBe('ke:+***678');
  });

  it('masks an email to its first character and domain', () => {
    expect(maskRecipient('contact@example.org')).toBe('c***@example.org');
  });

  it('leaves a value the bridge already masked unchanged', () => {
    expect(maskRecipient('+***678')).toBe('+***678');
    expect(maskRecipient('c***@example.org')).toBe('c***@example.org');
  });

  it('does not treat a longer hex token as a uuid', () => {
    expect(maskRecipient('0b7e5a10-3c2d-4f1e-9a8b-d12349660d08b')).toBe('0b7e5a10-3c2d-4f1e-9a8b-d***660d08b');
  });

  it('does not treat a uuid glued to a hex character or a dash as a uuid', () => {
    expect(maskRecipient('a0b7e5a10-3c2d-4f1e-9a8b-d1234966d08b')).toBe('a0b7e5a10-3c2d-4f1e-9a8b-d***966d08b');
    expect(maskRecipient('-0b7e5a10-3c2d-4f1e-9a8b-d1234966d08b')).toBe('-0b7e5a10-3c2d-4f1e-9a8b-d***966d08b');
  });

  it('keeps every uuid in a composite value and masks the phone between them', () => {
    const a = '0b7e5a10-3c2d-4f1e-9a8b-d1234966d08b';
    const b = '12345678-1234-1234-1234-123456789012';
    expect(maskRecipient(`${a}:${b}`)).toBe(`${a}:${b}`);
    expect(maskRecipient(`ke:+254712345678:${a}`)).toBe(`ke:+***678:${a}`);
    expect(maskRecipient(`${a}/0712345678/${b}`)).toBe(`${a}/***678/${b}`);
  });

  it('parses on Safari before 16.4: no regex lookbehind in this module', () => {
    // App.tsx imports this module up front; a lookbehind is a SyntaxError there and blanks the app.
    const source = readFileSync(path.resolve(__dirname, 'notificationLogDisplay.ts'), 'utf8');
    expect(source).not.toMatch(/\(\?<[=!]/);
  });

  it('renders a dash for an empty value and keeps the literal none', () => {
    expect(maskRecipient('')).toBe('--');
    expect(recipientDisplay({ recipientValue: 'none', channel: 'NONE' })).toEqual({ text: 'none', muted: true });
  });
});
