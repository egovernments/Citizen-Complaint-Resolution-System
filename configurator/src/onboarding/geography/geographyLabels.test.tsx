import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { I18nContextProvider, type I18nProvider } from 'ra-core';
import { BoundariesCreated } from './BoundariesCreated';
import { PreconfiguredCard } from './PreconfiguredCard';

const FRENCH: Record<string, string> = {
  'app.onboarding.geography.created.title': 'Limites créées',
  'app.onboarding.geography.created.body': '%{areas} dans la hiérarchie %{hierarchy} de %{workspace}, depuis %{source}.',
  'app.onboarding.geography.created.area_other': '%{count} zones',
  'app.onboarding.geography.created.back': 'Retour à la géographie',
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
  it('translates the import summary and keeps the hierarchy name bold inside the sentence', () => {
    inFrench(
      <BoundariesCreated
        levels={['County', 'Ward']}
        counts={{ County: 1, Ward: 25 }}
        total={26}
        hierarchyType="ADMIN"
        workspace="Bomet"
        sourceText="your Excel upload"
        onDone={vi.fn()}
      />,
    );
    expect(screen.getByText('Limites créées')).toBeTruthy();
    expect(screen.getByTestId('boundaries-created').textContent).toContain('26 zones dans la hiérarchie ADMIN de Bomet, depuis your Excel upload.');
    expect(screen.getByText('ADMIN').className).toContain('font-medium');
    expect(screen.getByRole('button', { name: 'Retour à la géographie' })).toBeTruthy();
  });

  it('translates the Preconfigured card, and leaves a string with no translation in English', () => {
    inFrench(<PreconfiguredCard state={{ status: 'none', country: 'KE' }} onUse={vi.fn()} onRetry={vi.fn()} />);
    expect(screen.getByText('Limites préconfigurées')).toBeTruthy();
    expect(screen.getByTestId('option-unavailable').textContent).toBe('Aucune limite préconfigurée pour Kenya. Récupérez-les ou importez-les.');
    inFrench(<PreconfiguredCard state={{ status: 'loading' }} onUse={vi.fn()} onRetry={vi.fn()} />);
    expect(screen.getByText('Checking which boundaries we hold for your country…')).toBeTruthy();
  });
});
