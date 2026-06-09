import { launchBrowser, login, navigateTo, clickCreate, fillField, selectOption, submitCreate, verifyInList, screenshot, uniqueId } from '../helpers.mjs';

export const name = 'localization';
export const description = 'Create a localization message and verify it appears in the list';

export async function run() {
  const browser = await launchBrowser();
  const page = await browser.newPage();
  try {
    await login(page);
    await navigateTo(page, 'localization');

    const code = uniqueId('E2E_LOC');

    await clickCreate(page);
    await fillField(page, 'Code', code);
    await fillField(page, 'Message', `Test message ${Date.now()}`);
    // Module defaults to rainmaker-common, but test the select interaction
    await selectOption(page, 'Module', 'rainmaker-common');
    // Locale defaults to en_IN via the default record
    await selectOption(page, 'Locale', 'en_IN');
    await submitCreate(page);

    await verifyInList(page, code);

    return { success: true, created: { code } };
  } catch (err) {
    await screenshot(page, 'localization-failure');
    return { success: false, error: err.message };
  } finally {
    await browser.close();
  }
}
