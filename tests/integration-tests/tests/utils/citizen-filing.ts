/**
 * Develop's citizen "File a Complaint" flow (digit-ui-esbuild
 * products/pgr/.../Create/CreatePGRFlowV2.tsx, the #2038 design): three steps.
 *
 *   1. details:  the description (required, at least three letters), photos,
 *                and every complaint-category level
 *   2. location: the optional map pin, every boundary level down to the leaf,
 *                postal code (optional) and landmark
 *   3. review, then "Submit complaint"
 *
 * All panes stay mounted and only the current one shows, so every lookup is
 * scoped to the visible pane. The footer's primary button (`.cms-next`) is
 * Next on steps 1-2 and Submit on the review; it stays disabled until the
 * step is valid, with the reason in `.cms-hint`.
 */
import { expect, type Locator, type Page } from '@playwright/test';
import { BASE_URL } from './env';
import { surfacePath } from './identity-bff';

export const fileComplaintUrl = () => `${BASE_URL}${surfacePath('citizen', 'pgr/create-complaint/complaint-type')}`;

/** The step pane on screen. */
export const currentPane = (page: Page): Locator => page.locator('.cms-step-pane:not(.is-hidden)');

/** Next on steps 1-2, "Submit complaint" on the review. */
export const primaryButton = (page: Page): Locator => page.locator('button.cms-next');

/**
 * Pick the first option of each still-empty, enabled select in `scope`, top
 * level first, until none is left (category levels, or the boundary down to
 * its leaf). `onPick` runs after each choice.
 */
export async function pickEveryLevel(page: Page, scope: Locator, onPick?: (level: number) => Promise<void>): Promise<void> {
  for (let level = 0; level < 8; level++) {
    const empty = scope.locator('button[role="combobox"]:enabled').filter({ hasText: /^\s*Select/i }).first();
    if (!(await empty.isVisible({ timeout: 5_000 }).catch(() => false))) break;
    await empty.scrollIntoViewIfNeeded();
    await empty.click();
    const option = page.locator('[role="listbox"] [role="option"]:visible').first();
    await expect(option, 'an open level must offer options').toBeVisible({ timeout: 10_000 });
    await option.click();
    await page.waitForTimeout(1_000);
    await onPick?.(level);
  }
}

/** Step 1: describe the complaint and choose every category level. */
export async function fillDetailsStep(page: Page, opts: {
  description?: string;
  onAfterStep?: (label: string) => Promise<void>;
} = {}): Promise<void> {
  const description = page.locator('#complaint-description');
  await expect(description, 'the details step must render its description box').toBeVisible({ timeout: 20_000 });
  await opts.onAfterStep?.('Step 1 – Complaint details');
  await description.fill(opts.description ?? `PW citizen filing ${Date.now()} — auto-filed, please ignore`);
  await pickEveryLevel(page, currentPane(page), async (level) => {
    await opts.onAfterStep?.(`Step 1 – after category level ${level}`);
  });
}

/** Step 2: choose every boundary level down to the leaf (no map pin). */
export async function fillLocationStep(page: Page, opts: { onAfterStep?: (label: string) => Promise<void> } = {}): Promise<void> {
  const cascade = currentPane(page).locator('.pgr-boundary-cascade');
  await expect(cascade, 'the location step must render its boundary cascade').toBeVisible({ timeout: 20_000 });
  await opts.onAfterStep?.('Step 2 – Location');
  await pickEveryLevel(page, cascade, async (level) => {
    await opts.onAfterStep?.(`Step 2 – after boundary level ${level}`);
  });
}

/** Click the enabled primary button (Next, or Submit on the review). */
export async function continueFiling(page: Page): Promise<void> {
  const button = primaryButton(page);
  await expect(button, `Next stays disabled: ${await page.locator('.cms-hint').innerText().catch(() => '')}`).toBeEnabled({ timeout: 15_000 });
  await button.scrollIntoViewIfNeeded();
  await button.click();
  await page.waitForTimeout(1_500);
}

/** Details, location, review and submit; waits for the response page. */
export async function fileComplaintViaWizard(page: Page, opts: {
  description?: string;
  onAfterStep?: (label: string) => Promise<void>;
} = {}): Promise<void> {
  await fillDetailsStep(page, opts);
  await continueFiling(page);
  await fillLocationStep(page, opts);
  await continueFiling(page);
  await opts.onAfterStep?.('Step 3 – Review');
  await expect(primaryButton(page)).toHaveText(/submit/i);
  await continueFiling(page);
  await page.waitForURL(/\/citizen\/pgr\/response/, { timeout: 30_000 });
}
