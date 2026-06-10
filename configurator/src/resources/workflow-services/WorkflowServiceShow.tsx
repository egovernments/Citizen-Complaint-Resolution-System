import { useState } from 'react';
import { DigitShow } from '@/admin';
import { FieldSection, FieldRow, StatusChip } from '@/admin/fields';
import { EntityLink } from '@/components/ui/EntityLink';
import { Badge } from '@/components/ui/badge';
import { useShowController } from 'ra-core';
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { DesignerIframe } from '@/components/widgets/DesignerIframe';
import { digitClient } from '@/providers/bridge';
import { useToast } from '@/hooks/use-toast';

/**
 * Posts a `BusinessServices: [...]` body to the workflow `_update` endpoint.
 *
 * Inlined here (rather than added to the data-provider package) because the
 * data-provider's existing `workflowBusinessServiceCreate` already covers
 * upserts for greenfield flows; updates from the visual designer are a
 * separate code path that only this screen calls.
 */
async function updateWorkflowBusinessService(tenantId: string, businessService: Record<string, unknown>): Promise<void> {
  await digitClient.request('/egov-workflow-v2/egov-wf/businessservice/_update', {
    RequestInfo: digitClient.buildRequestInfo(),
    BusinessServices: [{ ...businessService, tenantId }],
  });
}

function StateMachineTable({ rec }: { rec: Record<string, unknown> }) {
  const states = rec.states as Array<Record<string, unknown>> | undefined;
  const sla = Number(rec.businessServiceSla);
  const slaDays = sla ? Math.round(sla / (1000 * 60 * 60 * 24)) : null;

  return (
    <div className="space-y-6">
      <FieldSection title="Details">
        <FieldRow label="Business Service">{String(rec.businessService ?? '')}</FieldRow>
        <FieldRow label="Business">{String(rec.business ?? '')}</FieldRow>
        <FieldRow label="SLA">{slaDays ? `${slaDays} days` : '--'}</FieldRow>
      </FieldSection>

      {states && states.length > 0 && (
        <FieldSection title="State Machine">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30">
                <TableHead>State</TableHead>
                <TableHead>App Status</TableHead>
                <TableHead>Flags</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {states.map((state, i) => {
                const actions = state.actions as Array<Record<string, unknown>> | undefined;
                return (
                  <TableRow key={i}>
                    <TableCell className="font-medium">{String(state.state ?? '--')}</TableCell>
                    <TableCell><StatusChip value={state.applicationStatus} /></TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        {!!state.isStartState && <Badge variant="outline" className="text-xs bg-green-50 text-green-700">Start</Badge>}
                        {!!state.isTerminateState && <Badge variant="outline" className="text-xs bg-red-50 text-red-700">End</Badge>}
                      </div>
                    </TableCell>
                    <TableCell>
                      {actions?.map((action, j) => {
                        const roles = action.roles as string[] | undefined;
                        return (
                          <div key={j} className="mb-1 last:mb-0">
                            <span className="text-sm font-medium">{String(action.action ?? '')}</span>
                            <span className="text-xs text-muted-foreground ml-1">{"→ "}{String(action.nextState ?? '')}</span>
                            {roles && roles.length > 0 && (
                              <div className="flex gap-1 mt-0.5">
                                {roles.map((r) => (
                                  <EntityLink key={r} resource="access-roles" id={r} label={r} />
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </FieldSection>
      )}
    </div>
  );
}

export function WorkflowServiceShow() {
  const { record } = useShowController();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);

  return (
    <DigitShow title={record ? `Workflow: ${record.businessService ?? record.id}` : 'Workflow Service'}>
      {(rec: Record<string, unknown>) => {
        const tenantId = typeof rec.tenantId === 'string' && rec.tenantId
          ? rec.tenantId
          : digitClient.stateTenantId;

        const handleSave = async (wf: unknown) => {
          if (!wf || typeof wf !== 'object') {
            toast({ title: 'Designer returned an invalid workflow', variant: 'destructive' });
            return;
          }
          setSaving(true);
          try {
            await updateWorkflowBusinessService(tenantId, wf as Record<string, unknown>);
            toast({ title: 'Workflow updated', description: 'Changes from the designer have been saved.' });
          } catch (e) {
            toast({
              title: 'Failed to save workflow',
              description: (e as Error).message,
              variant: 'destructive',
            });
          } finally {
            setSaving(false);
          }
        };

        return (
          <Tabs defaultValue="state-machine" className="w-full">
            <TabsList>
              <TabsTrigger value="state-machine">State Machine</TabsTrigger>
              <TabsTrigger value="visual">Visual{saving ? ' (saving...)' : ''}</TabsTrigger>
            </TabsList>
            <TabsContent value="state-machine">
              <StateMachineTable rec={rec} />
            </TabsContent>
            <TabsContent value="visual">
              <DesignerIframe workflow={rec} onSave={handleSave} className="h-[80vh]" />
            </TabsContent>
          </Tabs>
        );
      }}
    </DigitShow>
  );
}
