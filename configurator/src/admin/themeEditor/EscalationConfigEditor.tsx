import { useResourceContext, useEditContext } from 'ra-core';
import { DigitEdit } from '../DigitEdit';
import { WidgetForFieldSpec } from '../widgets';
import { getDescriptor } from '../schemaDescriptors';
import { getResourceLabel, digitClient } from '@/providers/bridge';
import { DesignationTreePanel } from '@/components/widgets/DesignationTreePanel';

const SCHEMA = 'RAINMAKER-PGR.EscalationConfig';

function EditorBody() {
  const descriptor = getDescriptor(SCHEMA);
  const { record, isPending } = useEditContext();

  if (isPending || !record || !descriptor) return null;

  // For city-context: if the operator opened this from a city tenant the
  // designation panel should query that city's employees, not the root.
  // We don't currently propagate session tenant into MdmsResourceEdit — fall
  // back to the digitClient.stateTenantId (root) and let the panel default
  // to it. The skill notes call this out for future work.
  const cityTenantId = digitClient.stateTenantId; // TODO: thread the current session city tenant.

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px] gap-6">
      <div className="min-w-0 space-y-6">
        {descriptor.groups?.map((group) => (
          <section key={group.title} className="space-y-3">
            <h3 className="text-sm font-semibold text-foreground">{group.title}</h3>
            <div className="space-y-4">
              {group.fields.map((path) => {
                const spec = descriptor.fields.find((f) => f.path === path);
                if (!spec || spec.hidden === 'edit' || spec.hidden === 'always') return null;
                return <WidgetForFieldSpec key={path} spec={spec} source={path} />;
              })}
            </div>
          </section>
        ))}
      </div>

      <DesignationTreePanel cityTenantId={cityTenantId} className="self-start xl:sticky xl:top-4" />
    </div>
  );
}

export function EscalationConfigEditor() {
  const resource = useResourceContext() ?? '';
  const label = getResourceLabel(resource);
  return (
    <DigitEdit title={`Edit ${label}`}>
      <EditorBody />
    </DigitEdit>
  );
}
