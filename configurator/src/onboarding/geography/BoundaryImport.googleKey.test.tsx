import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nContextProvider, type I18nProvider } from 'ra-core';

// Geography's optional Google Maps key (#1994): a key Google refuses must not
// reach MapConfig, and the operator is told why.
const validateGoogleMapsKey = vi.fn<(key: string) => Promise<'ok' | 'unverified'>>();
vi.mock('@/utils/googleMaps', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/googleMaps')>()),
  validateGoogleMapsKey: (key: string) => validateGoogleMapsKey(key),
}));
const reload = vi.fn();
vi.mock('@/hooks/useMapProviderConfig', () => ({
  useMapProviderConfig: () => ({ provider: 'leaflet', googleMapsApiKey: '', loading: false, reload }),
}));
vi.mock('@/api/services/tenantHierarchy', () => ({
  loadTenantHierarchies: async () => ({ hierarchies: [] }),
}));
vi.mock('../../App', () => ({
  useApp: () => ({ addUndo: vi.fn(), state: { tenant: 'ke', targetTenant: 'ke' } }),
}));

import { mdmsService } from '@/api';
import { GoogleKeyRejectedError } from '@/utils/googleMaps';
import BoundaryImport from './BoundaryImport';

const upsertMapConfig = vi.spyOn(mdmsService, 'upsertMapConfig');

function saveKey(key: string, wrap: (ui: ReactElement) => ReactElement = (ui) => ui) {
  render(wrap(<BoundaryImport source="osm" hasHierarchies sourceChoices={[]} onDone={vi.fn()} onCancel={vi.fn()} />));
  fireEvent.change(screen.getByPlaceholderText('Google Maps JavaScript API key'), { target: { value: key } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
}

beforeEach(() => {
  validateGoogleMapsKey.mockReset();
  upsertMapConfig.mockReset();
  reload.mockReset();
});

describe('BoundaryImport: Google Maps key', () => {
  it('does not save a key Google rejects, and shows why', async () => {
    validateGoogleMapsKey.mockRejectedValueOnce(new GoogleKeyRejectedError('cms.example.org'));

    saveKey('AIzaNotAKey');

    expect(
      await screen.findByText(
        'Google rejected this API key. Check it is copied in full, enable the Maps JavaScript API for it in Google Cloud Console, and allow this site (cms.example.org) in its HTTP-referrer restrictions.',
      ),
    ).toBeTruthy();
    expect(validateGoogleMapsKey).toHaveBeenCalledWith('AIzaNotAKey');
    expect(upsertMapConfig).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it("says why in the operator's language", async () => {
    const french: I18nProvider = {
      translate: (key: string, options?: Record<string, unknown>) =>
        String(
          key === 'app.onboarding.geography.google.rejected'
            ? 'Google a rejeté cette clé d’API. Autorisez ce site (%{site}).'
            : (options?._ ?? key),
        ).replace(/%\{(\w+)\}/g, (match, name: string) => (options && name in options ? String(options[name]) : match)),
      changeLocale: async () => {},
      getLocale: () => 'fr_FR',
    };
    validateGoogleMapsKey.mockRejectedValueOnce(new GoogleKeyRejectedError('cms.example.org'));

    saveKey('AIzaNotAKey', (ui) => <I18nContextProvider value={french}>{ui}</I18nContextProvider>);

    expect(await screen.findByText('Google a rejeté cette clé d’API. Autorisez ce site (cms.example.org).')).toBeTruthy();
    expect(upsertMapConfig).not.toHaveBeenCalled();
  });

  it('saves a key Google accepts', async () => {
    validateGoogleMapsKey.mockResolvedValueOnce('ok');
    upsertMapConfig.mockResolvedValueOnce(undefined as never);

    saveKey('AIzaGoodKey');

    await waitFor(() =>
      expect(upsertMapConfig).toHaveBeenCalledWith('ke', { mapProvider: 'google', googleMapsApiKey: 'AIzaGoodKey' }),
    );
    expect(await screen.findByText(/now draw on Google Maps/)).toBeTruthy();
  });
});
