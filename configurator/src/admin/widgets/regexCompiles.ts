import type { Validator } from 'ra-core';

/**
 * Refuses a pattern the browser can't compile. Saved, it would be a rule nobody can apply: the complaint forms
 * skip a postal pattern that doesn't compile, so the field would accept anything (#2787).
 */
export const regexCompiles: Validator = (value) => {
  if (typeof value !== 'string' || value === '') return undefined;
  try {
    new RegExp(value);
    return undefined;
  } catch (e) {
    return `Regex error: ${e instanceof Error ? e.message : 'invalid regex'}`;
  }
};
