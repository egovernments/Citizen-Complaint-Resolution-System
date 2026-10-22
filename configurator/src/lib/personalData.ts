/**
 * What counts as personal in text the console sends anywhere: an email
 * address, or a phone number however it is written. Shared by analytics
 * (which drops such a value) and Sentry (which masks it).
 */

const EMAIL = /[^\s@'"<>(),;:]+@[^\s@'"<>(),;:]+\.[A-Za-z]{2,}/g;
/** Seven or more digits, allowing the spaces, dashes and leading + a phone number is written with. */
const PHONE = /\+?\d(?:[\s-]?\d){6,}/g;
/** An ISO date is digits and dashes too, and is not a phone number. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const maskPhone = (match: string) => (ISO_DATE.test(match) ? match : '[number]');

export function maskPersonal(text: string): string {
  return text.replace(EMAIL, '[email]').replace(PHONE, maskPhone);
}

export function looksPersonal(text: string): boolean {
  return text.includes('@') || maskPersonal(text) !== text;
}
