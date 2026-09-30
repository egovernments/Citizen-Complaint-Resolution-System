import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import { I18nContextProvider, type TranslationMessages } from 'ra-core';
import polyglotI18nProvider from 'ra-i18n-polyglot';
import { T } from '@digit-ui/datagrid';
import { FieldRow } from '@/admin/fields';

/**
 * #1880 — every translated string carries its localization code in the DOM
 * (`data-i18n-key`) so an admin can Inspect it and edit it under
 * System → Localization.
 */

function renderWith(messages: object, ui: React.ReactNode) {
  const i18nProvider = polyglotI18nProvider(() => messages as TranslationMessages, 'en_IN', [], {
    allowMissing: true,
  });
  return render(<I18nContextProvider value={i18nProvider}>{ui}</I18nContextProvider>);
}

describe('<T>', () => {
  it('renders the backend message and tags it with its code', () => {
    // The issue's example: an admin relabels "SLA" to "Default SLA".
    renderWith({ app: { fields: { sla: 'Default SLA' } } }, <T i18nKey="app.fields.sla">SLA</T>);
    expect(screen.getByText('Default SLA')).toHaveAttribute('data-i18n-key', 'app.fields.sla');
  });

  it('falls back to its children when the code is not seeded, still tagged', () => {
    renderWith({}, <T i18nKey="app.fields.sla">SLA</T>);
    expect(screen.getByText('SLA')).toHaveAttribute('data-i18n-key', 'app.fields.sla');
  });

  it('interpolates and pluralises both the message and the fallback', () => {
    renderWith(
      { app: { workflow: { sla_days: '%{count} jours' } } },
      <>
        <T i18nKey="app.workflow.sla_days" options={{ count: 5 }}>{'%{count} days'}</T>
        <T i18nKey="app.workflow.error_count" options={{ smart_count: 1 }}>
          {'%{smart_count} error |||| %{smart_count} errors'}
        </T>
        <T i18nKey="app.workflow.warning_count" options={{ smart_count: 3 }}>
          {'%{smart_count} warning |||| %{smart_count} warnings'}
        </T>
      </>,
    );
    expect(screen.getByText('5 jours')).toHaveAttribute('data-i18n-key', 'app.workflow.sla_days');
    expect(screen.getByText('1 error')).toHaveAttribute('data-i18n-key', 'app.workflow.error_count');
    expect(screen.getByText('3 warnings')).toHaveAttribute('data-i18n-key', 'app.workflow.warning_count');
  });

  it('puts the code inside a FieldRow label', () => {
    renderWith(
      {},
      <FieldRow label={<T i18nKey="app.fields.sla">SLA</T>}>5 days</FieldRow>,
    );
    const label = screen.getByText('SLA');
    expect(label).toHaveAttribute('data-i18n-key', 'app.fields.sla');
    expect(label.closest('dt')).not.toBeNull();
  });
});

describe('seeded localization bundle', () => {
  const root = resolve(__dirname, '../..');
  const bundle = JSON.parse(
    readFileSync(
      resolve(root, '../local-setup/ansible/files/configurator-localization/configurator-ui.json'),
      'utf8',
    ),
  ) as Array<{ code: string; locale: string }>;

  function tsxFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) return name === '__tests__' ? [] : tsxFiles(p);
      return p.endsWith('.tsx') && !p.endsWith('.test.tsx') ? [p] : [];
    });
  }

  it('seeds every static i18nKey in all four locales, so Inspect → Localization always finds it', () => {
    const locales = ['en_IN', 'hi_IN', 'fr_FR', 'pt_BR'];
    const seeded = new Set(bundle.map((m) => `${m.locale}|${m.code}`));
    const files = [...tsxFiles(resolve(root, 'src')), ...tsxFiles(resolve(root, 'packages/digit-datagrid/src'))];
    const codes = new Set(
      files.flatMap((f) => [...readFileSync(f, 'utf8').matchAll(/i18nKey="([^"]+)"/g)].map((m) => m[1])),
    );
    expect(codes.size).toBeGreaterThan(0);
    const missing = [...codes].flatMap((c) => locales.filter((l) => !seeded.has(`${l}|${c}`)).map((l) => `${l} ${c}`));
    expect(missing).toEqual([]);
  });
});
