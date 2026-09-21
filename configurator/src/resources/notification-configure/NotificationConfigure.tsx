// "Configure" tab under the Notifications nav.
//
// An EVENT-list view of one module. For every event the module declares in
// NOTIFICATIONS.EventCatalogue it shows the notifications configured for it
// (routing rows matched on eventName) as chips, and lets the operator
// Add / Edit / Remove notifications inline — writing straight to the two MDMS
// masters (NOTIFICATIONS.Routing + NOTIFICATIONS.Template).
//
// WHAT THIS SCREEN NO LONGER READS: the PGR workflow.
//   It used to render one row per workflow transition, which meant fetching a
//   BusinessService, walking its state machine, and resolving workflow-v2's
//   state UUIDs to applicationStatus names in the browser — for PGR only,
//   because the business-service list was a hardcoded ['PGR'] one layer down.
//   The event catalogue replaced all of that: a module declares its events, the
//   actors they carry and the tokens they fill, and this screen renders whatever
//   is declared. PGR is one module among however many the tenant has.
//
// WHY THE WRITE PATH WORKS (verified against the schema + dataProvider):
//   Both masters declare `x-unique` in their JSON Schema:
//     NOTIFICATIONS.Routing  x-unique = [eventName, audience, channel]
//     NOTIFICATIONS.Template x-unique = [eventName, audience, channel, locale]
//   egov-mdms-service v2 computes the record's `uniqueIdentifier` SERVER-SIDE by
//   joining those field values with '.', ignoring whatever uniqueIdentifier the
//   client passes. So `useCreate(resource, { data })` with the flat fields is
//   enough. On read, normalizeMdmsRecord sets react-admin `id = uniqueIdentifier`,
//   so update/delete (which search by that id) round-trip correctly.
//   NOTE the uid is no longer decomposable: `eventName` contains dots. Never
//   split one on '.' to recover its key fields.

import { useMemo, useState, useEffect } from 'react';
import {
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
import { Plus, Pencil, Trash2, X, AlertTriangle } from 'lucide-react';
import {
  validateNotifications,
  type RoutingRow,
  type TemplateRow,
  type ValidationFinding,
} from '../workflow-services/validateNotifications';
import {
  actorNames,
  catalogueModules,
  eventChannels,
  eventLabel,
  eventsForModule,
  placeholderNames,
  type EventCatalogueRow,
} from './eventCatalogue';
import {
  describeAudience,
  formatAudience,
  parseAudience,
  type AudienceSchemeName,
} from './audienceScheme';
import { saveNotificationPair, type Mutate, type WritePathDeps, ROUTING_RESOURCE, TEMPLATE_RESOURCE } from './notificationWritePath';
import {
  checkPendingChanges,
  naturalKey,
  blockingSummary,
  fieldForRule,
  type NotificationSnapshot,
  type PendingChange,
} from './notificationSaveGuard';
import { GuardBanner, FindingList } from './NotificationFindings';
import { useNotificationConfig, type Ided } from './useNotificationGuard';
import { canWrite } from './notificationSource';

// ---------------------------------------------------------------------------
// Constants — mirror the checker + schema enums.
// ---------------------------------------------------------------------------
const CHANNELS = ['SMS', 'WHATSAPP', 'EMAIL'] as const;
const DEFAULT_LOCALE = 'en_IN';

/** Tokens in a body, first-appearance order — becomes the template's declared `placeholders`. */
function bodyTokens(body: string): string[] {
  const out: string[] = [];
  for (const m of body.matchAll(/\{([a-zA-Z0-9_]+)\}/g)) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}

/** Case-insensitive, trimmed comparison helper (mirrors the checker). */
function eq(a: unknown, b: unknown): boolean {
  return String(a ?? '').trim().toUpperCase() === String(b ?? '').trim().toUpperCase();
}

type IdedRoutingRow = Ided<RoutingRow>;
type IdedTemplateRow = Ided<TemplateRow>;

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
// Audience composer — the scheme-aware picker.
//
// An audience is a CHAIN of terms tried in order until one yields a non-empty
// recipient list, which is how "tell the assignee, or the whole ward team if
// there is no assignee yet" is expressed. Each term names a scheme:
//   ACTOR:<name>       an actor the event carries (from the catalogue row)
//   ROLE:<code>        every holder of a role in this tenant
//   EVENT_RECIPIENTS   contacts the event itself carries (account-less flows)
// ---------------------------------------------------------------------------
interface Term { scheme: AudienceSchemeName; value: string }

function AudienceComposer({
  terms,
  actors,
  roles,
  onChange,
}: {
  terms: Term[];
  actors: string[];
  roles: string[];
  onChange: (next: Term[]) => void;
}) {
  const setTerm = (i: number, patch: Partial<Term>) =>
    onChange(terms.map((t, j) => (j === i ? { ...t, ...patch } : t)));

  const defaultValueFor = (scheme: AudienceSchemeName): string => {
    if (scheme === 'ACTOR') return actors[0] ?? '';
    if (scheme === 'ROLE') return roles[0] ?? '';
    return '';
  };

  return (
    <div className="flex flex-col gap-1">
      <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Audience</label>
      {terms.map((t, i) => (
        <div key={i} className="flex items-center gap-2">
          {i > 0 && <span className="text-[11px] text-muted-foreground">or, if empty:</span>}
          <Select
            value={t.scheme}
            onValueChange={(v) => setTerm(i, { scheme: v as AudienceSchemeName, value: defaultValueFor(v as AudienceSchemeName) })}
          >
            <SelectTrigger className="h-8 w-[150px] text-xs" aria-label={`Audience kind ${i + 1}`}>
              <SelectValue placeholder="Kind" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ACTOR" className="text-xs">Actor on the event</SelectItem>
              <SelectItem value="ROLE" className="text-xs">Everyone with a role</SelectItem>
              <SelectItem value="EVENT_RECIPIENTS" className="text-xs">Contacts on the event</SelectItem>
            </SelectContent>
          </Select>

          {t.scheme === 'EVENT_RECIPIENTS' ? (
            <span className="text-xs text-muted-foreground">
              the contacts the producing module put on the event itself
            </span>
          ) : (
            <Select value={t.value} onValueChange={(v) => setTerm(i, { value: v })}>
              <SelectTrigger className="h-8 w-[200px] text-xs" aria-label={`Audience value ${i + 1}`}>
                <SelectValue placeholder={t.scheme === 'ACTOR' ? 'Actor' : 'Role'} />
              </SelectTrigger>
              <SelectContent>
                {(t.scheme === 'ACTOR' ? actors : roles).map((v) => (
                  <SelectItem key={v} value={v} className="text-xs">{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {terms.length > 1 && (
            <button
              type="button"
              title="Remove this fallback"
              className="rounded p-0.5 text-muted-foreground hover:text-destructive"
              onClick={() => onChange(terms.filter((_, j) => j !== i))}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      ))}
      <button
        type="button"
        className="self-start text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
        onClick={() => onChange([...terms, { scheme: 'ROLE', value: roles[0] ?? '' }])}
      >
        + add a fallback (used only when the one above resolves to nobody)
      </button>
    </div>
  );
}

/** The terms an existing audience value decomposes into, for the composer. */
function termsOf(audience: string, actors: string[]): Term[] {
  const ref = parseAudience(audience);
  const usable = ref.terms
    .filter((t) => t.scheme === 'ACTOR' || t.scheme === 'ROLE' || t.scheme === 'EVENT_RECIPIENTS')
    .map((t) => ({ scheme: t.scheme, value: t.value }));
  if (usable.length > 0) return usable;
  return [{ scheme: 'ACTOR', value: actors[0] ?? '' }];
}

// ---------------------------------------------------------------------------
// Inline add/edit form for a single notification on an event.
// ---------------------------------------------------------------------------
interface EventCtx {
  module: string;
  event: EventCatalogueRow;
  eventName: string;
  /** Actor names the event declares (the Actor list in the audience picker). */
  actors: string[];
  /** Role codes in this tenant (the Role list in the audience picker). */
  roles: string[];
  /** Channels this event may be routed to. */
  channels: string[];
  /** Placeholder tokens this event fills. */
  placeholders: string[];
  /** Locales already used by templates for this tenant (datalist suggestions). */
  knownLocales: string[];
}

interface EditSeed {
  audience: string;
  channel: string;
  locale: string;
  subject: string;
  body: string;
  /** react-admin ids of the existing rows being edited (undefined = create). */
  routingId?: string;
  templateId?: string;
}

function NotificationForm({
  ctx,
  seed,
  snapshot,
  onDone,
  onCancel,
}: {
  ctx: EventCtx;
  seed?: EditSeed;
  /** Current whole-tenant config, so the edit can be validated before it is written. */
  snapshot: NotificationSnapshot | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const notify = useNotify();
  const [create] = useCreate();
  const [update] = useUpdate();
  const [deleteOne] = useDelete();
  const [saving, setSaving] = useState(false);
  const [blocked, setBlocked] = useState<ReturnType<typeof checkPendingChanges> | null>(null);

  const isEdit = !!(seed?.routingId || seed?.templateId);
  const [terms, setTerms] = useState<Term[]>(() => termsOf(seed?.audience ?? '', ctx.actors));
  const [channel, setChannel] = useState(seed?.channel ?? ctx.channels[0] ?? 'SMS');
  const [locale, setLocale] = useState(seed?.locale ?? DEFAULT_LOCALE);
  const [subject, setSubject] = useState(seed?.subject ?? '');
  const [body, setBody] = useState(seed?.body ?? '');

  const audience = formatAudience(terms);
  const unknownTokens = bodyTokens(body).filter((t) => !ctx.placeholders.includes(t));
  const canSave = !!audience && !!channel && locale.trim().length > 0 && body.trim().length > 0 && !saving;
  /** Blocking findings the last save attempt raised for one form field. */
  const blockingFor = (field: string) =>
    (blocked?.blocking ?? []).filter((f) => fieldForRule(f.rule) === field);

  const save = async () => {
    if (!canSave) {
      notify('Audience, channel and body are required.', { type: 'warning' });
      return;
    }
    setSaving(true);
    try {
      const routingData: Record<string, unknown> = {
        module: ctx.module,
        eventName: ctx.eventName,
        audience,
        channel,
        active: true,
      };
      const effectiveLocale = locale.trim() || DEFAULT_LOCALE;
      const templateData: Record<string, unknown> = {
        module: ctx.module,
        eventName: ctx.eventName,
        audience,
        channel,
        locale: effectiveLocale,
        subject: channel === 'EMAIL' ? subject || null : null,
        body,
        placeholders: bodyTokens(body),
        active: true,
      };

      // The uid schemes are deterministic and derivable client-side (they mirror
      // the server's x-unique derivation documented in this file's header).
      //   routing uid:  eventName.audience.channel
      //   template uid: eventName.audience.channel.locale
      const routingUid = [ctx.eventName, audience, channel].join('.');
      const templateUid = [ctx.eventName, audience, channel, effectiveLocale].join('.');

      // VALIDATE ON UPDATE. Run the whole checker over the config as it WOULD BE
      // once this pair is written, and refuse the save on any error this change
      // is answerable for. Pre-existing errors on other rows are reported but do
      // not block — an operator has to be able to repair a tenant one row at a
      // time. See notificationSaveGuard.ts.
      const changes: PendingChange[] = [
        {
          resource: 'notifications-routing',
          op: 'upsert',
          row: routingData,
          replaces: seed
            ? naturalKey('notifications-routing', {
                eventName: ctx.eventName, audience: seed.audience, channel: seed.channel,
              })
            : undefined,
        },
        {
          resource: 'notifications-template',
          op: 'upsert',
          row: templateData,
          replaces: seed
            ? naturalKey('notifications-template', {
                eventName: ctx.eventName, audience: seed.audience, channel: seed.channel, locale: seed.locale,
              })
            : undefined,
        },
      ];
      const guard = snapshot ? checkPendingChanges(snapshot, changes) : null;
      if (guard && guard.blocking.length > 0) {
        setBlocked(guard);
        notify(blockingSummary(guard.blocking), { type: 'error' });
        return;   // `finally` clears `saving`
      }
      setBlocked(guard);

      // ra-core mutation callables need { returnPromise: true } to become real
      // awaitable promises (else await is a no-op). saveNotificationPair carries
      // that on every call and orchestrates create/reactivate/deactivate.
      const deps: WritePathDeps = {
        create: create as unknown as Mutate,
        update: update as unknown as Mutate,
        deleteOne: deleteOne as unknown as Mutate,
      };
      await saveNotificationPair(deps, {
        isEdit,
        keyUnchanged: !!seed && keyUnchanged(seed, audience, channel),
        templateKeyUnchanged: !!seed && keyUnchanged(seed, audience, channel) && eq(seed.locale, effectiveLocale),
        routingUid,
        templateUid,
        routingData,
        templateData,
        seedRoutingId: seed?.routingId,
        seedTemplateId: seed?.templateId,
      });

      notify(isEdit ? 'Notification updated.' : 'Notification added.', { type: 'success' });
      onDone();
    } catch (err) {
      notify(`Save failed: ${(err as Error)?.message ?? 'unknown error'} — if the template was saved but routing failed, click Save again to complete the pair.`, { type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-2 rounded-md border border-border bg-muted/30 p-3 space-y-3">
      <div className="flex flex-wrap gap-6">
        <AudienceComposer terms={terms} actors={ctx.actors} roles={ctx.roles} onChange={setTerms} />
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Channel</label>
          <Select value={channel} onValueChange={setChannel}>
            <SelectTrigger className="h-8 w-[140px] text-xs" aria-label="Channel">
              <SelectValue placeholder="Channel" />
            </SelectTrigger>
            <SelectContent>
              {ctx.channels.map((c) => (
                <SelectItem key={c} value={c} className="text-xs">{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <FindingList findings={blockingFor('audience')} />

      <div className="flex flex-wrap gap-3 items-end">
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Locale</label>
          <Input
            value={locale}
            onChange={(e) => setLocale(e.target.value)}
            list="notification-locales"
            placeholder={DEFAULT_LOCALE}
            className="h-8 w-[120px] text-xs"
          />
          <datalist id="notification-locales">
            {Array.from(new Set([DEFAULT_LOCALE, ...ctx.knownLocales])).map((l) => <option key={l} value={l} />)}
          </datalist>
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
          <FindingList findings={blockingFor('subject')} />
        </div>
      )}

      <div className="flex flex-col gap-1">
        <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Body</label>
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Message body — use the {tokens} listed below"
          className="text-xs"
        />
        {ctx.placeholders.length > 0 && (
          <span className="text-[11px] text-muted-foreground">
            Tokens this event fills: {ctx.placeholders.map((p) => `{${p}}`).join(' ')}
          </span>
        )}
        {unknownTokens.length > 0 && (
          <span className="text-[11px] text-amber-700">
            Unknown token{unknownTokens.length > 1 ? 's' : ''} {unknownTokens.map((t) => `{${t}}`).join(', ')} — the producing module does not fill {unknownTokens.length > 1 ? 'them' : 'it'}, so the braces ship literally.
          </span>
        )}
        <FindingList findings={blockingFor('body')} />
      </div>

      {/* Anything the guard flagged that has no field of its own, plus the
          advisory findings it did not block on. */}
      {blocked && (
        <GuardBanner
          blocking={blocked.blocking.filter((f) => !INLINE_FIELDS.includes(fieldForRule(f.rule) ?? ''))}
          advisory={blocked.advisory}
        />
      )}

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

/** Fields the inline form renders a finding directly under. */
const INLINE_FIELDS = ['subject', 'body', 'audience'];

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
  locales,
  readOnly,
  onEdit,
  onRemove,
}: {
  row: IdedRoutingRow;
  template?: IdedTemplateRow;
  locales: string[];
  readOnly: boolean;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const ref = template?.subject || template?.body ? ` · ${locales.join(',') || 'template'}` : '';
  const who = describeAudience(parseAudience(row.audience));
  return (
    <Badge variant="outline" className="text-xs font-medium gap-1 pr-1">
      <span>{`${who} · ${row.channel ?? '?'}${ref}`}</span>
      {!readOnly && (
        <>
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
        </>
      )}
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// One event row: label + event key + notifications + inline add.
// ---------------------------------------------------------------------------
function EventRow({
  ctx,
  routingRows,
  templateRows,
  snapshot,
  readOnly,
  onChanged,
}: {
  ctx: EventCtx;
  routingRows: IdedRoutingRow[];
  templateRows: IdedTemplateRow[];
  snapshot: NotificationSnapshot | null;
  readOnly: boolean;
  onChanged: () => void;
}) {
  const notify = useNotify();
  const [deleteOne] = useDelete();
  const [adding, setAdding] = useState(false);
  const [editSeed, setEditSeed] = useState<EditSeed | null>(null);

  const templatesFor = (r: RoutingRow): IdedTemplateRow[] =>
    templateRows.filter(
      (t) =>
        eq(t.eventName, ctx.eventName) &&
        eq(t.channel, r.channel) &&
        parseAudience(t.audience).key === parseAudience(r.audience).key,
    );
  // Prefer the default-locale template (what the renderer uses today); else any.
  const findTemplate = (r: RoutingRow): IdedTemplateRow | undefined => {
    const all = templatesFor(r);
    return all.find((t) => eq(t.locale, DEFAULT_LOCALE)) ?? all[0];
  };

  const startEdit = (r: IdedRoutingRow) => {
    const t = findTemplate(r);
    setAdding(false);
    setEditSeed({
      audience: String(r.audience ?? ''),
      channel: String(r.channel ?? ''),
      locale: String(t?.locale ?? DEFAULT_LOCALE),
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
    // VALIDATE ON UPDATE — a removal is a change like any other. Removing the
    // last template for a still-active routing row leaves the tenant unable to
    // send, so the checker gets a say before the delete is issued.
    const t0 = findTemplate(r);
    const guard = snapshot
      ? checkPendingChanges(snapshot, [
          { resource: 'notifications-routing', op: 'remove', row: r as Record<string, unknown> },
          ...(t0 ? [{ resource: 'notifications-template' as const, op: 'remove' as const, row: t0 as Record<string, unknown> }] : []),
        ])
      : null;
    if (guard && guard.blocking.length > 0) {
      notify(`${blockingSummary(guard.blocking)} ${guard.blocking[0].message}`, { type: 'error' });
      return;
    }
    if (!window.confirm(`Remove notification "${r.audience} · ${r.channel}" for ${ctx.eventName}?`)) {
      return;
    }
    try {
      await deleteOne(ROUTING_RESOURCE, { id: r.id, previousData: r }, { returnPromise: true });
      // Best-effort: deactivate the orphaned template too (ignore if absent).
      const t = findTemplate(r);
      if (t?.id) {
        try {
          await deleteOne(TEMPLATE_RESOURCE, { id: t.id, previousData: t }, { returnPromise: true });
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
          <span className="text-sm font-medium">{eventLabel(ctx.event)}</span>
          <div className="font-mono text-[11px] text-muted-foreground">{ctx.eventName}</div>
          {ctx.actors.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-0.5">
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground mr-1">actors:</span>
              {ctx.actors.map((a) => (
                <Badge key={a} variant="outline" className="text-[10px]">{a}</Badge>
              ))}
            </div>
          )}
        </div>
        {!readOnly && (
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
        )}
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
              locales={templatesFor(r).map((t) => String(t.locale ?? '')).filter(Boolean)}
              readOnly={readOnly}
              onEdit={() => startEdit(r)}
              onRemove={() => remove(r)}
            />
          ))
        )}
      </div>

      {adding && (
        <NotificationForm
          ctx={ctx}
          snapshot={snapshot}
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
          snapshot={snapshot}
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
function ValidatePanel({ snapshot }: { snapshot: NotificationSnapshot }) {
  const [findings, setFindings] = useState<ValidationFinding[] | null>(null);
  const [expanded, setExpanded] = useState(true);

  const run = () => {
    setFindings(validateNotifications(snapshot));
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

/** The "where is this tenant's configuration" banner (notificationSource.ts). */
function SourceBanner({ title, message }: { title: string; message: string }) {
  if (!title && !message) return null;
  return (
    <div
      role="status"
      className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900"
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div>
        <div className="font-medium">{title}</div>
        <p className="mt-0.5 leading-relaxed">{message}</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main screen.
// ---------------------------------------------------------------------------
export function NotificationConfigure() {
  const refresh = useRefresh();
  const cfg = useNotificationConfig();
  const { catalogue, routingRows, templateRows, decision, snapshot, roleCodes } = cfg;

  const modules = useMemo(() => catalogueModules(catalogue), [catalogue]);
  const [selected, setSelected] = useState<string | null>(null);

  // Default to the first module in the catalogue once it arrives. There is no
  // hardcoded module here — that is the whole point of the catalogue.
  useEffect(() => {
    if (selected || modules.length === 0) return;
    setSelected(modules[0]);
  }, [modules, selected]);

  const events = useMemo(() => eventsForModule(catalogue, selected ?? ''), [catalogue, selected]);
  const knownLocales = useMemo(
    () => Array.from(new Set(templateRows.map((t) => String(t.locale ?? '')).filter(Boolean))),
    [templateRows],
  );

  const readOnly = !canWrite(decision);
  const onChanged = () => refresh();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-condensed font-bold text-foreground">Configure Notifications</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Per-event notification setup. Each row is an event a module can notify about; add
          SMS / WhatsApp / Email notifications inline.
        </p>
      </div>

      <SourceBanner title={decision.title} message={decision.message} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Module</CardTitle>
          <CardDescription>Pick the module whose events you want to configure.</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center gap-3 flex-wrap">
          <Select
            value={selected ?? ''}
            onValueChange={setSelected}
            disabled={modules.length === 0}
          >
            <SelectTrigger className="h-9 w-[280px] text-sm" aria-label="Module">
              <SelectValue placeholder={modules.length === 0 ? 'No events declared' : 'Select a module'} />
            </SelectTrigger>
            <SelectContent>
              {modules.map((m) => (
                <SelectItem key={m} value={m} className="text-sm">{m}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {snapshot && <ValidatePanel snapshot={snapshot} />}
        </CardContent>
      </Card>

      {events.length > 0 && (
        <FieldSection title="Events">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30">
                <TableHead>Event & Notifications</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow className="align-top">
                <TableCell className="align-top">
                  {events.map((event) => {
                    const eventName = String(event.eventName ?? '');
                    const ctx: EventCtx = {
                      module: String(event.module ?? selected ?? ''),
                      event,
                      eventName,
                      actors: actorNames(event),
                      roles: roleCodes.filter(Boolean),
                      channels: eventChannels(event) ?? [...CHANNELS],
                      placeholders: placeholderNames(event),
                      knownLocales,
                    };
                    const rows = routingRows.filter((r) => eq(r.eventName, eventName));
                    return (
                      <EventRow
                        key={eventName}
                        ctx={ctx}
                        routingRows={rows}
                        templateRows={templateRows}
                        snapshot={snapshot}
                        readOnly={readOnly}
                        onChanged={onChanged}
                      />
                    );
                  })}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </FieldSection>
      )}
    </div>
  );
}

export default NotificationConfigure;
