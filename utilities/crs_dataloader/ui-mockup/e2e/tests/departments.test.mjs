import { launchBrowser, login, navigateTo, clickCreate, fillField, submitCreate, verifyInList, screenshot, uniqueId } from '../helpers.mjs';

export const name = 'departments';
export const description = 'Create a department and verify it appears in the list';

export async function run() {
  const browser = await launchBrowser();
  const page = await browser.newPage();
  try {
    await login(page);
    await navigateTo(page, 'departments');

    const code = uniqueId('E2E_DEPT');
    const deptName = `E2E Department ${Date.now()}`;

    await clickCreate(page);
    await fillField(page, 'Code', code);
    await fillField(page, 'Name', deptName);
    await submitCreate(page);

    await verifyInList(page, code);

    return { success: true, created: { code, name: deptName } };
  } catch (err) {
    await screenshot(page, 'departments-failure');
    return { success: false, error: err.message };
  } finally {
    await browser.close();
  }
}
