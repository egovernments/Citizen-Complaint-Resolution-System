import { useMemo, useState } from 'react';
import { DigitShow } from '@/admin';
import { FieldSection, FieldRow, StatusChip } from '@/admin/fields';
import { EntityLink } from '@/components/ui/EntityLink';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useShowController, useGetList } from 'ra-core';
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from '@/components/ui/table';
import {
  validateNotifications,
  type RoutingRow,
  type TemplateRow,
  type BusinessServiceRecord,
  type ValidationFinding,
} from './validateNotifications';

/** Case-insensitive, trimmed comparison helper (mirrors the checker). */
function eq(a: unknown, b: unknown): boolean {
  return String(a ?? '').trim().toUpperCase() === String(b ?? '').trim().toUpperCase();
}

/** Compact chips of `audience · channel` for the routing rows on a transition. */
function NotificationChips({ rows }: { rows: RoutingRow[] }) {
  if (rows.length === 0) {
    return <span className="text-xs text-muted-foreground">— none —</span>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {rows.map((r, idx) => (
        <Badge
          key={`${r.audience ?? ''}-${r.channel ?? ''}-${idx}`}
          variant="outline"
          className="text-xs font-medium"
        >
          {`${r.audience ?? '?'} · ${r.channel ?? '?'}`}
        </Badge>
      ))}
    </div>
  );
}

/** Red/green summary badge + expandable findings list for the checker. */
function ValidationPanel({ businessService }: { businessService: BusinessServiceRecord }) {
  const [findings, setFindings] = useState<ValidationFinding[] | null>(null);
  const [expanded, setExpanded] = useState(true);

  const { data: routingData } = useGetList('notification-routing', {
    pagination: { page: 1, perPage: 1000 },
    sort: { field: 'action', order: 'ASC' },
  });
  const { data: templateData } = useGetList('notification-template', {
    pagination: { page: 1, perPage: 1000 },
    sort: { field: 'action', order: 'ASC' },
  });
  const { data: roleData } = useGetList('access-roles', {
    pagination: { page: 1, perPage: 500 },
    sort: { field: 'name', order: 'ASC' },
  });

  const bsId = String(businessService.businessService ?? '');

  // Routing rows scoped to this business service (or unscoped/blank).
  const routingRows = useMemo<RoutingRow[]>(() => {
    const all = (routingData ?? []) as RoutingRow[];
    return all.filter((r) => !r.businessService || eq(r.businessService, bsId));
  }, [routingData, bsId]);

  const templateRows = (templateData ?? []) as TemplateRow[];

  const roleCodes = useMemo<string[]>(() => {
    return (roleData ?? []).map((r) =>
      String((r as Record<string, unknown>).code ?? (r as Record<string, unknown>).id ?? ''),
    );
  }, [roleData]);

  const run = () => {
    setFindings(
      validateNotifications({ businessService, routingRows, templateRows, roleCodes }),
    );
    setExpanded(true);
  };

  const errorCount = findings?.filter((f) => f.level === 'error').length ?? 0;
  const warnCount = findings?.filter((f) => f.level === 'warn').length ?? 0;

  return (
    <FieldSection title="Notification Configuration">
      <div className="flex items-center gap-3 flex-wrap">
        <Button variant="outline" size="sm" onClick={run}>
          Validate notifications
        </Button>
        {findings !== null && (
          <>
            {errorCount === 0 ? (
              <Badge variant="success" className="text-xs">
                {warnCount === 0
                  ? 'All checks passed'
                  : `Passed · ${warnCount} warning${warnCount === 1 ? '' : 's'}`}
              </Badge>
            ) : (
              <Badge variant="destructive" className="text-xs">
                {`${errorCount} error${errorCount === 1 ? '' : 's'}`}
                {warnCount > 0 ? ` · ${warnCount} warning${warnCount === 1 ? '' : 's'}` : ''}
              </Badge>
            )}
            {findings.length > 0 && (
              <button
                type="button"
                className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                onClick={() => setExpanded((v) => !v)}
              >
                {expanded ? 'Hide details' : 'Show details'}
              </button>
            )}
          </>
        )}
      </div>

      {findings !== null && expanded && findings.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {findings.map((f, i) => (
            <li
              key={`${f.rule}-${i}`}
              className={`flex flex-col gap-0.5 rounded-md border px-3 py-2 text-xs ${
                f.level === 'error'
                  ? 'border-red-200 bg-red-50 text-red-800'
                  : 'border-amber-200 bg-amber-50 text-amber-800'
              }`}
            >
              <div className="flex items-center gap-2">
                <Badge
                  variant={f.level === 'error' ? 'destructive' : 'warning'}
                  className="text-[10px] uppercase"
                >
                  {f.level}
                </Badge>
                <span className="font-mono font-medium">{f.rule}</span>
              </div>
              <span>{f.message}</span>
              {f.ref && <span className="font-mono text-[11px] opacity-70">{f.ref}</span>}
            </li>
          ))}
        </ul>
      )}
    </FieldSection>
  );
}

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
                <StateMachineTable states={states} businessService={String(rec.businessService ?? rec.id ?? '')} />
              </FieldSection>
            )}

            <ValidationPanel businessService={rec as unknown as BusinessServiceRecord} />
          </div>
        );
      }}
    </DigitShow>
  );
}

/**
 * State-machine table. Loads notification-routing once and, per action row,
 * shows the routing rows mapped to that transition (action -> nextState) as
 * `audience · channel` chips.
 */
function StateMachineTable({
  states,
  businessService,
}: {
  states: Array<Record<string, unknown>>;
  businessService: string;
}) {
  const { data: routingData } = useGetList('notification-routing', {
    pagination: { page: 1, perPage: 1000 },
    sort: { field: 'action', order: 'ASC' },
  });

  const routingRows = useMemo<RoutingRow[]>(() => {
    const all = (routingData ?? []) as RoutingRow[];
    return all.filter((r) => !r.businessService || eq(r.businessService, businessService));
  }, [routingData, businessService]);

  // workflow-v2's action.nextState is the target state's UUID; routing.toState
  // is the applicationStatus NAME. Resolve UUID -> name before matching.
  const statusByStateUuid = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of states) {
      const u = s.uuid ? String(s.uuid) : '';
      if (u) m.set(u, String(s.applicationStatus ?? s.state ?? ''));
    }
    return m;
  }, [states]);
  const resolveState = (ns: unknown): string =>
    statusByStateUuid.get(String(ns ?? '')) ?? String(ns ?? '');

  const notificationsFor = (action: unknown, nextState: unknown): RoutingRow[] =>
    routingRows.filter((r) => eq(r.action, action) && eq(r.toState, resolveState(nextState)));

  return (
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
                    <div key={j} className="mb-2 last:mb-0">
                      <span className="text-sm font-medium">{String(action.action ?? '')}</span>
                      <span className="text-xs text-muted-foreground ml-1">{"→ "}{resolveState(action.nextState)}</span>
                      {roles && roles.length > 0 && (
                        <div className="flex gap-1 mt-0.5">
                          {roles.map((r) => (
                            <EntityLink key={r} resource="access-roles" id={r} label={r} />
                          ))}
                        </div>
                      )}
                      <div className="mt-1">
                        <span className="text-[10px] uppercase tracking-wide text-muted-foreground mr-1">Notifications:</span>
                        <NotificationChips rows={notificationsFor(action.action, action.nextState)} />
                      </div>
                    </div>
                  );
                })}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
