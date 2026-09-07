import { describe, expect, it } from 'vitest';
import {
  deriveAccountCode,
  mockOnboardingClient,
  slugifyAccountName,
} from './onboarding';

describe('deriveAccountCode', () => {
  it('takes the initials of the first three words', () => {
    expect(deriveAccountCode('Bomet County Government', '')).toBe('BCG');
  });

  it('prefixes the country once one is chosen', () => {
    // The prototype rewrites the code when a base country is picked.
    expect(deriveAccountCode('Bomet County Government', 'KE')).toBe('KE-BCG');
  });

  it('ignores words beyond the third', () => {
    expect(deriveAccountCode('One Two Three Four Five', 'IN')).toBe('IN-OTT');
  });

  it('returns empty for an empty name rather than a bare country prefix', () => {
    expect(deriveAccountCode('   ', 'KE')).toBe('');
  });
});

describe('slugifyAccountName', () => {
  it('lowercases and hyphenates', () => {
    expect(slugifyAccountName('Bomet County Government')).toBe('bomet-county-government');
  });

  it('collapses punctuation and trims stray hyphens', () => {
    expect(slugifyAccountName('  St. Mary’s  (Ward 4)! ')).toBe('st-mary-s-ward-4');
  });

  it('caps at the DNS label limit', () => {
    expect(slugifyAccountName('a'.repeat(100)).length).toBe(63);
  });
});

describe('availability checks', () => {
  it('rejects a code already in use and offers an alternative', async () => {
    const result = await mockOnboardingClient.checkAccountCode('KE-NRB');
    expect(result.available).toBe(false);
    expect(result.suggestion).toBe('KE-NRB-2');
  });

  it('accepts a free code', async () => {
    expect((await mockOnboardingClient.checkAccountCode('KE-BCG')).available).toBe(true);
  });

  it('rejects a taken url', async () => {
    expect((await mockOnboardingClient.checkAccountUrl('nairobi')).available).toBe(false);
  });

  it('rejects a too-short url before asking about uniqueness', async () => {
    const result = await mockOnboardingClient.checkAccountUrl('ab');
    expect(result.available).toBe(false);
    expect(result.reason).toMatch(/too short/i);
  });
});

describe('email verification', () => {
  it('is false until the link is opened', async () => {
    expect(await mockOnboardingClient.isEmailVerified('nobody@example.com')).toBe(false);
  });

  it('rejects an address with no @ rather than pretending to send', async () => {
    await expect(mockOnboardingClient.startEmailVerification({ email: 'not-an-email' }))
      .rejects.toThrow(/valid email/i);
  });
});
