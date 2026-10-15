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
  await combo.click();
  const first = page.getByRole('option').first();
  await expect(first).toBeAttached({ timeout: 20_000 });
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
