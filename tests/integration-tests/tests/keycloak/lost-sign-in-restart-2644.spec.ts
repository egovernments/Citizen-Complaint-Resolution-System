/**
 * A sign-in the browser no longer holds offers a way back to a sign-in (#2644).
 *
 * Two tabs of one browser: tab A holds the employee sign-in page; tab B
 * finishes a password reset the way the Configurator's "Set up or reset your
 * password" does (BFF password/setup-requests, an UPDATE_PASSWORD email for the
 * BFF client), which replaces the browser's Keycloak session. Tab A's form post then hits Keycloak's lost-session error.
 * It must say "Start sign-in again" and lead to the workspace's own sign-in,
 * not to "Back to Application" at the site root.
 *
 * Needs the isolated realm fixture (IDENTITY_TEST_KEYCLOAK_ADMIN_URL/_TOKEN)
 * for a throwaway employee login with an email, and the mail sink the realm's
 * mail reaches (ONBOARDING_E2E_MAILPIT_URL, as the onboarding e2e uses).
 */
import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { BASE_URL, KC_REALM } from '../utils/env';
import { authorizeUrl, surfacePath } from '../utils/identity-bff';
import { keycloakAdmin } from '../utils/keycloak-admin';
import { mailedLink } from '../utils/workspace-setup';

test.use({ storageState: { cookies: [], origins: [] } });

test.describe('lost employee sign-in restarts at the workspace sign-in #2644', () => {
  let userUrl: string | undefined;
  let email = '';
  const password = `Test@${randomUUID()}`;
  const replacement = `Reset@${randomUUID()}`;

  test.beforeAll(async () => {
    if (!process.env.ONBOARDING_E2E_MAILPIT_URL || !process.env.IDENTITY_TEST_KEYCLOAK_ADMIN_URL || !process.env.IDENTITY_TEST_KEYCLOAK_ADMIN_TOKEN) return;
    const admin = keycloakAdmin();
    const username = `e2e-lost-${randomUUID()}`;
    email = `${username}@example.test`;
    const created = await fetch(`${admin.base}/admin/realms/${KC_REALM}/users`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${admin.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, email, enabled: true, emailVerified: true, firstName: 'E2E', lastName: 'Lost',
        credentials: [{ type: 'password', value: password, temporary: false }] }),
    });
    expect(created.status).toBe(201);
    userUrl = created.headers.get('location') ?? undefined;
  });

  test.afterAll(async () => {
    if (!userUrl) return;
    const admin = keycloakAdmin();
    expect((await fetch(userUrl, { method: 'DELETE', headers: { Authorization: `Bearer ${admin.token}` } })).status).toBe(204);
  });

  test('"Start sign-in again" leads to the workspace sign-in', { tag: ['@area:keycloak', '@persona:employee'] }, async ({ context }) => {
    test.skip(!userUrl, 'needs the Keycloak admin fixture and ONBOARDING_E2E_MAILPIT_URL');

    const tabA = await context.newPage();
    await tabA.goto(authorizeUrl(BASE_URL, 'employee'));
    await expect(tabA.locator('#username')).toBeVisible();

    // Tab B: the emailed password-setup link, opened in the same browser.
    const tabB = await context.newPage();
    const requested = await context.request.post(`${BASE_URL}/identity/v1/password/setup-requests`, {
      headers: { Origin: new URL(BASE_URL).origin },
      data: { email, surface: 'configurator', returnTo: '/configurator/login' },
    });
    expect(requested.status()).toBe(202);
    await tabB.goto((await mailedLink(email)).link);
    await tabB.locator('#password-new').fill(replacement);
    await tabB.locator('#password-confirm').fill(replacement);
    await tabB.locator('form button[type="submit"]').first().click();
    await tabB.close();

    // Tab A: the first sign-in page is submitted after its session is gone.
    await tabA.locator('#username').fill(email);
    await tabA.locator('#password').fill(password);
    const consent = tabA.locator('#privacy-component-check');
    if (await consent.count()) await consent.check({ force: true });
    await tabA.locator('#kc-login').click();

    const restart = tabA.locator('#restartSignIn');
    await expect(restart).toBeVisible();
    await expect(restart).toHaveText('Start sign-in again');
    await expect(tabA.locator('#backToApplication')).toHaveCount(0);

    const signIn = tabA.waitForRequest(r => new URL(r.url()).pathname === surfacePath('employee', 'user/login').replace(/\/$/, ''));
    await restart.click();
    await signIn;
  });
});
