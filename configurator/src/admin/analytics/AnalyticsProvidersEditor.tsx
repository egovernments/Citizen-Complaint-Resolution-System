import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Loader2, Plus, RefreshCw, Save, ShieldAlert, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { toast } from '@/hooks/use-toast';
import { useApp } from '../../App';
import { digitClient } from '@/providers/bridge';
import { getDescriptor } from '../schemaDescriptors';
import type { FieldSpec } from '../schemaDescriptors/types';
import {
  PROVIDER_TYPES,
  REASONS,
  REASON_TEXT,
  fieldsForType,
  hasResidencyAck,
  hostIsUnverifiable,
  requiresResidencyAck,
  validateProviderRecord,
  type AnalyticsProviderRecord,
} from './analyticsProviderRules';

/**
 * Analytics destinations for the citizen/employee SPA.
 *
 * Each row of `common-masters.AnalyticsProvider` is one destination. The SPA
 * (digit-ui-esbuild/public/analytics.js) reads these rows anonymously at boot and
 * initialises the ones that are enabled — so this screen, not a redeploy, is what
 * turns analytics on and off.
 *
 * WHY THIS IS A DEDICATED EDITOR AND NOT THE GENERIC MDMS CRUD
 * mdms-v2 resolves reads up the tenant tree, so at a city tenant this list also
 * contains rows OWNED BY THE STATE. The generic dataProvider's update and delete
 * both re-resolve the record with a search that is not scoped to the session
 * tenant, which means editing an inherited row would rewrite the state row for
 * every city that inherits it, and one delete click would switch analytics off
 * everywhere. This editor therefore:
 *   - labels every row with its provenance (owned here vs inherited),
 *   - writes ONLY rows this tenant owns, shadowing an inherited row with a new
 *     row at this tenant instead,
 *   - never deletes: switching a destination off is `enabled: false` on a
 *     permanent record, which is also how a city opts out of a state destination.
 *
 * The residency acknowledgement is enforced here, at save time, because it is a
 * human decision about where citizen data may go — the SPA cannot make it.
 */

const SCHEMA = 'common-masters.AnalyticsProvider';
const PAGE_LIMIT = 200;

/** Only these roles may write. See the caveat rendered in the banner below: with
 *  Kong in audit mode this is a UI guard, not a server-side control. */
const WRITE_ROLES = ['SUPERUSER', 'MDMS_ADMIN'];

/** Keys the schema declares. The payload is built from THIS list rather than by
 *  spreading a record: the schema is `additionalProperties: false`, so a stray
 *  id/_uniqueIdentifier/auditDetails key makes the write fail outright. */
const SCHEMA_KEYS = [
  'code', 'type', 'enabled', 'order', 'scriptUrl', 'endpointUrl', 'siteId',
  'measurementId', 'apiKey', 'dsn', 'globalName', 'sampleRate',
  'disablePageViews', 'trackClicks', 'trackErrors', 'surfaces', 'scrubPatterns',
  'settings', 'adapter',
] as const;

const NUMBER_KEYS = new Set(['order', 'sampleRate']);
const BOOLEAN_KEYS = new Set(['enabled', 'disablePageViews', 'trackClicks', 'trackErrors']);
const JSON_KEYS = new Set(['settings', 'adapter']);

/** Vendor credentials. Masked for read-only viewers: the route is reachable by
 *  any logged-in employee, and while these keys are write-only at the vendor,
 *  there is no reason to hand them to people who cannot edit the record. */
const SECRET_KEYS = new Set(['apiKey', 'dsn']);

function maskSecret(v: unknown): string {
  const s = String(v ?? '');
  if (!s) return '';
  return s.length <= 6 ? '••••••' : `${s.slice(0, 4)}…${'•'.repeat(6)}`;
}

interface MdmsRow {
  id?: string;
  tenantId: string;
  schemaCode: string;
  uniqueIdentifier: string;
  isActive: boolean;
  data: AnalyticsProviderRecord;
  auditDetails?: Record<string, unknown>;
}

interface MergedRow {
  code: string;
  data: AnalyticsProviderRecord;
  /** Which tenant the row we would WRITE belongs to. */
  ownerTenant: string;
  /** True when this tenant owns the row; false when it is inherited. */
  owned: boolean;
  row: MdmsRow | null;
}

/** Mirrors the shim's collect(): drop rows whose tenantId is not the tenant we
 *  asked for. mdms-v2 answers a city search with the STATE rows while the city
 *  owns none, so without this the same row appears twice and an `enabled: false`
 *  city override could never win. */
function ownRowsOnly(rows: MdmsRow[], wantTenant: string): MdmsRow[] {
  return (rows || []).filter((r) => r && r.tenantId === wantTenant && r.isActive !== false && r.data);
}

function mergeRows(stateRows: MdmsRow[], cityRows: MdmsRow[], tenantId: string, stateTenant: string): MergedRow[] {
  const byCode = new Map<string, MergedRow>();
  for (const r of stateRows) {
    const code = String(r.data.code || r.uniqueIdentifier || '');
    if (!code) continue;
    byCode.set(code, { code, data: r.data, ownerTenant: stateTenant, owned: stateTenant === tenantId, row: r });
  }
  for (const r of cityRows) {
    const code = String(r.data.code || r.uniqueIdentifier || '');
    if (!code) continue;
    // Wholesale replace, enabled:false included — that is the per-city opt-out.
    byCode.set(code, { code, data: r.data, ownerTenant: tenantId, owned: true, row: r });
  }
  return [...byCode.values()].sort((a, b) => {
    const ao = typeof a.data.order === 'number' ? a.data.order : 999;
    const bo = typeof b.data.order === 'number' ? b.data.order : 999;
    return ao - bo || a.code.localeCompare(b.code);
  });
}

/** Build the write payload from the form draft: only schema keys, empties
 *  dropped (so clearing a field actually removes it despite MDMS update merging
 *  rather than replacing), numbers coerced. */
export function buildPayload(draft: AnalyticsProviderRecord): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of SCHEMA_KEYS) {
    const v = (draft as Record<string, unknown>)[key];
    if (v === undefined || v === null) continue;
    if (typeof v === 'string' && v.trim() === '') continue;
    if (JSON_KEYS.has(key) && typeof v === 'object' && Object.keys(v as object).length === 0) continue;
    if (NUMBER_KEYS.has(key)) {
      const n = typeof v === 'number' ? v : Number(v);
      if (Number.isNaN(n)) continue;
      out[key] = n;
      continue;
    }
    if (BOOLEAN_KEYS.has(key)) {
      out[key] = v === true;
      continue;
    }
    out[key] = v;
  }
  // enabled must always be present and explicit: the flag is the whole contract.
  out.enabled = draft.enabled === true;
  return out;
}

export function AnalyticsProvidersEditor() {
  const { state } = useApp();
  const tenantId = state.tenant;
  const stateTenant = digitClient.stateTenantId || tenantId;
  const roles: string[] = useMemo(() => state.user?.roles ?? [], [state.user]);
  const canWrite = roles.some((r) => WRITE_ROLES.includes(r));

  const descriptor = getDescriptor(SCHEMA);
  const specByPath = useMemo(
    () => new Map<string, FieldSpec>((descriptor?.fields ?? []).map((f) => [f.path, f])),
    [descriptor]
  );

  const [rows, setRows] = useState<MergedRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [editingCode, setEditingCode] = useState<string | null>(null);
  // Bumped on every startCreate so two consecutive "Add destination" sessions
  // produce different textarea keys and React remounts them (see the key below).
  const [createSeq, setCreateSeq] = useState(0);
  const [draft, setDraft] = useState<AnalyticsProviderRecord | null>(null);
  const [isNew, setIsNew] = useState(false);
  /** Per-field JSON parse errors for the settings/adapter textareas. A parse error
   *  blocks save: the alternative (keep the last valid value) persists the
   *  pre-edit object under a success toast. */
  const [jsonErrors, setJsonErrors] = useState<Record<string, string | null>>({});
  /** null = probe not finished. false = this environment's SPA bundle has no shim. */
  const [bundleSupported, setBundleSupported] = useState<boolean | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [stateRaw, cityRaw] = await Promise.all([
        digitClient.mdmsSearch(stateTenant, SCHEMA, { limit: PAGE_LIMIT }) as unknown as Promise<MdmsRow[]>,
        tenantId !== stateTenant
          ? (digitClient.mdmsSearch(tenantId, SCHEMA, { limit: PAGE_LIMIT }) as unknown as Promise<MdmsRow[]>)
          : Promise.resolve([] as MdmsRow[]),
      ]);
      setRows(mergeRows(ownRowsOnly(stateRaw, stateTenant), ownRowsOnly(cityRaw, tenantId), tenantId, stateTenant));
    } catch (e) {
      // A missing schema is the normal state of a fresh environment, not an error
      // worth shouting about — but do say what to run.
      const msg = (e as Error)?.message || 'Failed to load analytics destinations.';
      setLoadError(
        /schema/i.test(msg)
          ? `${msg} — if this environment has never been seeded, run local-setup/scripts/seed-analytics-schema.sh.`
          : msg
      );
    } finally {
      setLoading(false);
    }
  }, [tenantId, stateTenant]);

  useEffect(() => {
    void load();
  }, [load]);

  // Does the SPA bundle on this environment actually carry the shim? A missing
  // file is served as the SPA shell (200 text/html) by every nginx layer here,
  // so the content type is the only reliable tell. Without this probe the screen
  // would silently promise something the deployed bundle cannot do.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Under `vite` there is no /digit-ui proxy, so the probe always fails and
      // the warning would be a false alarm on a developer's machine.
      if (import.meta.env.DEV) {
        if (!cancelled) setBundleSupported(null);
        return;
      }
      try {
        const res = await fetch('/digit-ui/analytics.js', { method: 'HEAD' });
        const ct = res.headers.get('content-type') || '';
        if (!cancelled) setBundleSupported(res.ok && ct.includes('javascript'));
      } catch {
        if (!cancelled) setBundleSupported(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const startEdit = (row: MergedRow) => {
    setJsonErrors({});
    setEditingCode(row.code);
    setIsNew(false);
    setDraft({ ...row.data });
    setSaveError(null);
  };

  const startCreate = () => {
    setJsonErrors({});
    setCreateSeq((n) => n + 1);
    setEditingCode('');
    setIsNew(true);
    setDraft({ code: '', type: 'MATOMO', enabled: false });
    setSaveError(null);
  };

  const cancelEdit = () => {
    setJsonErrors({});
    setEditingCode(null);
    setDraft(null);
    setSaveError(null);
  };

  const setField = (key: keyof AnalyticsProviderRecord, value: unknown) =>
    setDraft((prev) => (prev ? { ...prev, [key]: value } : prev));

  const setAck = (checked: boolean) =>
    setDraft((prev) =>
      prev ? { ...prev, settings: { ...(prev.settings ?? {}), residencyAck: checked } } : prev
    );

  const editingRow = useMemo(
    () => (editingCode && !isNew ? rows.find((r) => r.code === editingCode) ?? null : null),
    [editingCode, isNew, rows]
  );

  const verdict = draft ? validateProviderRecord(draft, { requireEnabled: false, customEnabled: true }) : null;
  const ackMissing = draft ? requiresResidencyAck(draft) && !hasResidencyAck(draft) : false;
  // A draft may be saved incomplete while it is switched OFF; enabling it
  // requires it to be complete and, for a cloud destination, acknowledged.
  const jsonError = Object.values(jsonErrors).find((e) => !!e) ?? null;
  // A host outside the compile-time allowlist is not necessarily wrong: ops can
  // widen the list with ANALYTICS_SCRIPT_HOSTS, which this app cannot read. Warn,
  // and let the shim be the enforcer.
  const unverifiableHost = draft ? hostIsUnverifiable(draft) : null;
  const blockedReason = !draft
    ? null
    : jsonError
      ? jsonError
      : !String(draft.code || '').trim()
      ? REASON_TEXT[REASONS.MISSING_CODE]
      : draft.enabled === true && verdict && !verdict.ok && verdict.reason !== REASONS.SCRIPT_URL_HOST_NOT_ALLOWED
        ? REASON_TEXT[verdict.reason] ?? verdict.reason
        : ackMissing
          ? 'Tick the data-residency acknowledgement before switching a destination outside the cluster on.'
          : null;

  const handleSave = async () => {
    if (!draft || !canWrite || blockedReason) return;
    setSaving(true);
    setSaveError(null);
    const code = String(draft.code || '').trim();
    try {
      const payload = buildPayload({ ...draft, code });
      const target = editingRow;
      // Only ever update a row this tenant OWNS. An inherited row is shadowed by
      // a new row here, which leaves the parent untouched for every other city.
      if (target?.row && target.owned && target.row.tenantId === tenantId) {
        if (String(target.row.uniqueIdentifier) !== code) {
          throw new Error(
            `Refusing to save: code "${code}" does not match this record's identity "${target.row.uniqueIdentifier}". The code is immutable.`
          );
        }
        await digitClient.mdmsUpdate(
          { ...target.row, data: payload } as unknown as Parameters<typeof digitClient.mdmsUpdate>[0],
          target.row.isActive
        );
      } else {
        await digitClient.mdmsCreate(tenantId, SCHEMA, code, payload);
      }
      toast({
        title: draft.enabled ? 'Destination saved and enabled' : 'Destination saved (switched off)',
        description: `${code} at ${tenantId}. The SPA picks this up on the next page load, within about 90 seconds.`,
      });
      cancelEdit();
      await load();
    } catch (e) {
      const msg = (e as Error)?.message || 'Failed to save.';
      setSaveError(
        msg.includes('MDMS_DUPLICATE')
          ? `A destination with the code "${code}" already exists at this tenant (it may be switched off). Edit that row instead of creating a second one — MDMS has no delete.`
          : msg
      );
    } finally {
      setSaving(false);
    }
  };

  const toggleEnabled = async (row: MergedRow, next: boolean) => {
    if (!canWrite) return;
    // Enabling from the list still has to satisfy the same rules as the form,
    // otherwise the list becomes a way around the residency acknowledgement.
    const candidate: AnalyticsProviderRecord = { ...row.data, enabled: next };
    if (next) {
      const v = validateProviderRecord(candidate, { requireEnabled: false, customEnabled: true });
      if (!v.ok) {
        toast({ title: 'Cannot enable this destination', description: REASON_TEXT[v.reason] ?? v.reason });
        startEdit(row);
        return;
      }
      if (requiresResidencyAck(candidate) && !hasResidencyAck(candidate)) {
        toast({
          title: 'Data-residency acknowledgement required',
          description: 'This destination sends data outside the cluster. Open it and tick the acknowledgement.',
        });
        startEdit(row);
        return;
      }
    }
    setSaving(true);
    try {
      const payload = buildPayload(candidate);
      if (row.row && row.owned && row.row.tenantId === tenantId) {
        await digitClient.mdmsUpdate(
          { ...row.row, data: payload } as unknown as Parameters<typeof digitClient.mdmsUpdate>[0],
          row.row.isActive
        );
      } else {
        await digitClient.mdmsCreate(tenantId, SCHEMA, row.code, payload);
      }
      await load();
    } catch (e) {
      toast({ title: 'Failed to change this destination', description: (e as Error)?.message || '' });
    } finally {
      setSaving(false);
    }
  };

  // Only rows the shim would ACTUALLY initialise: enabled AND valid. Counting
  // merely-enabled rows overstates the rollout — an enabled row missing its
  // siteId is refused at boot.
  const effective = rows.filter(
    (r) => r.data.enabled === true && validateProviderRecord(r.data, { requireEnabled: false, customEnabled: true }).ok
  );

  const label = (path: string, fallback: string) => specByPath.get(path)?.label ?? fallback;
  const help = (path: string) => specByPath.get(path)?.help;

  const renderField = (key: string) => {
    if (!draft) return null;
    const spec = specByPath.get(key);
    const value = (draft as Record<string, unknown>)[key];

    if (key === 'code') {
      return (
        <div key={key} className="space-y-1.5">
          <Label htmlFor="ap-code">{label('code', 'Code')}</Label>
          <Input
            id="ap-code"
            value={String(value ?? '')}
            disabled={!isNew || !canWrite}
            onChange={(e) => setField('code', e.target.value)}
            placeholder="matomo-state"
          />
          <p className="text-xs text-muted-foreground">
            {isNew ? help('code') : 'The code is the record identity and cannot be changed.'}
          </p>
        </div>
      );
    }

    if (key === 'type') {
      return (
        <div key={key} className="space-y-1.5">
          <Label htmlFor="ap-type">{label('type', 'Provider')}</Label>
          <Select value={String(value ?? '')} onValueChange={(v) => setField('type', v)} disabled={!canWrite}>
            <SelectTrigger id="ap-type">
              <SelectValue placeholder="Pick a provider" />
            </SelectTrigger>
            <SelectContent>
              {PROVIDER_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">{help('type')}</p>
        </div>
      );
    }

    if (BOOLEAN_KEYS.has(key)) {
      return (
        <div key={key} className="flex items-start gap-2 pt-1">
          <input
            id={`ap-${key}`}
            type="checkbox"
            className="mt-1"
            checked={value === true}
            disabled={!canWrite}
            onChange={(e) => setField(key as keyof AnalyticsProviderRecord, e.target.checked)}
          />
          <div>
            <Label htmlFor={`ap-${key}`}>{label(key, key)}</Label>
            {help(key) && <p className="text-xs text-muted-foreground">{help(key)}</p>}
          </div>
        </div>
      );
    }

    if (JSON_KEYS.has(key)) {
      const parseError = jsonErrors[key];
      return (
        <div key={key} className="space-y-1.5 md:col-span-2">
          <Label htmlFor={`ap-${key}`}>{label(key, key)}</Label>
          <textarea
            id={`ap-${key}`}
            // Keyed by the row being edited so React REMOUNTS it when the admin
            // switches rows. Without this the textarea keeps the previous row's
            // JSON on screen (same position, same key) and could save it onto the
            // new record.
            // `||` not `??`: startCreate sets editingCode to '' (not null), and
            // `??` only falls back on null/undefined — so create sessions all
            // shared the key '-settings' and the textarea was reused, leaving
            // the previous session's JSON on screen over an empty draft.
            // createSeq increments per startCreate so repeated creates remount too.
            key={`${editingCode || `new-${createSeq}`}-${key}`}
            rows={key === 'adapter' ? 10 : 4}
            spellCheck={false}
            className={
              'w-full rounded-md border bg-background p-2 font-mono text-xs ' +
              (parseError ? 'border-destructive' : 'border-input')
            }
            defaultValue={value ? JSON.stringify(value, null, 2) : ''}
            disabled={!canWrite}
            aria-invalid={parseError ? true : undefined}
            onChange={(e) => {
              const text = e.target.value;
              if (text.trim() === '') {
                setJsonErrors((prev) => ({ ...prev, [key]: null }));
                setField(key as keyof AnalyticsProviderRecord, undefined);
                return;
              }
              try {
                const parsed = JSON.parse(text);
                setJsonErrors((prev) => ({ ...prev, [key]: null }));
                setField(key as keyof AnalyticsProviderRecord, parsed);
              } catch {
                // Record the error and BLOCK save. Silently keeping the last
                // valid value would let a typo persist the pre-edit object under
                // a "saved" toast — the admin would believe their edit landed.
                setJsonErrors((prev) => ({ ...prev, [key]: 'Invalid JSON — fix the syntax to enable save.' }));
              }
            }}
          />
          {parseError ? (
            <p className="text-xs text-destructive" role="alert">
              {parseError}
            </p>
          ) : (
            help(key) && <p className="text-xs text-muted-foreground">{help(key)}</p>
          )}
        </div>
      );
    }

    // Read-only viewers get vendor credentials masked, not rendered.
    if (SECRET_KEYS.has(key) && !canWrite) {
      return (
        <div key={key} className="space-y-1.5">
          <Label htmlFor={`ap-${key}`}>{label(key, key)}</Label>
          <Input id={`ap-${key}`} value={maskSecret(value)} disabled />
          <p className="text-xs text-muted-foreground">Hidden — editing needs the {WRITE_ROLES.join(' or ')} role.</p>
        </div>
      );
    }

    return (
      <div key={key} className="space-y-1.5">
        <Label htmlFor={`ap-${key}`}>{label(key, key)}</Label>
        <Input
          id={`ap-${key}`}
          type={spec?.widget === 'number' || spec?.widget === 'integer' ? 'number' : 'text'}
          value={value === undefined || value === null ? '' : String(value)}
          disabled={!canWrite}
          onChange={(e) =>
            setField(
              key as keyof AnalyticsProviderRecord,
              NUMBER_KEYS.has(key) ? (e.target.value === '' ? undefined : Number(e.target.value)) : e.target.value
            )
          }
        />
        {help(key) && <p className="text-xs text-muted-foreground">{help(key)}</p>}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Analytics Providers</h1>
          <p className="text-sm text-muted-foreground">
            Destinations the citizen and employee portal may send analytics to. Nothing is sent until a destination
            here is switched on. Tenant <span className="font-mono">{tenantId}</span>
            {tenantId !== stateTenant && (
              <>
                {' '}
                (inheriting from <span className="font-mono">{stateTenant}</span>)
              </>
            )}
            .
          </p>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className="mr-1 h-4 w-4" /> Reload
          </Button>
          {canWrite && (
            <Button type="button" size="sm" onClick={startCreate} disabled={loading || saving}>
              <Plus className="mr-1 h-4 w-4" /> Add destination
            </Button>
          )}
        </div>
      </div>

      {!canWrite && (
        <Alert>
          <ShieldAlert className="h-4 w-4" />
          <AlertDescription>
            Read-only: changing analytics destinations needs the {WRITE_ROLES.join(' or ')} role.
          </AlertDescription>
        </Alert>
      )}

      {bundleSupported === false && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            This environment's portal bundle does not carry the analytics shim yet, so nothing configured here will run.
            Redeploy digit-ui, then reload this page.
          </AlertDescription>
        </Alert>
      )}

      {loadError && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            What the portal will actually run: {effective.length === 0 ? 'nothing' : `${effective.length} destination(s)`}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading destinations…
            </p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No destinations are configured for this tenant. Analytics is off — the portal loads the shim, finds no
              rows and does nothing.
            </p>
          ) : (
            <ul className="divide-y">
              {rows.map((row) => {
                const v = validateProviderRecord(row.data, { requireEnabled: false, customEnabled: true });
                const live = row.data.enabled === true;
                return (
                  <li key={`${row.ownerTenant}:${row.code}`} className="flex items-center justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium">
                        <span className="font-mono">{row.code}</span>{' '}
                        <span className="text-muted-foreground">· {row.data.type}</span>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {live ? 'Enabled' : 'Switched off'} ·{' '}
                        {row.owned ? (
                          <>
                            owned by <span className="font-mono">{row.ownerTenant}</span>
                          </>
                        ) : (
                          <>
                            inherited from <span className="font-mono">{row.ownerTenant}</span> — saving here creates a
                            copy for {tenantId} and leaves the parent untouched
                          </>
                        )}
                        {!v.ok && v.reason !== REASONS.DISABLED && ` · incomplete: ${REASON_TEXT[v.reason] ?? v.reason}`}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {canWrite && (
                        <Button
                          type="button"
                          variant={live ? 'outline' : 'default'}
                          size="sm"
                          disabled={saving}
                          onClick={() => void toggleEnabled(row, !live)}
                        >
                          {live ? 'Switch off' : 'Switch on'}
                        </Button>
                      )}
                      <Button type="button" variant="ghost" size="sm" onClick={() => startEdit(row)}>
                        {canWrite ? 'Edit' : 'View'}
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {draft && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {isNew ? 'New destination' : `Edit ${draft.code}`}
              {!isNew && editingRow && !editingRow.owned && (
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  (inherited — saving creates a copy for {tenantId})
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">{fieldsForType(String(draft.type || '')).map(renderField)}</div>

            {requiresResidencyAck(draft) && (
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  <label className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={hasResidencyAck(draft)}
                      disabled={!canWrite}
                      onChange={(e) => setAck(e.target.checked)}
                    />
                    <span>
                      I acknowledge that <strong>{draft.type}</strong> sends usage data to a service outside this
                      cluster, and that this has been approved for this programme. Recorded on the record as
                      <span className="font-mono"> settings.residencyAck</span>.
                    </span>
                  </label>
                </AlertDescription>
              </Alert>
            )}

            {unverifiableHost && (
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  <span className="font-mono">{unverifiableHost}</span> is not one of the vendor hosts the portal trusts
                  by default. The portal will refuse this destination unless ops has added the host to{' '}
                  <span className="font-mono">ANALYTICS_SCRIPT_HOSTS</span> in globalConfigs — this screen cannot check
                  that, and cannot widen it.
                </AlertDescription>
              </Alert>
            )}

            {blockedReason && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>{blockedReason}</AlertDescription>
              </Alert>
            )}

            {saveError && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>{saveError}</AlertDescription>
              </Alert>
            )}

            <div className="flex gap-2">
              <Button type="button" onClick={() => void handleSave()} disabled={!canWrite || saving || !!blockedReason}>
                {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />}
                Save
              </Button>
              <Button type="button" variant="ghost" onClick={cancelEdit} disabled={saving}>
                <X className="mr-1 h-4 w-4" /> Cancel
              </Button>
            </div>

            <p className="text-xs text-muted-foreground">
              Destinations are never deleted — switching one off is the off switch, and a city row switched off also
              overrides an inherited one. MDMS has no delete, so a removed row could never be recreated with the same
              code.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
