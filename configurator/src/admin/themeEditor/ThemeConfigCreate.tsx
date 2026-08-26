import { useResourceContext, type RaRecord } from 'ra-core';
import { DigitCreate } from '../DigitCreate';
import { digitClient, getResourceLabel } from '@/providers/bridge';
import { toast } from '@/hooks/use-toast';
import { useApp } from '../../App';
import { ThemeConfigFormBody } from './ThemeConfigEditor';

const SCHEMA = 'common-masters.ThemeConfig';

/** Same tabbed/live-preview editor Edit already uses (ThemeConfigFormBody),
 *  just mounted inside DigitCreate instead of DigitEdit — there's no schema
 *  reason a new theme needs a different (worse) form than an existing one.
 *  `version: '3'` defaults every new theme onto the current designer
 *  taxonomy rather than a stale v1/v2 shape. */
export function ThemeConfigCreate() {
  const resource = useResourceContext() ?? '';
  const label = getResourceLabel(resource);
  const { state } = useApp();
  const tenantId = state.tenant;

  // MDMS never enforces "only one active ThemeConfig per tenant" — the
  // runtime just takes whichever active row it's handed first (see
  // seed-theme.py's own comment on this). DigitCreate always creates with
  // isActive:true, so without this, saving a second theme leaves two active
  // rows at the tenant and which one actually renders becomes arbitrary.
  // Deactivate every OTHER active row for THIS tenant — never a parent
  // tenant's (mdms-v2 resolves up the tree, so a naive search can return
  // rows this tenant doesn't own; deactivating one of those would silently
  // re-theme every other tenant that inherits it) — and only after the new
  // row is confirmed created, so a failed create can never strand the
  // tenant with zero active themes.
  const deactivateSiblings = async (created: RaRecord) => {
    const newCode = (created as { code?: unknown }).code;
    const rows = await digitClient.mdmsSearch(tenantId, SCHEMA, { limit: 200 });
    const stale = rows.filter(
      (r) =>
        r.isActive &&
        r.tenantId === tenantId &&
        (r.data as { code?: unknown } | undefined)?.code !== newCode,
    );
    for (const row of stale) {
      const staleCode = (row.data as { code?: unknown } | undefined)?.code ?? row.uniqueIdentifier;
      try {
        await digitClient.mdmsUpdate(row, false);
      } catch (e) {
        // Non-fatal: the new theme was already created successfully, which
        // is this action's actual goal. Leaving a stale theme active is a
        // (loudly reported) degradation, not a reason to fail the create.
        toast({
          title: 'Could not deactivate previous theme',
          description: `${staleCode}: ${e instanceof Error ? e.message : String(e)}`,
          variant: 'destructive',
        });
      }
    }
  };

  return (
    <DigitCreate
      title={`Create ${label}`}
      record={{ version: '3', colors: {} }}
      afterCreate={deactivateSiblings}
    >
      <ThemeConfigFormBody />
    </DigitCreate>
  );
}
