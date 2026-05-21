import { launchBrowser, login, navigateTo, clickCreate, fillField, selectOption, submitCreate, verifyInList, screenshot, uniqueId } from '../helpers.mjs';

export const name = 'complaint-types';
export const description = 'Create a complaint type and verify it appears in the list';

export async function run() {
  const browser = await launchBrowser();
  const page = await browser.newPage();
  try {
    await login(page);
    await navigateTo(page, 'complaint-types');

    const serviceCode = uniqueId('E2E_CT');
    const ctName = `E2E Complaint Type ${Date.now()}`;

    await clickCreate(page);
    await fillField(page, 'Service Code', serviceCode);
    await fillField(page, 'Name', ctName);
    // Department is now a dropdown that fetches from departments resource
    await selectOption(page, 'Department', 'DEPT_1');
    await fillField(page, 'SLA (hours)', '72');
    await submitCreate(page);

    await verifyInList(page, serviceCode);

    return { success: true, created: { serviceCode, name: ctName } };
  } catch (err) {
    await screenshot(page, 'complaint-types-failure');
    return { success: false, error: err.message };
  } finally {
    await browser.close();
  }
}
