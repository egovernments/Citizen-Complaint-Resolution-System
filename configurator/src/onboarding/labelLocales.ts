import { mdmsService } from '@/api';
import { i18nProvider } from '@/providers/i18nProvider';

/**
 * Locales the onboarding steps write labels under and read them from.
 *
 * digit-ui boots in en_IN, and provisioning seeds packs for en_IN plus the
 * workspace's StateInfo languages, so every label is written under all of
 * them; otherwise one app or language shows raw codes.
 */

/** digit-ui's boot locale, and the configurator's default UI locale. */
export const BOOT_LOCALE = 'en_IN';

/** en_IN plus the workspace's StateInfo languages, de-duplicated. */
export async function labelLocales(tenantId: string): Promise<string[]> {
  const configured = await mdmsService.getStateInfoLocales(tenantId).catch(() => [] as string[]);
  return [...new Set([BOOT_LOCALE, ...configured])];
}

/** The locale the configurator UI is showing (the header switcher's choice). */
export function activeLocale(): string {
  return i18nProvider.getLocale() || BOOT_LOCALE;
}

/** Locales to read labels from, best first: the active one, then en_IN. */
export function readLocales(): string[] {
  return [...new Set([activeLocale(), BOOT_LOCALE])];
}
