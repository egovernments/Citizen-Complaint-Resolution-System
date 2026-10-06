import { describe, expect, it } from 'vitest';
import { MessageError, englishT, type OnboardingT } from './i18n';
import { describeSaveError } from './errors';
import { deactivateAndRemove } from '@/identity/memberActions';

describe('MessageError', () => {
  it('reads as its English, with no space left by an empty trailing value', () => {
    const err = new MessageError('members.removal_unfinished', 'Removal is unfinished. Retry removal. %{reason}', { reason: '' });
    expect(err.message).toBe('Removal is unfinished. Retry removal.');
    expect(describeSaveError(err, 'fallback', englishT)).toBe('Removal is unfinished. Retry removal.');
  });

  it('is translated by its key where it is shown', async () => {
    const hindi: OnboardingT = (key, english, params) => (key === 'members.self_removal' ? 'आप अपनी सदस्यता नहीं हटा सकते।' : englishT(key, english, params));
    const employee = { tenantId: 'acme', code: 'EMP_1', uuid: 'u-1', user: { uuid: 'u-1' } };
    const err = await deactivateAndRemove(async () => employee, async () => undefined, 'u-1').then(
      () => null,
      (error: unknown) => error,
    );
    expect(err).toBeInstanceOf(MessageError);
    expect(describeSaveError(err, 'fallback', hindi)).toBe('आप अपनी सदस्यता नहीं हटा सकते।');
  });
});
