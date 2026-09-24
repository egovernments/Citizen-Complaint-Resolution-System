import { useMemo, useState } from 'react';
import { DigitShow } from '@/admin';
import { FieldSection, FieldRow, StatusChip } from '@/admin/fields';
import { EntityLink } from '@/components/ui/EntityLink';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useShowController, useTranslate } from 'ra-core';
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
  type ValidationFinding,
} from './validateNotifications';
import { parseAudience, describeAudience } from '../notification-configure/audienceScheme';
import { legacyEventName } from '../notification-configure/legacyAdapter';
import { useNotificationConfig } from '../notification-configure/useNotificationGuard';

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
          {`${describeAudience(parseAudience(r.audience))} · ${r.channel ?? '?'}`}
        </Badge>
      ))}
    </div>
  );
}

/**
 * Red/green summary badge + expandable findings list for the checker.
 *
 * It validates the tenant's WHOLE notification configuration, not this workflow
 * alone: since the event catalogue replaced the state machine as the checker's
 * vocabulary, "the rows belonging to this business service" is no longer a thing
 * this screen can compute (a routing row names an event, and events belong to a
 * module, which is not the same axis as a workflow).
 *
 * It now also passes the provider templates. It did not before, which meant the
 * three WhatsApp rules silently never ran HERE while they did run on the
 * Configure tab — the same button reporting a clean bill of health on one screen
 * and errors on another. Loading everything through one hook is what stops that
 * asymmetry coming back.
 *
 * No verdict without a snapshot: it is null while the masters load AND when the
 * tenant has no event catalogue, and validating nothing must not read as healthy.
 */
function ValidationPanel() {
  const t = useTranslate();
  const [findings, setFindings] = useState<ValidationFinding[] | null>(null);
  const [expanded, setExpanded] = useState(true);
  const { snapshot, decision, loading } = useNotificationConfig();

  const run = () => {
    if (!snapshot) return;
    setFindings(validateNotifications(snapshot));
    setExpanded(true);
  };

  const errorCount = findings?.filter((f) => f.level === 'error').length ?? 0;
  const warnCount = findings?.filter((f) => f.level === 'warn').length ?? 0;

  return (
    <FieldSection title="Notification Configuration">
      <div className="flex items-center gap-3 flex-wrap">
        <Button variant="outline" size="sm" onClick={run} disabled={!snapshot}>
          Validate notifications
        </Button>
        {!snapshot && (
          loading ? (
            <span className="text-xs text-muted-foreground">
              {t('app.notification_validate.loading', { _: 'Loading the notification configuration…' })}
            </span>
          ) : (
            <span className="text-xs text-amber-700">
              {t('app.notification_validate.not_configured', {
                _: 'Not configured: this tenant has no notification event catalogue, so there is nothing to validate against.',
              })}
            </span>
          )
        )}
        {snapshot && findings !== null && (
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
        {decision.source === 'LEGACY' && (
          <span className="text-xs text-amber-700">
            Read from the legacy PGR masters — this tenant has not been migrated yet.
          </span>
        )}
      </div>

      {snapshot && findings !== null && expanded && findings.length > 0 && (
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
                <StateMachineTable states={states} />
              </FieldSection>
            )}

            <ValidationPanel />
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
function StateMachineTable({ states }: { states: Array<Record<string, unknown>> }) {
  // Routing rows come from wherever this tenant's configuration lives, already
  // adapted to the event vocabulary (useNotificationConfig). A transition is
  // matched to its routing rows through the SAME derivation the seed-time
  // catalogue generator uses, so this table keeps working for PGR without the
  // notification screens needing the workflow record at all.
  const { routingRows } = useNotificationConfig();

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

  const notificationsFor = (action: unknown, nextState: unknown): RoutingRow[] => {
    const eventName = legacyEventName(action, resolveState(nextState));
    return routingRows.filter((r) => eq(r.eventName, eventName));
  };

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
