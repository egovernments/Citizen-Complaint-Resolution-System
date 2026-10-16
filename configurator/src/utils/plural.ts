/** English plural of a level or area name: "County" → "Counties", "Ward" → "Wards". */
export function plural(word: string): string {
  if (/[^aeiou]y$/i.test(word)) return word.slice(0, -1) + 'ies';
  if (/(s|x|ch|sh)$/i.test(word)) return word + 'es';
  return word + 's';
}
