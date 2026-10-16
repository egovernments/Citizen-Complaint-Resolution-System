import { corsOrigins, intFromEnv } from './config';

describe('corsOrigins', () => {
  it('allows any origin when unset or when the list contains *', () => {
    expect(corsOrigins(undefined)).toBe('*');
    expect(corsOrigins('  ')).toBe('*');
    expect(corsOrigins('https://a.example, *')).toBe('*');
  });

  it('parses a comma-separated allow-list', () => {
    expect(corsOrigins('https://a.example, https://b.example')).toEqual([
      'https://a.example',
      'https://b.example',
    ]);
  });
});

describe('intFromEnv', () => {
  it('falls back when blank', () => {
    expect(intFromEnv('X', undefined, 7)).toBe(7);
    expect(intFromEnv('X', ' ', 7)).toBe(7);
  });

  it('parses non-negative integers, including 0', () => {
    expect(intFromEnv('X', '0', 7)).toBe(0);
    expect(intFromEnv('X', '120', 7)).toBe(120);
  });

  it('fails loudly on anything else instead of silently using the default', () => {
    for (const bad of ['-1', '1.5', 'abc'])
      expect(() => intFromEnv('X', bad, 7)).toThrow(
        /X must be a non-negative integer/,
      );
  });
});
