import { render, screen } from '@testing-library/react';
import { I18nContextProvider } from 'ra-core';
import polyglotI18nProvider from 'ra-i18n-polyglot';
import englishMessages from 'ra-language-english';
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { decodeFieldError, useFieldErrorText } from './fieldErrorText';

// the create-employee form showed a raw "@@react-admin@@{...}" validation message
const encoded = (v: unknown) => `@@react-admin@@${JSON.stringify(v)}`;

describe('decodeFieldError', () => {
  it('unwraps ra-core\'s encoded validator errors (key + args) and keeps plain messages', () => {
    expect(decodeFieldError(encoded({ message: 'ra.validation.maxLength', args: { max: 3 } }))).toEqual({ message: 'ra.validation.maxLength', args: { max: 3 } });
    expect(decodeFieldError(encoded('ra.validation.required'))).toEqual({ message: 'ra.validation.required' });
    expect(decodeFieldError('Code is required')).toEqual({ message: 'Code is required' });
    expect(decodeFieldError(undefined)).toBeUndefined();
  });
});

function Show({ raw }: { raw: string }) { return <p role="alert">{useFieldErrorText(raw)}</p>; }
const i18n = polyglotI18nProvider(() => englishMessages, 'en');

it('a field shows the translated text, never the raw encoding or the key', () => {
  render(<I18nContextProvider value={i18n}><Show raw={encoded({ message: 'ra.validation.required', args: {} })} /></I18nContextProvider>);
  const text = screen.getByRole('alert').textContent ?? '';
  expect(text).not.toMatch(/@@react-admin@@|ra\.validation/);
  expect(text).toMatch(/required/i);
});

it('no input renders fieldState.error.message as stored (sibling sweep)', () => {
  const root = resolve(__dirname, '..');
  const hits: string[] = [];
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) { walk(p); continue; }
      if (!/\.tsx?$/.test(n) || /\.test\./.test(n)) continue;
      for (const line of readFileSync(p, 'utf8').split('\n')) {
        if (/fieldState\.error\??\.message/.test(line) && !/useFieldErrorText\(fieldState\.error\?\.message\)/.test(line)) hits.push(`${p.slice(root.length)}: ${line.trim()}`);
      }
    }
  };
  walk(root);
  expect(hits).toEqual([]);
});
