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

export function WorkflowServiceShow() {
  const { record } = useShowController();

  return (
    <DigitShow title={record ? `Workflow: ${record.businessService ?? record.id}` : 'Workflow Service'}>
      {(rec: Record<string, unknown>) => {
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
      }}
    </DigitShow>
  );
}
