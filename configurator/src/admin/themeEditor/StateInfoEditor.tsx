import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, RefreshCw, Save, X, Plus } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { DigitCard } from '@/components/digit/DigitCard';
import { ActionBar } from '@/components/digit/ActionBar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/hooks/use-toast';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useApp } from '../../App';
import { digitClient } from '@/providers/bridge';

/** Editor for `common-masters.StateInfo`.
 *
 *  We bypass the descriptor / generic-form path here because the schema-driven
 *  form swallows submits on this resource (still under investigation), and
 *  StateInfo controls user-visible language and module surfaces — it has to
 *  be writable through the UI. This editor talks directly to the data-provider
 *  so save does the one thing operators expect: the new locale shows up in
 *  the LocaleSelector and digit-ui language switcher after a refresh.
 *
 *  Layout mirrors the descriptor's intent (Identity / Languages /
 *  Localization modules / Branding / Routing) but renders its own widgets so
 *  it never depends on RHF state plumbing. */

type LocaleRow = { label: string; value: string };

interface StateInfoData {
  code?: string;
  name?: string;
  languages?: LocaleRow[];
  localizationModules?: LocaleRow[];
  hasLocalisation?: boolean;
  logoUrl?: string;
  logoUrlWhite?: string;
  statelogo?: string;
  bannerUrl?: string;
  defaultUrl?: { citizen?: string; employee?: string };
  [key: string]: unknown;
}

interface StateInfoRecord {
  id: string;
  tenantId: string;
  schemaCode: string;
  uniqueIdentifier: string;
  data: StateInfoData;
  isActive: boolean;
  auditDetails?: Record<string, unknown>;
}

function FieldRow({ label, help, children }: { label: string; help?: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm font-medium text-foreground">{label}</Label>
      {children}
      {help && <p className="text-xs text-muted-foreground">{help}</p>}
    </div>
  );
}

function LocaleTable({
  rows,
  onChange,
  emptyHint,
  addLabel,
}: {
  rows: LocaleRow[];
  onChange: (rows: LocaleRow[]) => void;
  emptyHint: string;
  addLabel: string;
}) {
  const update = (i: number, patch: Partial<LocaleRow>) =>
    onChange(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const remove = (i: number) => onChange(rows.filter((_, idx) => idx !== i));
  const add = () => onChange([...rows, { label: '', value: '' }]);

  return (
    <div>
      <div className="rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs font-medium text-muted-foreground">
            <tr>
              <th className="text-left px-3 py-2 w-1/2">Label</th>
              <th className="text-left px-3 py-2 w-1/2">Value</th>
              <th className="px-2 w-10"></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={3} className="px-3 py-4 text-center text-xs text-muted-foreground italic">
                  {emptyHint}
                </td>
              </tr>
            )}
            {rows.map((r, i) => (
              <tr key={i} className="border-t">
                <td className="px-3 py-1.5">
                  <Input
                    placeholder="e.g. English"
                    value={r.label ?? ''}
                    onChange={(e) => update(i, { label: e.target.value })}
                    className="h-8 text-sm"
                  />
                </td>
                <td className="px-3 py-1.5">
                  <Input
                    placeholder="e.g. en_IN"
                    value={r.value ?? ''}
                    onChange={(e) => update(i, { value: e.target.value })}
                    className="h-8 text-sm font-mono"
                  />
                </td>
                <td className="px-2 py-1.5 text-right">
                  <button
                    type="button"
                    onClick={() => remove(i)}
                    className="p-1 rounded hover:bg-destructive/10 hover:text-destructive transition"
                    aria-label={`Remove ${r.label || r.value || `row ${i + 1}`}`}
                  >
                    <X className="w-4 h-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Button type="button" variant="outline" size="sm" onClick={add} className="mt-2 gap-1.5">
        <Plus className="w-3.5 h-3.5" />
        {addLabel}
      </Button>
    </div>
  );
}

export function StateInfoEditor() {
  const { state } = useApp();
  const tenantId = state.tenant;
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const idRef = useRef(id);

  const [record, setRecord] = useState<StateInfoRecord | null>(null);
  const [data, setData] = useState<StateInfoData>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Load — search by tenant + schema, then pick the record matching the URL id
  // (which is uniqueIdentifier). MDMS doesn't expose a getById endpoint.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const records = (await digitClient.mdmsSearch(tenantId, 'common-masters.StateInfo', {
          limit: 50,
        })) as unknown as StateInfoRecord[];
        if (cancelled) return;
        const target =
          records.find((r) => r.uniqueIdentifier === idRef.current) ??
          records.find((r) => r.isActive) ??
          records[0];
        if (!target) {
          setLoadError(`No StateInfo record found on tenant ${tenantId}.`);
          return;
        }
        setRecord(target);
        setData({ ...target.data });
      } catch (e) {
        setLoadError((e as Error)?.message || 'Failed to load StateInfo.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  const languages = useMemo(() => data.languages ?? [], [data.languages]);
  const localizationModules = useMemo(() => data.localizationModules ?? [], [data.localizationModules]);

  const setField = <K extends keyof StateInfoData>(key: K, value: StateInfoData[K]) =>
    setData((prev) => ({ ...prev, [key]: value }));

  const setNestedDefaultUrl = (key: 'citizen' | 'employee', value: string) =>
    setData((prev) => ({ ...prev, defaultUrl: { ...prev.defaultUrl, [key]: value } }));

  const handleSave = async () => {
    if (!record) return;
    setSaving(true);
    setSaveError(null);
    try {
      // Strip empty rows so we don't persist `{label:"",value:""}` placeholders.
      const cleanLanguages = (data.languages ?? []).filter((r) => r.label?.trim() || r.value?.trim());
      const cleanModules = (data.localizationModules ?? []).filter(
        (r) => r.label?.trim() || r.value?.trim(),
      );
      const updated: StateInfoData = {
        ...record.data,
        ...data,
        languages: cleanLanguages,
        localizationModules: cleanModules,
      };
      await digitClient.mdmsUpdate(
        {
          ...record,
          data: updated,
        },
        record.isActive,
      );
      toast({
        title: 'State Info updated',
        description: data.name ?? record.uniqueIdentifier,
      });
      navigate('/manage/state-info');
    } catch (e) {
      const msg = (e as Error)?.message || 'Failed to save State Info.';
      setSaveError(msg);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)} className="gap-1.5">
          <ArrowLeft className="w-4 h-4" /> Back
        </Button>
        <DigitCard className="p-8 text-center text-muted-foreground">
          <RefreshCw className="w-5 h-5 animate-spin inline-block mr-2" /> Loading State Info…
        </DigitCard>
      </div>
    );
  }

  if (loadError || !record) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)} className="gap-1.5">
          <ArrowLeft className="w-4 h-4" /> Back
        </Button>
        <Alert variant="destructive">
          <AlertDescription>{loadError ?? 'No record loaded.'}</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)} className="gap-1.5">
          <ArrowLeft className="w-4 h-4" /> Back
        </Button>
        <h1 className="text-2xl sm:text-3xl font-bold font-condensed text-foreground">
          Edit State Info: {record.uniqueIdentifier}
        </h1>
        {saving && <RefreshCw className="w-4 h-4 animate-spin text-muted-foreground" />}
      </div>

      <DigitCard className="max-w-none">
        {saveError && (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription>{saveError}</AlertDescription>
          </Alert>
        )}

        <div className="space-y-6">
          <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FieldRow label="Code" help="State code (uppercase, e.g. KE).">
              <Input value={data.code ?? ''} onChange={(e) => setField('code', e.target.value)} />
            </FieldRow>
            <FieldRow label="Name" help="Display name of the state / country.">
              <Input value={data.name ?? ''} onChange={(e) => setField('name', e.target.value)} />
            </FieldRow>
          </section>

          <section>
            <h2 className="text-sm font-semibold mb-2">Languages</h2>
            <p className="text-xs text-muted-foreground mb-2">
              Each row appears in the digit-ui language switcher and in the configurator's locale dropdowns.
            </p>
            <LocaleTable
              rows={languages}
              onChange={(rows) => setField('languages', rows)}
              addLabel="Add language"
              emptyHint="No locales yet — add one to make it appear in the language switcher."
            />
          </section>

          <section>
            <h2 className="text-sm font-semibold mb-2">Localization modules</h2>
            <p className="text-xs text-muted-foreground mb-2">
              Modules the digit-ui pre-fetches on init. Same {`{label, value}`} shape as Languages.
            </p>
            <LocaleTable
              rows={localizationModules}
              onChange={(rows) => setField('localizationModules', rows)}
              addLabel="Add module"
              emptyHint="No modules listed."
            />
          </section>

          <section className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={!!data.hasLocalisation}
              onChange={(e) => setField('hasLocalisation', e.target.checked)}
              id="hasLocalisation"
              className="h-4 w-4 accent-primary-main"
            />
            <Label htmlFor="hasLocalisation" className="text-sm">
              <span className="font-medium">hasLocalisation</span>
              <span className="text-muted-foreground"> — when off, digit-ui skips the localization fetch entirely.</span>
            </Label>
          </section>

          <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FieldRow label="Logo URL" help="Primary state logo (used in headers and login).">
              <Input value={data.logoUrl ?? ''} onChange={(e) => setField('logoUrl', e.target.value)} />
            </FieldRow>
            <FieldRow label="Logo URL (white variant)">
              <Input value={data.logoUrlWhite ?? ''} onChange={(e) => setField('logoUrlWhite', e.target.value)} />
            </FieldRow>
            <FieldRow label="State logo (legacy alias)">
              <Input value={data.statelogo ?? ''} onChange={(e) => setField('statelogo', e.target.value)} />
            </FieldRow>
            <FieldRow label="Banner URL" help="Background image used on the citizen landing.">
              <Input value={data.bannerUrl ?? ''} onChange={(e) => setField('bannerUrl', e.target.value)} />
            </FieldRow>
          </section>

          <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FieldRow label="Default URL — Citizen">
              <Input
                value={data.defaultUrl?.citizen ?? ''}
                onChange={(e) => setNestedDefaultUrl('citizen', e.target.value)}
              />
            </FieldRow>
            <FieldRow label="Default URL — Employee">
              <Input
                value={data.defaultUrl?.employee ?? ''}
                onChange={(e) => setNestedDefaultUrl('employee', e.target.value)}
              />
            </FieldRow>
          </section>
        </div>

        <ActionBar>
          <Button variant="outline" onClick={() => navigate(-1)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving} className="gap-1.5">
            {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save
          </Button>
        </ActionBar>
      </DigitCard>
    </div>
  );
}
