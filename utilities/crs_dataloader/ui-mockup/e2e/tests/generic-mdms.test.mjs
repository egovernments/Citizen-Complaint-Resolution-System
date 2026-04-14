import { launchBrowser, login, navigateTo, clickCreate, fillField, submitCreate, verifyInList, screenshot, uniqueId } from '../helpers.mjs';

export const name = 'generic-mdms';
export const description = 'Create a generic MDMS record (state-info) via schema-driven form';

export async function run() {
  const browser = await launchBrowser();
  const page = await browser.newPage();
  try {
    await login(page);
    await navigateTo(page, 'state-info');

    const code = uniqueId('E2E_SI');
    const siName = `E2E StateInfo ${Date.now()}`;

    await clickCreate(page);
    await fillField(page, 'Name', siName);
    await fillField(page, 'Code', code);
    await submitCreate(page, 'state-info');

    await verifyInList(page, code);

    return { success: true, created: { code, name: siName } };
  } catch (err) {
    await screenshot(page, 'generic-mdms-failure');
    return { success: false, error: err.message };
  } finally {
    await browser.close();
  }
}
