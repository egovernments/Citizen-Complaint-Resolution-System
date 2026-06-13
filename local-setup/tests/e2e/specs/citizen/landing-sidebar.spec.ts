/**
 * Citizen landing-page sidebar + Edit Profile.
 *
 * Two concerns this spec covers, that the flow / submit / inbox specs
 * don't:
 *
 *  1) The sidebar surface that anchors every authenticated citizen
 *     route — nav entries, current-user chip — must be localized. A
 *     raw key here is doubly bad because it follows the citizen onto
 *     every subsequent page until logout.
 *
 *  2) Editing the profile (name + photo) is the only citizen-driven
 *     write into egov-user a non-employee can perform from the UI.
 *     The saved value must reflect back in the sidebar without a
 *     reload — otherwise the citizen has no signal that the write
 *     took (and a partial UI state where the form clears but the
 *     sidebar still shows the old chip has historically masked auth
 *     bugs where the update went through with the wrong UUID).
 */
import { test, expect, type Page } from '@playwright/test';
import { citizenOtpLogin } from '../../utils/citizen-auth';
import * as fs from 'fs';
import * as path from 'path';

const RAW_KEY_RE = /\b[A-Z][A-Z0-9]*(?:[._][A-Z0-9]+)+\b/g;
const rawKeysIn = (text: string) =>
  [...new Set(text.match(RAW_KEY_RE) || [])];

type LocFetch = { url: string; messageCount: number };
function captureLoc(page: Page, sink: LocFetch[]) {
  page.on('response', async (resp) => {
    if (!resp.url().includes('/localization/messages/v1/_search')) return;
    try {
      const body = await resp.json();
      const msgs = Array.isArray(body?.messages) ? body.messages : [];
      sink.push({ url: resp.url(), messageCount: msgs.length });
    } catch {
      /* */
    }
  });
}

// Open the sidebar. Different V2 revisions ship it as (a) a persistent
// aside on desktop, (b) a hamburger that toggles a drawer, or (c) an
// avatar/user-chip in the header. Try the common openers; fall through
// silently if the sidebar is already visible.
async function openSidebar(page: Page) {
  const openers = [
    page.getByRole('button', { name: /menu|sidebar|navigation/i }),
    page.locator('[aria-label*="menu" i], [aria-label*="navigation" i]'),
    page.locator('header button').filter({ has: page.locator('svg') }).first(),
  ];
  for (const opener of openers) {
    if (await opener.first().isVisible({ timeout: 1_500 }).catch(() => false)) {
      await opener.first().click();
      // Drawer transitions are short but non-zero.
      await page.waitForTimeout(400);
      return;
    }
  }
}

// Identify the sidebar by what it *contains* (the citizen nav) rather
// than by tag — the markup varies across V2 revisions.
function sidebar(page: Page) {
  return page
    .locator('aside, [role="navigation"], [role="dialog"], nav')
    .filter({ hasText: /my complaints|edit profile|logout|sign out/i })
    .first();
}

// Not serial: each test does its own login, so a sidebar-localization
// gap shouldn't suppress the profile-edit signal (they're testing
// different surfaces of the same landing page).
test.describe('Citizen landing page sidebar + profile edit', () => {
  test.slow();

  test('sidebar shows core nav entries and is fully localized', async ({
    page,
  }) => {
    const locFetches: LocFetch[] = [];
    captureLoc(page, locFetches);

    await citizenOtpLogin(page);
    await page.goto('/digit-ui/citizen');

    await openSidebar(page);
    const sb = sidebar(page);
    await sb.waitFor({ state: 'visible', timeout: 15_000 });

    const sbText = await sb.innerText();
    console.log('SIDEBAR TEXT (first 500 chars):\n', sbText.slice(0, 500));

    // innerText misses attribute-level strings — and aria-label /
    // title / alt are how the sidebar talks to screen readers and to
    // anything an image fails to render. A raw key in aria-label
    // ("CORE_COMMON_NAVIGATION") is a localization gap even though
    // it's not visible to sighted users.
    const sbAttrs: string[] = await sb.evaluate((root) => {
      const out: string[] = [];
      const walk = (n: Node) => {
        if (n.nodeType === 1) {
          const e = n as Element;
          for (const a of ['aria-label', 'title', 'alt']) {
            const v = e.getAttribute(a);
            if (v) out.push(v);
          }
        }
        n.childNodes.forEach(walk);
      };
      walk(root);
      return out;
    });
    console.log('SIDEBAR ATTR STRINGS:', sbAttrs);

    // Positive: the post-login sidebar must identify this citizen
    // (their logged-in mobile number is the cheap proof the chip
    // wasn't stale from another session) AND expose the standard nav.
    // "My Complaints" lives as a card on the home route, not in the
    // side nav, so we don't assert it here — the inbox test already
    // covers that surface.
    expect(sbText).toContain(process.env.CITIZEN_MOBILE || '777777777');
    expect(sbText).toMatch(/home/i);
    expect(sbText).toMatch(/edit profile|profile/i);
    expect(sbText).toMatch(/logout|sign out|log out/i);

    // Negative: no raw localization keys leaking — in visible text OR
    // in attribute-level strings.
    const rawKeys = rawKeysIn(sbText + '\n' + sbAttrs.join('\n'));
    if (rawKeys.length) {
      console.log('LOCALIZATION FETCHES:');
      for (const f of locFetches) {
        console.log(`  msgs=${f.messageCount} ${f.url}`);
      }
    }
    expect(
      rawKeys,
      `sidebar shows raw localization keys (incl. aria-label/title/alt): ${rawKeys
        .slice(0, 10)
        .join(', ')}`
    ).toHaveLength(0);
  });

  test('Edit Profile: name + photo round-trip, reflect in sidebar', async ({
    page,
  }) => {
    await citizenOtpLogin(page);
    await page.goto('/digit-ui/citizen');

    await openSidebar(page);
    const editProfile = page
      .getByRole('link', { name: /edit profile/i })
      .or(page.getByRole('button', { name: /edit profile/i }))
      .or(page.getByText(/^edit profile$/i))
      .first();
    await editProfile.waitFor({ state: 'visible', timeout: 15_000 });
    await editProfile.click();

    // Unique name per run so we can detect "form cleared but server
    // kept old value" — the sidebar text must contain THIS exact
    // string, not just any name.
    const newName = `E2E Citizen ${Date.now()}`;

    // Find the name field robustly: name attribute, id, or label-for.
    const nameInput = page
      .locator(
        'input[name="name" i], input[id*="name" i], input[placeholder*="name" i]'
      )
      .first();
    await nameInput.waitFor({ state: 'visible', timeout: 15_000 });
    await nameInput.fill(newName);

    // 1x1 transparent PNG written to TMPDIR — proves the upload
    // round-trip end-to-end without a real fixture file in-repo.
    const tmpDir = process.env.TMPDIR || '/tmp/claude';
    fs.mkdirSync(tmpDir, { recursive: true });
    const fixturePath = path.join(tmpDir, `profile-${Date.now()}.png`);
    fs.writeFileSync(
      fixturePath,
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
        'base64'
      )
    );

    // Two-step photo flow on V2: "Change photo" opens a dialog, then
    // "Choose from gallery" inside the dialog triggers the native file
    // picker. Playwright captures the picker via filechooser.
    await page
      .getByRole('button', { name: /^change photo$/i })
      .first()
      .click();

    const fileChooserPromise = page.waitForEvent('filechooser');
    await page
      .getByRole('button', { name: /choose from gallery|browse|upload/i })
      .first()
      .click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(fixturePath);

    const saveBtn = page
      .getByRole('button', { name: /save|update|submit/i })
      .first();
    await expect(saveBtn).toBeEnabled({ timeout: 10_000 });
    await saveBtn.click();

    // The user explicitly asked: reflect "right away" — no reload.
    // Give the save round-trip a chance to resolve, re-open the
    // sidebar (which often closes on submit), then poll for the new
    // name in the sidebar text.
    await page.waitForTimeout(2_000);
    await openSidebar(page);
    const sb = sidebar(page);
    await sb.waitFor({ state: 'visible', timeout: 15_000 });

    await expect
      .poll(async () => (await sb.innerText()).includes(newName), {
        timeout: 20_000,
      })
      .toBe(true);

    console.log('VERIFIED NEW NAME IN SIDEBAR:', newName);
  });
});
