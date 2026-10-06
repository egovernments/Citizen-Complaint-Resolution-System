import { hasMixedHours, type DraftType } from './complaintsApi';
import { englishT, type OnboardingT } from '../i18n';

/** The resolution times offered as quick picks, in hours; formatHours words them. */
export const RESOLUTION_CHOICES = [{ hours: 24 }, { hours: 72 }, { hours: 168 }, { hours: 336 }];

/** "1 day", "3 days", "1 week", or the hours when they aren't whole days. */
export function formatHours(hours: number, t: OnboardingT = englishT): string {
  if (hours % 168 === 0) {
    const count = hours / 168;
    return count === 1 ? t('hours.week_one', '%{count} week', { count }) : t('hours.week_other', '%{count} weeks', { count });
  }
  if (hours % 24 === 0) {
    const count = hours / 24;
    return count === 1 ? t('hours.day_one', '%{count} day', { count }) : t('hours.day_other', '%{count} days', { count });
  }
  return hours === 1 ? t('hours.hour_one', '%{count} hour', { count: 1 }) : t('hours.hour_other', '%{count} hours', { count: hours });
}

/** The resolution time field: the default, a quick pick, a custom number, or (loaded mixed) each subtype's own. */
export type HoursChoice = 'default' | 'custom' | 'mixed' | `${number}`;

/** What the field shows when a type's dialog opens. */
export function initialChoice(type: DraftType | undefined): { choice: HoursChoice; custom: string } {
  if (type && hasMixedHours(type)) return { choice: 'mixed', custom: '' };
  if (type?.slaHours === undefined) return { choice: 'default', custom: '' };
  return RESOLUTION_CHOICES.some((preset) => preset.hours === type.slaHours)
    ? { choice: `${type.slaHours}`, custom: '' }
    : { choice: 'custom', custom: String(type.slaHours) };
}

/**
 * The type's own hours for a choice (unset: the default), and whether its
 * subtypes keep their own: only "each subcategory's own" does; any other
 * choice applies to all of them.
 */
export function chosenHours(
  choice: HoursChoice,
  custom: string,
  type: DraftType | undefined,
  t: OnboardingT = englishT,
): { slaHours: number | undefined; keepOwn: boolean } | { error: string } {
  if (choice === 'default') return { slaHours: undefined, keepOwn: false };
  if (choice === 'mixed') return { slaHours: type?.slaHours, keepOwn: true };
  const hours = choice === 'custom' ? Number(custom.trim() || NaN) : Number(choice);
  if (!Number.isInteger(hours) || hours < 1) return { error: t('complaints.hours_invalid', 'Enter the hours as a whole number above 0.') };
  return { slaHours: hours, keepOwn: false };
}
