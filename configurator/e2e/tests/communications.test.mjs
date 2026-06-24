import { launchBrowser, screenshot } from '../helpers.mjs';

export const name = 'communications';
export const description = 'Toggle a notification channel in the Communications step and verify it persists';

// The shared login() helper logs in via Management mode and lands on /manage.
// The Communications step lives in the onboarding flow, so we log in as
// Onboarding here instead.
const BASE_URL = process.env.E2E_BASE_URL || 'https://crs-mockup.egov.theflywheel.in';
const CREDENTIALS = {
  username: process.env.E2E_USERNAME || 'ADMIN',
  password: process.env.E2E_PASSWORD || 'eGov@123',
  tenant: process.env.E2E_TENANT || 'pg',
};
const NAV_TIMEOUT = 30_000;
const ACTION_TIMEOUT = 10_000;

const WA_SWITCH = '[role="switch"][aria-label="Enable WhatsApp"]';

async function loginOnboarding(page) {
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle2', timeout: NAV_TIMEOUT });

  // Onboarding is the default mode, but click it explicitly to be safe.
  await clickByText(page, 'Onboarding').catch(() => {});

  await typeInto(page, '#username', CREDENTIALS.username);
  await typeInto(page, '#password', CREDENTIALS.password);
  await typeInto(page, '#tenantCode', CREDENTIALS.tenant);

  await new Promise((r) => setTimeout(r, 300));
  const submit = await page.waitForSelector('button[type="submit"]', { timeout: ACTION_TIMEOUT });
  await submit.click();
  await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: NAV_TIMEOUT });

  const url = page.url();
  if (!/\/phase\/\d|\/$/.test(url)) {
    throw new Error(`Onboarding login failed — landed on ${url}`);
  }
}

async function typeInto(page, selector, value) {
  const el = await page.$(selector);
  if (!el) return; // field may be absent in some builds; let later steps fail loudly
  await el.click({ clickCount: 3 });
  await el.type(value, { delay: 10 });
}

async function clickByText(page, text) {
  const clicked = await page.evaluate((t) => {
    const btn = [...document.querySelectorAll('button')].find((el) => el.textContent?.includes(t));
    if (btn) {
      btn.click();
      return true;
    }
    return false;
  }, text);
  if (!clicked) throw new Error(`Button not found: "${text}"`);
}

async function readSwitch(page, selector) {
  return page.$eval(selector, (el) => el.getAttribute('aria-checked'));
}

/** Drive the WhatsApp switch to `desired` (true/false) then Save & Continue. */
async function setWhatsappAndSave(page, desired) {
  await page.waitForSelector(WA_SWITCH, { timeout: ACTION_TIMEOUT });
  const current = (await readSwitch(page, WA_SWITCH)) === 'true';
  if (current !== desired) await page.click(WA_SWITCH);

  await clickByText(page, 'Save & Continue');
  await page.waitForFunction(() => location.pathname.endsWith('/complete'), { timeout: NAV_TIMEOUT });
}

export async function run() {
  const browser = await launchBrowser();
  const page = await browser.newPage();
  try {
    await loginOnboarding(page);

    // Enable WhatsApp and save.
    await page.goto(`${BASE_URL}/phase/5`, { waitUntil: 'networkidle2', timeout: NAV_TIMEOUT });
    await setWhatsappAndSave(page, true);

    // Re-enter the step: the toggle must reflect the persisted config-service
    // record (proves the write round-tripped, not just local UI state).
    await page.goto(`${BASE_URL}/phase/5`, { waitUntil: 'networkidle2', timeout: NAV_TIMEOUT });
    await page.waitForSelector(WA_SWITCH, { timeout: ACTION_TIMEOUT });
    const persisted = await readSwitch(page, WA_SWITCH);
    if (persisted !== 'true') {
      throw new Error(`WhatsApp toggle did not persist — aria-checked=${persisted} after reload`);
    }

    // Cleanup: restore default-OFF so the test is idempotent across runs.
    await setWhatsappAndSave(page, false);

    return { success: true, verified: { whatsappPersistedEnabled: true } };
  } catch (err) {
    await screenshot(page, 'communications-failure');
    return { success: false, error: err.message };
  } finally {
    await browser.close();
  }
}
