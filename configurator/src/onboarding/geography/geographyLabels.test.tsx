import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { I18nContextProvider, type I18nProvider } from 'ra-core';
import type { Boundary } from '@/api/types';
import { BoundaryList } from './BoundaryList';
import type { BoundaryDraft } from './boundaryDraft';
import { PreconfiguredCard } from './PreconfiguredCard';

const FRENCH: Record<string, string> = {
  'app.onboarding.geography.list.not_saved': 'Pas encore enregistré',
  'app.onboarding.common.edit_named': 'Modifier %{name}',
  'app.onboarding.common.remove_named': 'Retirer %{name}',
  'app.onboarding.geography.preconfigured_title': 'Limites préconfigurées',
  'app.onboarding.geography.preconfigured_none': 'Aucune limite préconfigurée pour %{country}. Récupérez-les ou importez-les.',
};

/** Like polyglot: the language's text, else the English default, filling only the params it was given. */
const french: I18nProvider = {
  translate: (key: string, options?: Record<string, unknown>) =>
    String(FRENCH[key] ?? options?._ ?? key).replace(/%\{(\w+)\}/g, (match, name: string) =>
      options && name in options ? String(options[name]) : match,
    ),
  changeLocale: async () => {},
  getLocale: () => 'fr_FR',
};

const inFrench = (node: ReactNode) => render(<I18nContextProvider value={french}>{node}</I18nContextProvider>);

describe('Geography in another language', () => {
  it('translates the unsaved list, and leaves a string with no translation in English', () => {
    const area = (code: string, boundaryType: string, parent?: string): Boundary => ({
      tenantId: 'ke',
      code,
      name: code,
      boundaryType,
      parent,
      hierarchyType: 'ADMIN',
    });
    const draft: BoundaryDraft = {
      selections: [
        {
          id: 'selection-1',
          source: 'excel',
          method: 'excel',
          hierarchyType: 'ADMIN',
          levels: ['County', 'Ward'],
          hierarchyExists: false,
          boundaries: [area('C1', 'County'), area('W1', 'Ward', 'C1')],
          unnamed: [],
          alreadyThere: 0,
          sourceText: 'your Excel upload',
          skipped: 0,
          attribution: null,
          preconfigured: null,
          resume: {
            kind: 'excel',
            hierarchy: { tenantId: 'ke', hierarchyType: 'ADMIN', boundaryHierarchy: [] },
            file: null,
            parsed: [],
            valid: [],
            invalid: [],
            polygonFile: null,
            polygonSidecar: null,
          },
        },
      ],
    };
    inFrench(
      <ul>
        <BoundaryList draft={draft} summarize={() => '1 county · 1 ward'} onEdit={vi.fn()} onRemove={vi.fn()} />
      </ul>,
    );
    expect(screen.getByText('Pas encore enregistré')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Modifier your Excel upload' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retirer your Excel upload' })).toBeTruthy();
    // No French for the button text itself: it stays in English.
    expect(screen.getByRole('button', { name: 'Modifier your Excel upload' }).textContent).toBe('Edit');
  });

  it('translates the Preconfigured card, and leaves a string with no translation in English', () => {
    inFrench(<PreconfiguredCard state={{ status: 'none', country: 'KE' }} onUse={vi.fn()} onRetry={vi.fn()} />);
    expect(screen.getByText('Limites préconfigurées')).toBeTruthy();
    expect(screen.getByTestId('option-unavailable').textContent).toBe('Aucune limite préconfigurée pour Kenya. Récupérez-les ou importez-les.');
    inFrench(<PreconfiguredCard state={{ status: 'loading' }} onUse={vi.fn()} onRetry={vi.fn()} />);
    expect(screen.getByText('Checking which boundaries we hold for your country…')).toBeTruthy();
  });
});
