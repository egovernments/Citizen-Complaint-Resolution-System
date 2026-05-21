import { launchBrowser, login, navigateTo, clickCreate, fillField, submitCreate, verifyInList, screenshot, uniqueId } from '../helpers.mjs';

export const name = 'users';
export const description = 'Create a user and verify it appears in the list';

export async function run() {
  const browser = await launchBrowser();
  const page = await browser.newPage();
  try {
    await login(page);
    await navigateTo(page, 'users');

    const userName = uniqueId('e2euser');
    const name = `E2E User ${Date.now()}`;
    const mobile = `9${String(Date.now()).slice(-9)}`;

    await clickCreate(page);
    await fillField(page, 'Username', userName);
    await fillField(page, 'Name', name);
    await fillField(page, 'Mobile Number', mobile);
    await submitCreate(page);

    // Search by userName (client-side q filter matches across all fields)
    await verifyInList(page, userName);

    return { success: true, created: { userName, name, mobile } };
  } catch (err) {
    await screenshot(page, 'users-failure');
    return { success: false, error: err.message };
  } finally {
    await browser.close();
  }
}
