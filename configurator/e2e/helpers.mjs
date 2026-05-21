import puppeteer from 'puppeteer';
import { mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS_DIR = join(__dirname, 'screenshots');

const BASE_URL = process.env.E2E_BASE_URL || 'https://crs-mockup.egov.theflywheel.in';
const CREDENTIALS = {
  username: process.env.E2E_USERNAME || 'ADMIN',
  password: process.env.E2E_PASSWORD || 'eGov@123',
  tenant: process.env.E2E_TENANT || 'pg',
};

// Timeouts
const NAV_TIMEOUT = 30_000;
const ACTION_TIMEOUT = 10_000;

export async function launchBrowser() {
  return puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
  });
}

export async function login(page) {
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle2', timeout: NAV_TIMEOUT });

  // Click the Management mode button
  const modeButtons = await page.$$('button[type="button"]');
  for (const btn of modeButtons) {
    const text = await btn.evaluate(el => el.textContent);
    if (text?.includes('Management')) {
      await btn.click();
      break;
    }
  }

  // Fill in tenant code (default form value is statea, but ADMIN is in pg)
  const tenantInput = await page.$('#tenantCode');
  if (tenantInput) {
    await tenantInput.click({ clickCount: 3 });
    await tenantInput.type(CREDENTIALS.tenant, { delay: 10 });
  }

  // Small pause for form state to settle
  await new Promise(r => setTimeout(r, 300));

  // Click the Sign In submit button
  const submitBtn = await page.waitForSelector('button[type="submit"]', { timeout: ACTION_TIMEOUT });
  await submitBtn.click();

  // Wait for navigation to /manage (the management dashboard)
  await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: NAV_TIMEOUT });

  // Verify we landed on /manage
  const url = page.url();
  if (!url.includes('/manage')) {
    throw new Error(`Login failed — landed on ${url} instead of /manage`);
  }
}

export async function navigateTo(page, resource) {
  await page.goto(`${BASE_URL}/manage/${resource}`, { waitUntil: 'networkidle2', timeout: NAV_TIMEOUT });

  // Wait for either the list data to load or the "No records found" empty state
  await page.waitForSelector('table, [class*="text-center"]', { timeout: NAV_TIMEOUT });

  // Give the list a moment to finish rendering
  await new Promise(r => setTimeout(r, 500));
}

export async function clickCreate(page) {
  // Find and click the Create button in the list header
  const createBtn = await page.waitForSelector('button:has(svg)', { timeout: ACTION_TIMEOUT });

  // More specific: find the button that contains "Create" text
  const buttons = await page.$$('button');
  let clicked = false;
  for (const btn of buttons) {
    const text = await btn.evaluate(el => el.textContent?.trim());
    if (text === 'Create') {
      await btn.click();
      clicked = true;
      break;
    }
  }

  if (!clicked) {
    throw new Error('Could not find "Create" button on the list page');
  }

  // Wait for the create form to appear (DigitCreate renders a Form with inputs)
  await page.waitForSelector('form', { timeout: NAV_TIMEOUT });
  await new Promise(r => setTimeout(r, 500));
}

export async function fillField(page, label, value, opts = {}) {
  // Find the label element, then find the associated input
  const labels = await page.$$('label');
  let targetInput = null;

  for (const labelEl of labels) {
    const text = await labelEl.evaluate(el => el.textContent?.replace('*', '').trim());
    if (text === label) {
      const forId = await labelEl.evaluate(el => el.getAttribute('for'));
      if (forId) {
        // CSS.escape doesn't exist in Node — use page.evaluate to find by ID
        targetInput = await page.$(`#${forId.replace(/([^\w-])/g, '\\$1')}`);
      }
      break;
    }
  }

  if (!targetInput) {
    // Fallback: try to find input by placeholder
    targetInput = await page.$(`input[placeholder="${label}"]`);
  }

  if (!targetInput) {
    throw new Error(`Could not find input for label "${label}"`);
  }

  // Clear existing value and type new one
  await targetInput.click({ clickCount: 3 }); // Select all
  await targetInput.type(value, { delay: 20 });
}

export async function selectOption(page, label, value) {
  // Find the label element, then find the associated select trigger
  const labels = await page.$$('label');
  let triggerId = null;

  for (const labelEl of labels) {
    const text = await labelEl.evaluate(el => el.textContent?.replace('*', '').trim());
    if (text === label) {
      triggerId = await labelEl.evaluate(el => el.getAttribute('for'));
      break;
    }
  }

  if (!triggerId) {
    throw new Error(`Could not find label "${label}" for select`);
  }

  // Click the trigger to open the dropdown
  const trigger = await page.$(`#${triggerId.replace(/([^\w-])/g, '\\$1')}`);
  if (!trigger) {
    throw new Error(`Could not find select trigger for label "${label}"`);
  }
  await trigger.click();

  // Wait for the dropdown options to appear (Radix portals to body)
  await page.waitForSelector('[role="option"]', { timeout: ACTION_TIMEOUT });
  await new Promise(r => setTimeout(r, 200));

  // Find and click the option matching the value
  const items = await page.$$('[role="option"]');
  let clicked = false;
  for (const item of items) {
    // Radix SelectItem uses the `value` prop — try both data-value and textContent match
    const itemValue = await item.evaluate(el => el.getAttribute('data-value'));
    const itemText = await item.evaluate(el => el.textContent?.trim());
    if (itemValue === value || itemText === value) {
      await item.click();
      clicked = true;
      break;
    }
  }

  if (!clicked) {
    throw new Error(`Could not find option "${value}" in select for "${label}"`);
  }

  // Wait for dropdown to close
  await new Promise(r => setTimeout(r, 200));
}

export async function selectFirstOption(page, label) {
  // Find the label element, then find the associated select trigger
  const labels = await page.$$('label');
  let triggerId = null;

  for (const labelEl of labels) {
    const text = await labelEl.evaluate(el => el.textContent?.replace('*', '').trim());
    if (text === label) {
      triggerId = await labelEl.evaluate(el => el.getAttribute('for'));
      break;
    }
  }

  if (!triggerId) {
    throw new Error(`Could not find label "${label}" for select`);
  }

  const trigger = await page.$(`#${triggerId.replace(/([^\w-])/g, '\\$1')}`);
  if (!trigger) {
    throw new Error(`Could not find select trigger for label "${label}"`);
  }
  await trigger.click();

  // Wait for options to appear
  await page.waitForSelector('[role="option"]', { timeout: ACTION_TIMEOUT });
  await new Promise(r => setTimeout(r, 200));

  // Click the first option
  const firstItem = await page.$('[role="option"]');
  if (!firstItem) {
    throw new Error(`No options available in select for "${label}"`);
  }
  const selectedValue = await firstItem.evaluate(el => el.getAttribute('data-value') || el.textContent?.trim());
  await firstItem.click();
  await new Promise(r => setTimeout(r, 200));
  return selectedValue;
}

export async function submitCreate(page) {
  const urlBefore = page.url();

  // Capture API errors from browser console
  const apiErrors = [];
  const errorHandler = msg => {
    if (msg.type() === 'error') {
      const text = msg.text();
      if (text.includes('ApiClientError') || text.includes('Error:')) {
        apiErrors.push(text.substring(0, 300));
      }
    }
  };
  page.on('console', errorHandler);

  // Find the submit button (type="submit" with "Create" text)
  const submitBtn = await page.waitForSelector('button[type="submit"]', { timeout: ACTION_TIMEOUT });
  await submitBtn.click();

  // Wait for the URL to change (react-admin does client-side routing)
  const deadline = Date.now() + NAV_TIMEOUT;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 500));

    const currentUrl = page.url();
    if (currentUrl !== urlBefore && !currentUrl.includes('/create')) {
      page.off('console', errorHandler);
      await new Promise(r => setTimeout(r, 500)); // Let list settle
      return;
    }

    // If we got API errors, fail fast with the actual error message
    if (apiErrors.length > 0) {
      page.off('console', errorHandler);
      throw new Error(apiErrors[0]);
    }
  }

  page.off('console', errorHandler);

  // If we're still on /create after timeout, it failed
  if (page.url().includes('/create')) {
    throw new Error(apiErrors[0] || 'Create form did not navigate away after submission');
  }
}

export async function verifyInList(page, searchText) {
  // Type in the search input
  const searchInput = await page.waitForSelector('input[placeholder="Search..."]', { timeout: ACTION_TIMEOUT });
  await searchInput.click({ clickCount: 3 });
  await searchInput.type(searchText, { delay: 20 });

  // Wait for the list to filter
  await new Promise(r => setTimeout(r, 1500));

  // Check if the search text appears in the table
  const pageContent = await page.evaluate(() => document.body.innerText);
  if (!pageContent.includes(searchText)) {
    throw new Error(`Created record "${searchText}" not found in the list after search`);
  }
}

export async function screenshot(page, name) {
  mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  const path = join(SCREENSHOTS_DIR, `${name}-${Date.now()}.png`);
  await page.screenshot({ path, fullPage: true });
  return path;
}

export function uniqueId(prefix) {
  return `${prefix}_${Date.now()}`;
}
