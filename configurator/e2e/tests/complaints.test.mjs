import { launchBrowser, login, navigateTo, clickCreate, fillField, selectFirstOption, submitCreate, verifyInList, screenshot, uniqueId } from '../helpers.mjs';

export const name = 'complaints';
export const description = 'File a complaint and verify it appears in the list';

export async function run() {
  const browser = await launchBrowser();
  const page = await browser.newPage();
  try {
    await login(page);
    await navigateTo(page, 'complaints');

    const desc = `E2E complaint ${Date.now()}`;

    await clickCreate(page);
    // Complaint Type — pick the first available complaint type
    await selectFirstOption(page, 'Complaint Type');
    await fillField(page, 'Description', desc);
    // Locality — pick the first available boundary
    await selectFirstOption(page, 'Locality');
    await fillField(page, 'City', 'pg.citya');
    await submitCreate(page);

    // Search by description text (client-side q filter matches across all fields)
    await verifyInList(page, desc);

    return { success: true, created: { description: desc } };
  } catch (err) {
    await screenshot(page, 'complaints-failure');
    return { success: false, error: err.message };
  } finally {
    await browser.close();
  }
}
