import { lazy, Suspense, type ComponentProps } from 'react';

/**
 * ours (#1945): the notice, loaded on first render. The notice reads the app context (App.tsx), which itself imports
 * '@/admin'; a static import from the shared admin screens (DigitEdit, DigitShow, masterScreens) would make '@/admin'
 * and App a load-time cycle.
 */
const Notice = lazy(() => import('./CountyOverrideNotice').then((m) => ({ default: m.CountyOverrideNotice })));

export function CountyOverrideNotice(props: ComponentProps<typeof Notice>) {
  return (
    <Suspense fallback={null}>
      <Notice {...props} />
    </Suspense>
  );
}
