import { hasMixedHours, type DraftType } from './complaintsApi';

/** The resolution times offered as quick picks, in hours. */
export const RESOLUTION_CHOICES = [
  { hours: 24, label: '1 day' },
  { hours: 72, label: '3 days' },
  { hours: 168, label: '1 week' },
  { hours: 336, label: '2 weeks' },
];

/** "1 day", "3 days", "1 week", or the hours when they aren't whole days. */
export function formatHours(hours: number): string {
  if (hours % 168 === 0) return hours === 168 ? '1 week' : `${hours / 168} weeks`;
  if (hours % 24 === 0) return hours === 24 ? '1 day' : `${hours / 24} days`;
  return hours === 1 ? '1 hour' : `${hours} hours`;
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
): { slaHours: number | undefined; keepOwn: boolean } | { error: string } {
  if (choice === 'default') return { slaHours: undefined, keepOwn: false };
  if (choice === 'mixed') return { slaHours: type?.slaHours, keepOwn: true };
  const hours = choice === 'custom' ? Number(custom.trim() || NaN) : Number(choice);
  if (!Number.isInteger(hours) || hours < 1) return { error: 'Enter the hours as a whole number above 0.' };
  return { slaHours: hours, keepOwn: false };
}
