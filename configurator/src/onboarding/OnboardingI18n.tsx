import type { ReactNode } from 'react';
import { I18nContextProvider, StoreContextProvider } from 'ra-core';
import { i18nProvider } from '@/providers/bridge';
import { appStore } from '@/providers/appStore';

/** Onboarding sits outside react-admin, so it gets the same translator and language store here. */
export function OnboardingI18n({ children }: { children: ReactNode }) {
  return (
    <StoreContextProvider value={appStore}>
      <I18nContextProvider value={i18nProvider}>{children}</I18nContextProvider>
    </StoreContextProvider>
  );
}
