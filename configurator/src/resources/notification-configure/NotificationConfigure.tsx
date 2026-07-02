// "Configure" tab under the Notifications nav.
//
// A transition-list view of one workflow BusinessService. For every workflow
// transition (ACTION -> nextState) it shows the notifications configured for it
// (routing rows matched on (action, toState=nextState)) as chips, and lets the
// operator Add / Edit / Remove notifications inline — writing straight to the
// two MDMS masters (RAINMAKER-PGR.NotificationRouting + .NotificationTemplate).
//
// WHY THE WRITE PATH WORKS (verified against the schema + dataProvider):
//   Both masters declare `x-unique` in their JSON Schema:
//     NotificationRouting  x-unique = [businessService, action, toState, audience, channel]
//     NotificationTemplate x-unique = [audience, action, toState, channel, locale]
//   egov-mdms-service v2 computes the record's `uniqueIdentifier` SERVER-SIDE by
//   joining those field values with '.', ignoring whatever uniqueIdentifier the
//   client passes. So `useCreate(resource, { data })` with the flat fields is
//   enough — the derived uid is exactly the required scheme
//   (businessService.action.toState.audience.channel /
//   audience.action.toState.channel.locale). The dataProvider's mdms create
//   sends `uniqueIdentifier = data[idField]` but that value is discarded by MDMS.
//   On read, normalizeMdmsRecord sets react-admin `id = uniqueIdentifier`, so
//   update/delete (which search by that id) round-trip correctly.

import { useMemo, useState, useEffect } from 'react';
import {
  useGetList,
  useGetOne,
  useCreate,
  useUpdate,
  useDelete,
  useRefresh,
  useNotify,
} from 'ra-core';
import { FieldSection } from '@/admin/fields';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from '@/components/ui/table';
import { EntityLink } from '@/components/ui/EntityLink';
import { StatusChip } from '@/admin/fields';
import { Plus, Pencil, Trash2, X } from 'lucide-react';
import {
  validateNotifications,
  type RoutingRow,
  type TemplateRow,
  type BusinessServiceRecord,
  type ValidationFinding,
} from '../workflow-services/validateNotifications';

// ---------------------------------------------------------------------------
// Constants — mirror the checker + schema enums.
// ---------------------------------------------------------------------------
const CHANNELS = ['SMS', 'WHATSAPP', 'EMAIL'] as const;
const NON_NOTIFIABLE = ['AUTO_ESCALATE', 'SYSTEM'];
const CITIZEN = 'CITIZEN';
const DEFAULT_LOCALE = 'en_IN';

/** Case-insensitive, trimmed comparison helper (mirrors the checker). */
function eq(a: unknown, b: unknown): boolean {
  return String(a ?? '').trim().toUpperCase() === String(b ?? '').trim().toUpperCase();
}

/** A record carrying the react-admin id + the raw MDMS uniqueIdentifier. */
type IdedRoutingRow = RoutingRow & { id?: string; _uniqueIdentifier?: string };
type IdedTemplateRow = TemplateRow & { id?: string; _uniqueIdentifier?: string };

// ---------------------------------------------------------------------------
// Shared textarea (no shadcn Textarea in this project) — styled like Input.
// ---------------------------------------------------------------------------
function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const { className = '', ...rest } = props;
  return (
    <textarea
      className={`flex min-h-[72px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
      {...rest}
    />
  );
}

// ---------------------------------------------------------------------------
// Inline add/edit form for a single notification on a transition.
// ---------------------------------------------------------------------------
interface TransitionCtx {
  businessService: string;
  fromState: string;
  action: string;
  toState: string;
  /** Uppercased roles on this workflow action + CITIZEN (audience options). */
  audienceOptions: string[];
}

interface EditSeed {
  audience: string;
  channel: string;
  subject: string;
  body: string;
  /** react-admin ids of the existing rows being edited (undefined = create). */
  routingId?: string;
  templateId?: string;
}

function NotificationForm({
  ctx,
  seed,
  onDone,
  onCancel,
}: {
  ctx: TransitionCtx;
  seed?: EditSeed;
  onDone: () => void;
  onCancel: () => void;
}) {
  const notify = useNotify();
  const [create] = useCreate();
  const [update] = useUpdate();
  const [saving, setSaving] = useState(false);

  const isEdit = !!(seed?.routingId || seed?.templateId);
  const [audience, setAudience] = useState(seed?.audience ?? ctx.audienceOptions[0] ?? CITIZEN);
  const [channel, setChannel] = useState(seed?.channel ?? 'SMS');
  const [subject, setSubject] = useState(seed?.subject ?? '');
  const [body, setBody] = useState(seed?.body ?? '');

  const canSave = !!audience && !!channel && body.trim().length > 0 && !saving;

  const save = async () => {
    if (!canSave) {
      notify('Audience, channel and body are required.', { type: 'warning' });
      return;
    }
    setSaving(true);
    try {
      const routingData: Record<string, unknown> = {
        businessService: ctx.businessService,
        fromState: ctx.fromState || null,
        action: ctx.action,
        toState: ctx.toState,
        audience,
        channel,
        assigneeOnly: false,
        active: true,
      };
      const templateData: Record<string, unknown> = {
        audience,
        action: ctx.action,
        toState: ctx.toState,
        channel,
        locale: DEFAULT_LOCALE,
        subject: channel === 'EMAIL' ? subject || null : null,
        body,
        placeholders: [],
        active: true,
      };

      // Edit: if the (audience/channel) key changed, the MDMS uniqueIdentifier
      // changes too — an in-place _update would keep the old key. We update
      // when the key is unchanged (same id derives), else create the new pair.
      if (isEdit && seed?.routingId && keyUnchanged(seed, audience, channel)) {
        await update('notification-routing', { id: seed.routingId, data: routingData, previousData: {} });
      } else {
        await create('notification-routing', { data: routingData });
      }

      if (isEdit && seed?.templateId && keyUnchanged(seed, audience, channel)) {
        await update('notification-template', { id: seed.templateId, data: templateData, previousData: {} });
      } else {
        await create('notification-template', { data: templateData });
      }

      notify(isEdit ? 'Notification updated.' : 'Notification added.', { type: 'success' });
      onDone();
    } catch (err) {
      notify(`Save failed: ${(err as Error)?.message ?? 'unknown error'}`, { type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-2 rounded-md border border-border bg-muted/30 p-3 space-y-3">
      <div className="flex flex-wrap gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Audience</label>
          <Select value={audience} onValueChange={setAudience}>
            <SelectTrigger className="h-8 w-[180px] text-xs">
              <SelectValue placeholder="Audience" />
            </SelectTrigger>
            <SelectContent>
              {ctx.audienceOptions.map((a) => (
                <SelectItem key={a} value={a} className="text-xs">{a}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Channel</label>
          <Select value={channel} onValueChange={setChannel}>
            <SelectTrigger className="h-8 w-[140px] text-xs">
              <SelectValue placeholder="Channel" />
            </SelectTrigger>
            <SelectContent>
              {CHANNELS.map((c) => (
                <SelectItem key={c} value={c} className="text-xs">{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {channel === 'EMAIL' && (
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Subject (email)</label>
          <Input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Optional email subject"
            className="h-8 text-xs"
          />
        </div>
      )}

      <div className="flex flex-col gap-1">
        <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Body</label>
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Message body — use {id} {complaint_type} {status} {ulb} {date} tokens"
          className="text-xs"
        />
      </div>

      <div className="flex items-center gap-2">
        <Button size="sm" onClick={save} disabled={!canSave}>
          {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Save'}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/** True when the (audience, channel) unique-key components are unchanged, so an
 *  in-place MDMS _update keeps the same uniqueIdentifier. */
function keyUnchanged(seed: EditSeed, audience: string, channel: string): boolean {
  return eq(seed.audience, audience) && eq(seed.channel, channel);
}

// ---------------------------------------------------------------------------
// One notification chip with Edit / Remove affordances.
// ---------------------------------------------------------------------------
function NotificationChip({
  row,
  template,
  onEdit,
  onRemove,
}: {
  row: IdedRoutingRow;
  template?: IdedTemplateRow;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const ref = template?.subject || template?.body ? '·template' : '';
  return (
    <Badge variant="outline" className="text-xs font-medium gap-1 pr-1">
      <span>{`${row.audience ?? '?'} · ${row.channel ?? '?'}${ref}`}</span>
      <button
        type="button"
        onClick={onEdit}
        title="Edit"
        className="ml-1 rounded p-0.5 hover:bg-muted text-muted-foreground hover:text-foreground"
      >
        <Pencil className="w-3 h-3" />
      </button>
      <button
        type="button"
        onClick={onRemove}
        title="Remove"
        className="rounded p-0.5 hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
      >
        <Trash2 className="w-3 h-3" />
      </button>
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// One transition row: ACTION -> nextState (actors) + notifications + inline add.
// ---------------------------------------------------------------------------
function TransitionRow({
  ctx,
  routingRows,
  templateRows,
  onChanged,
}: {
  ctx: TransitionCtx;
  routingRows: IdedRoutingRow[];
  templateRows: IdedTemplateRow[];
  onChanged: () => void;
}) {
  const notify = useNotify();
  const [deleteOne] = useDelete();
  const [adding, setAdding] = useState(false);
  const [editSeed, setEditSeed] = useState<EditSeed | null>(null);

  const findTemplate = (r: RoutingRow): IdedTemplateRow | undefined =>
    templateRows.find(
      (t) =>
        eq(t.audience, r.audience) &&
        eq(t.action, ctx.action) &&
        eq(t.toState, ctx.toState) &&
        eq(t.channel, r.channel) &&
        eq(t.locale, DEFAULT_LOCALE),
    );

  const startEdit = (r: IdedRoutingRow) => {
    const t = findTemplate(r);
    setAdding(false);
    setEditSeed({
      audience: String(r.audience ?? ''),
      channel: String(r.channel ?? ''),
      subject: String(t?.subject ?? ''),
      body: String(t?.body ?? ''),
      routingId: r.id,
      templateId: t?.id,
    });
  };

  const remove = async (r: IdedRoutingRow) => {
    if (!r.id) {
      notify('Cannot remove: missing record id.', { type: 'error' });
      return;
    }
    if (!window.confirm(`Remove notification "${r.audience} · ${r.channel}" for ${ctx.action} → ${ctx.toState}?`)) {
      return;
    }
    try {
      await deleteOne('notification-routing', { id: r.id, previousData: r });
      // Best-effort: deactivate the orphaned template too (ignore if absent).
      const t = findTemplate(r);
      if (t?.id) {
        try {
          await deleteOne('notification-template', { id: t.id, previousData: t });
        } catch {
          /* template may already be gone — non-fatal */
        }
      }
      notify('Notification removed.', { type: 'success' });
      onChanged();
    } catch (err) {
      notify(`Remove failed: ${(err as Error)?.message ?? 'unknown error'}`, { type: 'error' });
    }
  };

  return (
    <div className="py-2 border-b border-border/60 last:border-b-0">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <span className="text-sm font-medium">{ctx.action}</span>
          <span className="text-xs text-muted-foreground ml-1">{'→ '}{ctx.toState}</span>
          {ctx.audienceOptions.filter((a) => a !== CITIZEN).length > 0 && (
            <div className="flex flex-wrap gap-1 mt-0.5">
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground mr-1">actors:</span>
              {ctx.audienceOptions
                .filter((a) => a !== CITIZEN)
                .map((r) => (
                  <EntityLink key={r} resource="access-roles" id={r} label={r} />
                ))}
            </div>
          )}
        </div>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs shrink-0"
          onClick={() => {
            setEditSeed(null);
            setAdding((v) => !v);
          }}
        >
          {adding ? <X className="w-3.5 h-3.5 mr-1" /> : <Plus className="w-3.5 h-3.5 mr-1" />}
          {adding ? 'Close' : 'Add'}
        </Button>
      </div>

      <div className="mt-1.5 flex flex-wrap gap-1.5 items-center">
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground mr-1">notifications:</span>
        {routingRows.length === 0 ? (
          <span className="text-xs text-muted-foreground">— none —</span>
        ) : (
          routingRows.map((r, i) => (
            <NotificationChip
              key={`${r.id ?? ''}-${r.audience ?? ''}-${r.channel ?? ''}-${i}`}
              row={r}
              template={findTemplate(r)}
              onEdit={() => startEdit(r)}
              onRemove={() => remove(r)}
            />
          ))
        )}
      </div>

      {adding && (
        <NotificationForm
          ctx={ctx}
          onDone={() => {
            setAdding(false);
            onChanged();
          }}
          onCancel={() => setAdding(false)}
        />
      )}
      {editSeed && (
        <NotificationForm
          ctx={ctx}
          seed={editSeed}
          onDone={() => {
            setEditSeed(null);
            onChanged();
          }}
          onCancel={() => setEditSeed(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Validate panel — reuses validateNotifications + ValidationPanel styling.
// ---------------------------------------------------------------------------
function ValidatePanel({
  businessService,
  routingRows,
  templateRows,
  roleCodes,
}: {
  businessService: BusinessServiceRecord;
  routingRows: RoutingRow[];
  templateRows: TemplateRow[];
  roleCodes: string[];
}) {
  const [findings, setFindings] = useState<ValidationFinding[] | null>(null);
  const [expanded, setExpanded] = useState(true);

  const run = () => {
    setFindings(validateNotifications({ businessService, routingRows, templateRows, roleCodes }));
    setExpanded(true);
  };

  const errorCount = findings?.filter((f) => f.level === 'error').length ?? 0;
  const warnCount = findings?.filter((f) => f.level === 'warn').length ?? 0;

  return (
    <div>
      <div className="flex items-center gap-3 flex-wrap">
        <Button variant="outline" size="sm" onClick={run}>
          Validate
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
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main screen.
// ---------------------------------------------------------------------------
export function NotificationConfigure() {
  const refresh = useRefresh();

  // BusinessService picker.
  const { data: bsList, isLoading: bsLoading } = useGetList('workflow-business-services', {
    pagination: { page: 1, perPage: 100 },
    sort: { field: 'businessService', order: 'ASC' },
  });

  const [selected, setSelected] = useState<string | null>(null);
  const [showJson, setShowJson] = useState(false);

  // Default to PGR (else first) once the list arrives.
  useEffect(() => {
    if (selected || !bsList || bsList.length === 0) return;
    const pgr = bsList.find(
      (b) => eq(b.businessService, 'PGR') || eq(b.id, 'PGR'),
    );
    setSelected(String((pgr ?? bsList[0]).id));
  }, [bsList, selected]);

  const { data: record, isLoading: recordLoading } = useGetOne(
    'workflow-business-services',
    { id: selected ?? '' },
    { enabled: !!selected },
  );

  // Config lists.
  const { data: routingData } = useGetList('notification-routing', {
    pagination: { page: 1, perPage: 1000 },
    sort: { field: 'action', order: 'ASC' },
  });
  const { data: templateData } = useGetList('notification-template', {
    pagination: { page: 1, perPage: 1000 },
    sort: { field: 'action', order: 'ASC' },
  });
  const { data: roleData } = useGetList('access-roles', {
    pagination: { page: 1, perPage: 1000 },
    sort: { field: 'name', order: 'ASC' },
  });

  const bsId = String(record?.businessService ?? record?.id ?? '');

  const routingRows = useMemo<IdedRoutingRow[]>(() => {
    const all = (routingData ?? []) as IdedRoutingRow[];
    return all.filter((r) => !r.businessService || eq(r.businessService, bsId));
  }, [routingData, bsId]);

  const templateRows = (templateData ?? []) as IdedTemplateRow[];

  const roleCodes = useMemo<string[]>(
    () =>
      (roleData ?? []).map((r) =>
        String((r as Record<string, unknown>).code ?? (r as Record<string, unknown>).id ?? ''),
      ),
    [roleData],
  );

  const onChanged = () => refresh();

  const states = (record?.states as Array<Record<string, unknown>> | undefined) ?? [];

  // workflow-v2 returns action.nextState as the target state's UUID, but
  // NotificationRouting keys toState by the applicationStatus NAME. Resolve
  // UUID -> applicationStatus so matching (and new writes) use the name.
  const statusByStateUuid = new Map<string, string>();
  for (const s of states) {
    const u = s.uuid ? String(s.uuid) : '';
    if (u) statusByStateUuid.set(u, String(s.applicationStatus ?? s.state ?? ''));
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-condensed font-bold text-foreground">Configure Notifications</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Per-transition notification setup for a workflow business service. Each row is a
          workflow transition; add SMS / WhatsApp / Email notifications inline.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Business Service</CardTitle>
          <CardDescription>Pick the workflow to configure notifications for.</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center gap-3 flex-wrap">
          <Select
            value={selected ?? ''}
            onValueChange={setSelected}
            disabled={bsLoading || !bsList?.length}
          >
            <SelectTrigger className="h-9 w-[280px] text-sm">
              <SelectValue placeholder={bsLoading ? 'Loading…' : 'Select a business service'} />
            </SelectTrigger>
            <SelectContent>
              {(bsList ?? []).map((b) => (
                <SelectItem key={String(b.id)} value={String(b.id)} className="text-sm">
                  {String(b.businessService ?? b.id)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {record && (
            <ValidatePanel
              businessService={record as unknown as BusinessServiceRecord}
              routingRows={routingRows}
              templateRows={templateRows}
              roleCodes={roleCodes}
            />
          )}
          {record && (
            <Button
              variant={showJson ? 'default' : 'outline'}
              size="sm"
              onClick={() => setShowJson((v) => !v)}
              className="h-9"
            >
              {showJson ? 'Hide' : 'Show'} business service JSON
            </Button>
          )}
        </CardContent>
      </Card>

      {showJson && record && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Business Service JSON</CardTitle>
            <CardDescription>
              The raw workflow-v2 record this panel renders. Note each action&apos;s{' '}
              <code>nextState</code> is the target state&apos;s UUID (resolved to its
              applicationStatus when matching notifications).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <pre className="text-xs leading-relaxed overflow-auto max-h-[520px] rounded-md bg-muted p-3">
              {JSON.stringify(record, null, 2)}
            </pre>
          </CardContent>
        </Card>
      )}

      {!selected && !bsLoading && (
        <p className="text-sm text-muted-foreground">No business service selected.</p>
      )}

      {selected && recordLoading && (
        <p className="text-sm text-muted-foreground">Loading state machine…</p>
      )}

      {record && states.length === 0 && !recordLoading && (
        <p className="text-sm text-muted-foreground">This business service has no states.</p>
      )}

      {record && states.length > 0 && (
        <FieldSection title="Transitions">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30">
                <TableHead className="w-[220px]">State</TableHead>
                <TableHead>Transitions & Notifications</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {states.map((state, i) => {
                const actions = (state.actions as Array<Record<string, unknown>> | undefined) ?? [];
                const stateName = String(state.applicationStatus ?? state.state ?? '');
                return (
                  <TableRow key={i} className="align-top">
                    <TableCell className="align-top">
                      <div className="font-medium text-sm">{String(state.state ?? '--')}</div>
                      <div className="mt-1">
                        <StatusChip value={state.applicationStatus} />
                      </div>
                      <div className="flex gap-1 mt-1">
                        {!!state.isStartState && (
                          <Badge variant="outline" className="text-xs bg-green-50 text-green-700">Start</Badge>
                        )}
                        {!!state.isTerminateState && (
                          <Badge variant="outline" className="text-xs bg-red-50 text-red-700">End</Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="align-top">
                      {actions.length === 0 ? (
                        <span className="text-xs text-muted-foreground">— no transitions —</span>
                      ) : (
                        actions.map((action, j) => {
                          const roles = (action.roles as string[] | undefined) ?? [];
                          const audienceOptions = dedupe([
                            ...roles
                              .map((r) => String(r).trim().toUpperCase())
                              .filter((r) => r && !NON_NOTIFIABLE.includes(r)),
                            CITIZEN,
                          ]);
                          const rawNext = String(action.nextState ?? '');
                          const toState = statusByStateUuid.get(rawNext) ?? rawNext;
                          const actionName = String(action.action ?? '');
                          const ctx: TransitionCtx = {
                            businessService: bsId,
                            fromState: stateName,
                            action: actionName,
                            toState,
                            audienceOptions,
                          };
                          const rows = routingRows.filter(
                            (r) => eq(r.action, actionName) && eq(r.toState, toState),
                          );
                          return (
                            <TransitionRow
                              key={`${actionName}-${toState}-${j}`}
                              ctx={ctx}
                              routingRows={rows}
                              templateRows={templateRows}
                              onChanged={onChanged}
                            />
                          );
                        })
                      )}
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

/** Order-preserving dedupe. */
function dedupe(arr: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of arr) {
    if (!seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

export default NotificationConfigure;
