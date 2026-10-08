/**
 * Locators for the configurator's label-independent data-testid hooks
 * (#2351 develop / #2352 master), each with a fallback to the visible label
 * for builds that predate the hooks.
 *
 * Why: locators that match copy break whenever the copy changes. #2243's
 * "Sub-types" → "Subcategories" rename stalled the 6 onboarding Phase 4
 * tests at their timeout and pushed the bomet run past its cap (#2346). The
 * hook is what these tests rely on; the label fallback only keeps
 * deployments running an older configurator image working.
 *
 * `.or(…).first()`: on a build with the hook, the hook and the label can
 * match the same element (a button) or two (a wrapper and its text), and
 * Playwright locators are strict, so the union is narrowed to its first
 * match in DOM order — the hook, where both exist.
 */
import { expect, type Locator, type Page } from '@playwright/test';

/** The element carrying `data-testid=testId`, or `fallback` on builds without it. */
export function hookOr(page: Page, testId: string, fallback: Locator): Locator {
  return page.getByTestId(testId).or(fallback).first();
}

/**
 * ComplaintHierarchySetup showing `step` (its root carries
 * data-step="define|template|verify"), or the step's heading on older builds.
 */
export function hierarchyStep(page: Page, step: 'define' | 'template' | 'verify', heading: string): Locator {
  return page
    .locator(`[data-testid="complaint-hierarchy-setup"][data-step="${step}"]`)
    .or(page.getByText(heading))
    .first();
}

/**
 * Wait until the ReverseReferenceList for `resource` has settled.
 *
 * With the hook, it must reach data-state="empty" or "loaded". "error" fails:
 * a failed lookup still shows the "No … found" copy, so the label alone can't
 * tell it from a genuinely empty list. So does staying "loading". The hook is
 * already present while loading, so this asserts the state rather than mere
 * presence. Builds without the hook fall back to `fallback` (the label or
 * its empty-state sentence).
 */
export async function expectRelatedListSettled(page: Page, resource: string, fallback: Locator): Promise<void> {
  const hook = page.getByTestId(`reverse-ref-${resource}`);
  await expect(hook.or(fallback).first()).toBeVisible();
  if ((await hook.count()) > 0) {
    await expect(hook, `reverse-ref-${resource} should settle as empty or loaded, not loading/error`)
      .toHaveAttribute('data-state', /^(empty|loaded)$/);
  }
}
