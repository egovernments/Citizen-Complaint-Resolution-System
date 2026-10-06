import { useCallback } from 'react';
import { useTranslate } from 'ra-core';

/** Values for `%{name}` placeholders. */
export type Params = Record<string, string | number>;

/**
 * Translate one onboarding string. A bare key is looked up as `app.onboarding.<key>` in the
 * configurator-ui module; a key starting `app.` is used as it is, to share a label management
 * already has. `english` shows when the language has no translation, so the English lives here,
 * beside the code, and nowhere else.
 */
export type OnboardingT = (key: string, english: string, params?: Params) => string;

const fullKey = (key: string) => (key.startsWith('app.') ? key : `app.onboarding.${key}`);
const fill = (text: string, params?: Params) =>
  params ? text.replace(/%\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match)) : text;

/** English only, for code that runs without the translator: tests, and helpers' defaults. */
export const englishT: OnboardingT = (_key, english, params) => fill(english, params);

/**
 * An error a person will read, thrown below the pages. Its message is the English; where it is
 * shown, describeSaveError translates it by its key.
 */
export class MessageError extends Error {
  readonly key: string;
  readonly english: string;
  readonly params?: Params;
  constructor(key: string, english: string, params?: Params) {
    // Trimmed, so an empty trailing %{reason} leaves no space behind.
    super(fill(english, params).trim());
    this.name = 'MessageError';
    this.key = key;
    this.english = english;
    this.params = params;
  }
}

/** An onboarding translator over react-admin's `translate`, for code outside the onboarding pages. */
export function translatorFrom(translate: (key: string, options?: Record<string, unknown>) => string): OnboardingT {
  return (key, english, params) => {
    const full = fullKey(key);
    const text = translate(full, { _: english, ...params });
    // With no translator above (a test, say), translate hands back the key.
    return text === full ? fill(english, params) : text;
  };
}

/** The onboarding translator for this render. */
export function useOnboardingT(): OnboardingT {
  const translate = useTranslate();
  return useCallback<OnboardingT>((key, english, params) => translatorFrom(translate)(key, english, params), [translate]);
}
