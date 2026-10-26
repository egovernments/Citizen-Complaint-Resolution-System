import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MessageError, englishT, translatorFrom, withNodes, type OnboardingT } from './i18n';
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

describe('withNodes', () => {
  it('places nodes in their slots and leaves an unknown slot as written', () => {
    const text = englishT('x', 'Hierarchy: %{hierarchy} • Levels: %{levels} %{other}', { levels: 'County → Ward' });
    const html = renderToStaticMarkup(createElement('p', null, withNodes(text, { hierarchy: createElement('b', null, 'ADMIN') })));
    expect(html).toBe('<p>Hierarchy: <b>ADMIN</b> • Levels: County → Ward %{other}</p>');
  });
});

describe('the employee sign-in toast', () => {
  it('uses its own key with the email, so a workspace seeded with the old "as %{username}" text is not read', () => {
    const source = readFileSync(`${__dirname}/employees/EmployeesStep.tsx`, 'utf8');
    expect(source).toMatch(/t\('employees\.signs_in_with_email', 'They sign in with %\{email\}\.', \{ email: /);
    // A workspace pack that only carries the old key: the new key isn't there yet, so its English fills in.
    const seeded: Record<string, string> = { 'app.onboarding.employees.signs_in_as': 'They sign in as %{username}.' };
    // Like polyglot: the stored text, else `_`, with the params filled in.
    const t = translatorFrom((key, options = {}) =>
      (seeded[key] ?? (options._ as string)).replace(/%\{(\w+)\}/g, (_m, name: string) => String(options[name])),
    );
    expect(t('employees.signs_in_with_email', 'They sign in with %{email}.', { email: 'amina@example.com' })).toBe(
      'They sign in with amina@example.com.',
    );
  });
});
