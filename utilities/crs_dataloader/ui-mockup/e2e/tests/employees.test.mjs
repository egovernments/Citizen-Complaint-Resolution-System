import { launchBrowser, login, navigateTo, clickCreate, fillField, submitCreate, verifyInList, screenshot, uniqueId } from '../helpers.mjs';

export const name = 'employees';
export const description = 'Create an employee and verify it appears in the list';

export async function run() {
  const browser = await launchBrowser();
  const page = await browser.newPage();
  try {
    await login(page);
    await navigateTo(page, 'employees');

    const code = uniqueId('E2E_EMP');
    const empName = `E2E Employee ${Date.now()}`;
    const mobile = `9${String(Date.now()).slice(-9)}`;

    await clickCreate(page);
    await fillField(page, 'Employee Code', code);
    await fillField(page, 'Name', empName);
    await fillField(page, 'Mobile Number', mobile);
    await submitCreate(page);

    await verifyInList(page, code);

    return { success: true, created: { code, name: empName, mobile } };
  } catch (err) {
    await screenshot(page, 'employees-failure');
    return { success: false, error: err.message };
  } finally {
    await browser.close();
  }
}
