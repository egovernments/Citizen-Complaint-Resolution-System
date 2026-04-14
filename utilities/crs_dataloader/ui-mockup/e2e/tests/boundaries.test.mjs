import { launchBrowser, login, navigateTo, clickCreate, fillField, submitCreate, verifyInList, screenshot, uniqueId } from '../helpers.mjs';

export const name = 'boundaries';
export const description = 'Create a boundary and verify it appears in the list';

export async function run() {
  const browser = await launchBrowser();
  const page = await browser.newPage();
  try {
    await login(page);
    await navigateTo(page, 'boundaries');

    const code = uniqueId('E2E_BND');

    await clickCreate(page);
    await fillField(page, 'Code', code);
    // Boundary Type defaults to Locality — keep it as-is (changing type requires parent hierarchy)
    await submitCreate(page);

    await verifyInList(page, code);

    return { success: true, created: { code } };
  } catch (err) {
    await screenshot(page, 'boundaries-failure');
    return { success: false, error: err.message };
  } finally {
    await browser.close();
  }
}
