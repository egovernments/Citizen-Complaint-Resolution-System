import { useTranslate } from 'ra-core';
import { getResourceLabel } from '@/providers/bridge';

/**
 * Returns a function that resolves a resource's display label via the
 * `app.resources.<id>` localization key (e.g. `app.resources.state_info`),
 * falling back to the registry's hardcoded English label when the key isn't
 * seeded. Hyphens in resource ids are normalised to underscores so the codes
 * are valid nested keys. This is the single point that makes every resource
 * label — dedicated and generic MDMS alike — backend-driven and translatable.
 */
export function useResourceLabel(): (resource: string) => string {
  const translate = useTranslate();
  return (resource: string) =>
    translate(`app.resources.${resource.replace(/-/g, '_')}`, {
      _: getResourceLabel(resource),
    });
}
