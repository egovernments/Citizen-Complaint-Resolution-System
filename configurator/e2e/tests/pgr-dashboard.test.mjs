import { launchBrowser, login, screenshot } from '../helpers.mjs';

export const name = 'pgr-dashboard';
export const description = 'Navigate to PGR Dashboard and verify charts render';

const NAV_TIMEOUT = 30_000;

export async function run() {
  const browser = await launchBrowser();
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  try {
    await login(page);

    // Navigate to PGR Dashboard
    const baseUrl = process.env.E2E_BASE_URL || 'https://crs-mockup.egov.theflywheel.in';
    await page.goto(`${baseUrl}/manage/pgr-dashboard`, {
      waitUntil: 'networkidle2',
      timeout: NAV_TIMEOUT,
    });

    // Verify we're on the right page
    const url = page.url();
    if (!url.includes('/pgr-dashboard')) {
      throw new Error(`Did not navigate to PGR Dashboard — landed on ${url}`);
    }

    // Wait for the page heading
    await page.waitForSelector('h1', { timeout: NAV_TIMEOUT });
    const heading = await page.$eval('h1', el => el.textContent?.trim());
    if (!heading?.includes('PGR Dashboard')) {
      throw new Error(`Expected heading "PGR Dashboard", got "${heading}"`);
    }

    // Wait for Chart.js canvases to render (charts use <canvas> elements)
    await page.waitForSelector('canvas', { timeout: NAV_TIMEOUT });
    await new Promise(r => setTimeout(r, 1000)); // Let charts animate

    // Count canvases — we expect 7 charts:
    // 1. Opened vs Closed line
    // 2. By Source line
    // 3. By Status bar
    // 4. Status donut
    // 5. Department donut
    // 6. Channel donut
    // 7. Resolution duration line
    // 8. Top complaints horizontal bar
    const canvasCount = await page.$$eval('canvas', els => els.length);
    if (canvasCount < 7) {
      throw new Error(`Expected at least 7 chart canvases, found ${canvasCount}`);
    }

    // Verify KPI cards are present — check for key text
    const pageText = await page.evaluate(() => document.body.innerText);
    const requiredTexts = [
      'Total Complaints',
      'Closed Complaints',
      'SLA Achieved',
      'Completion Rate',
      'Avg. Resolution',
    ];
    const missing = requiredTexts.filter(t => !pageText.includes(t));
    if (missing.length > 0) {
      throw new Error(`Missing KPI cards: ${missing.join(', ')}`);
    }

    // Verify chart section titles
    const chartTitles = [
      'Complaints Opened vs Closed',
      'Complaints by Source',
      'Complaints by Status',
      'Status Distribution',
      'By Department',
      'By Channel',
      'Top 10 Complaint Types',
    ];
    const missingCharts = chartTitles.filter(t => !pageText.includes(t));
    if (missingCharts.length > 0) {
      throw new Error(`Missing chart sections: ${missingCharts.join(', ')}`);
    }

    // Take a screenshot for visual verification
    const screenshotPath = await screenshot(page, 'pgr-dashboard-success');

    return {
      success: true,
      details: {
        heading,
        canvasCount,
        kpiCards: requiredTexts.length,
        chartSections: chartTitles.length,
        screenshot: screenshotPath,
      },
    };
  } catch (err) {
    await screenshot(page, 'pgr-dashboard-failure');
    return { success: false, error: err.message };
  } finally {
    await browser.close();
  }
}
