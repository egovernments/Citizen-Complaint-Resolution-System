import { useResourceContext } from 'ra-core';
import { DigitCreate } from '../DigitCreate';
import { getResourceLabel } from '@/providers/bridge';
import { ThemeConfigFormBody } from './ThemeConfigEditor';

/** Same tabbed/live-preview editor Edit already uses (ThemeConfigFormBody),
 *  just mounted inside DigitCreate instead of DigitEdit — there's no schema
 *  reason a new theme needs a different (worse) form than an existing one.
 *  `version: '3'` defaults every new theme onto the current designer
 *  taxonomy rather than a stale v1/v2 shape. */
export function ThemeConfigCreate() {
  const resource = useResourceContext() ?? '';
  const label = getResourceLabel(resource);
  return (
    <DigitCreate title={`Create ${label}`} record={{ version: '3', colors: {} }}>
      <ThemeConfigFormBody />
    </DigitCreate>
  );
}
