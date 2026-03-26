import { launchBrowser, login, navigateTo, clickCreate, fillField, submitCreate, verifyInList, screenshot, uniqueId } from '../helpers.mjs';

export const name = 'designations';
export const description = 'Create a designation and verify it appears in the list';

export async function run() {
  const browser = await launchBrowser();
  const page = await browser.newPage();
  try {
    await login(page);
    await navigateTo(page, 'designations');

    const code = uniqueId('E2E_DESG');
    const desgName = `E2E Designation ${Date.now()}`;

    await clickCreate(page);
    await fillField(page, 'Code', code);
    await fillField(page, 'Name', desgName);
    await fillField(page, 'Description', 'Created by E2E test');
    await submitCreate(page);

    await verifyInList(page, code);

    return { success: true, created: { code, name: desgName } };
  } catch (err) {
    await screenshot(page, 'designations-failure');
    return { success: false, error: err.message };
  } finally {
    await browser.close();
  }
}
