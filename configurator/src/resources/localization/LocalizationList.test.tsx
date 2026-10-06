// @vitest-environment jsdom
//
// #1712 — the Localization list's locale columns (and the getList filter that
// pivots the data) must come from the tenant's own StateInfo.languages
// (useAvailableLocales), not the configurator app's own fixed UI-chrome
// locale list (AVAILABLE_LOCALES in i18nProvider). Those are two unrelated
// lists: the app-chrome one only covers the languages the configurator's own
// nav/buttons are translated into (en_IN/hi_IN/pt_BR/fr_FR today) and is
// unrelated to what a given tenant actually configured (e.g. Mozambique:
// en_IN + pt_PT) — using it here showed languages the tenant never enabled
// and the wrong regional variant (pt_BR) for one the tenant did.

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ListContextProvider, type ListControllerResult } from 'ra-core';

const mockLocales = [
  { value: 'en_IN', label: 'English (en_IN)' },
  { value: 'pt_PT', label: 'Portuguese (pt_PT)' },
];

vi.mock('@/hooks/useAvailableLocales', () => ({
  useAvailableLocales: () => ({ locales: mockLocales, isLoading: false, error: null }),
}));

const digitListFilterSpy = vi.fn();
vi.mock('@/admin', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/admin')>();
  return {
    ...actual,
    // Stub DigitList down to "capture the filter, render children inside a
    // minimal real ra-core list context" — enough for ModuleSelector's
    // useListContext() to resolve without pulling in a full data provider.
    DigitList: ({ filter, children }: { filter?: unknown; children?: React.ReactNode }) => {
      digitListFilterSpy(filter);
      const value = { filterValues: {}, setFilters: vi.fn() } as unknown as ListControllerResult;
      return <ListContextProvider value={value}>{children}</ListContextProvider>;
    },
    // Stub DigitDatagrid down to just the column labels, so the test can
    // assert on what MultiLocaleDatagrid actually built.
    DigitDatagrid: ({ columns }: { columns: Array<{ label: string; source?: string }> }) => (
      <div>
        {columns.map((c) => (
          <div key={c.source ?? c.label} data-testid="col">{c.label}</div>
        ))}
      </div>
    ),
  };
});

import { LocalizationList } from './LocalizationList';

describe('LocalizationList', () => {
  it("builds locale columns and the getList filter from the tenant's StateInfo locales, not the app-chrome locale list", () => {
    render(<LocalizationList />);

    const labels = screen.getAllByTestId('col').map((el) => el.textContent);
    expect(labels).toEqual(['app.fields.code', 'app.fields.module', 'English (en_IN)', 'Portuguese (pt_PT)']);

    // Neither the configurator app's own UI-chrome locales (hi_IN, fr_FR) nor
    // its Portuguese variant (pt_BR, vs. this tenant's pt_PT) should leak in.
    expect(labels.join(' ')).not.toMatch(/hi_IN|fr_FR|pt_BR/);

    // The permanent filter that drives the pivot must use the same tenant
    // locales as the columns — not a hardcoded list.
    expect(digitListFilterSpy).toHaveBeenCalledWith({ locales: ['en_IN', 'pt_PT'] });
  });
});
