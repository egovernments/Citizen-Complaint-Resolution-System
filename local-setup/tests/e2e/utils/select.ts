/**
 * Pick an option in a digit-ui-components-v2 Select by keyboard. Its popover
 * hangs off the trigger and can sit outside the viewport (the complaint
 * wizard's category field is low on a tall step), where a mouse click never
 * lands. Opening focuses the search box and highlights the first option;
 * typing narrows to the first match; Enter commits the highlighted option.
 */
import { expect, type Locator, type Page } from '@playwright/test';

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Returns the picked option's label: the first option, or the one called `name` (case-insensitive). */
export async function pickSelectOption(page: Page, combo: Locator, name?: string): Promise<string> {
  await expect(combo).toBeEnabled({ timeout: 15_000 });
  const first = page.getByRole('option').first();
  // A click while the options are still loading can leave the list closed
  // (it remounts when they arrive), so reopen until an option is there. The
  // trigger toggles, so only click it while aria-expanded says closed.
  await expect(async () => {
    if (await combo.getAttribute('aria-expanded') !== 'true') await combo.click();
    await expect(first).toBeAttached({ timeout: 2_000 });
  }, 'the Select never listed an option').toPass({ timeout: 20_000 });
  await expect.poll(() => page.evaluate(() => document.activeElement?.tagName), { message: 'the Select search box did not take focus' })
    .toBe('INPUT');
  if (name) {
    await page.keyboard.type(name);
    await expect(first, `no option named "${name}"`).toHaveText(new RegExp(`^\\s*${escapeRegExp(name)}\\s*$`, 'i'), { timeout: 10_000 });
  }
  const label = (await first.innerText()).trim();
  await page.keyboard.press('Enter');
  await expect(combo).toContainText(label, { timeout: 5_000 });
  return label;
}
