import { useResourceContext, useEditContext } from 'ra-core';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowRight } from 'lucide-react';
import { DigitEdit } from '../DigitEdit';
import { WidgetForFieldSpec } from '../widgets';
import { getDescriptor } from '../schemaDescriptors';
import { getResourceLabel, digitClient } from '@/providers/bridge';
import { DesignationTreePanel } from '@/components/widgets/DesignationTreePanel';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

const SCHEMA = 'RAINMAKER-PGR.EscalationConfig';

/**
 * Banner shown at the top of the v0 editor. The new Category SLA Matrix
 * (CRS.CategorySLA + CRS.StateSLA) supersedes this surface; we keep the
 * editor mounted so operators with pre-existing config can still read and
 * tweak it, but every load reminds them where new configs should go.
 */
function DeprecationBanner() {
  return (
    <Alert variant="warning" className="mb-4">
      <AlertTriangle className="w-4 h-4" />
      <AlertTitle>v0 SLA model — superseded by the Category SLA Matrix</AlertTitle>
      <AlertDescription className="flex items-center justify-between gap-3 mt-1">
        <span>
          New SLA configurations should be made in the Category SLA Matrix, which
          the escalation scheduler now reads from first (with this v0 record kept
          as a fallback).
        </span>
        <Button asChild variant="outline" size="sm" className="shrink-0">
          <Link to="/crs-sla-matrix">
            Open Category SLA Matrix
            <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
          </Link>
        </Button>
      </AlertDescription>
    </Alert>
  );
}

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
    <div>
      <DeprecationBanner />
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
