import { useMemo, useState } from 'react';
import { useInput, type InputProps } from 'ra-core';
import { useQuery } from '@tanstack/react-query';
import { digitClient } from '@/providers/bridge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Search, X, RotateCcw } from 'lucide-react';
import { SlaByLevelInput } from './SlaByLevelInput';

interface ServiceOverridesEditorProps extends InputProps {
  label?: string;
  help?: string;
}

interface ServiceDef {
  serviceCode: string;
  serviceName?: string;
  department?: string;
}

/**
 * Two-pane editor for `Record<serviceCode, number[]>` SLA overrides.
 *
 * Left: searchable list of service codes pulled from MDMS
 *   `RAINMAKER-PGR.ServiceDefs`. Selecting a code reveals (or creates) an
 *   override entry on the right.
 *
 * Right: a SlaByLevelInput bound to `overrides[selectedCode]`. The widget
 *   inherits the same `maxDepth` cap as the top-level default SLA array.
 *
 * The widget is "opt-in per row": adding a code seeds it with the current
 * defaultSlaByLevel (best UX — operators tweak from a baseline, not from
 * blank). Removing a code clears the override entirely.
 */
export function ServiceOverridesEditor({ label, help, ...inputProps }: ServiceOverridesEditorProps) {
  const { id, field, isRequired } = useInput(inputProps);

  const value: Record<string, number[]> = (
    field.value && typeof field.value === 'object' && !Array.isArray(field.value)
  )
    ? (field.value as Record<string, number[]>)
    : {};

  const [search, setSearch] = useState('');
  const [selectedCode, setSelectedCode] = useState<string | null>(() => {
    const first = Object.keys(value)[0];
    return first ?? null;
  });

  const tenantId = digitClient.stateTenantId;
  const { data: serviceDefs, isLoading } = useQuery<ServiceDef[], Error>({
    queryKey: ['escalation-config', 'service-defs', tenantId],
    queryFn: async () => {
      if (!tenantId) return [];
      const records = await digitClient.mdmsSearch(tenantId, 'RAINMAKER-PGR.ServiceDefs', { limit: 500 });
      const out: ServiceDef[] = [];
      for (const rec of records) {
        const data = (rec.data ?? {}) as Record<string, unknown>;
        const code = typeof data.serviceCode === 'string' ? data.serviceCode : (rec.uniqueIdentifier as string | undefined);
        if (!code) continue;
        out.push({
          serviceCode: code,
          serviceName: typeof data.serviceName === 'string' ? data.serviceName : undefined,
          department: typeof data.department === 'string' ? data.department : undefined,
        });
      }
      // Sort alphabetically so the list is stable across reloads.
      out.sort((a, b) => a.serviceCode.localeCompare(b.serviceCode));
      return out;
    },
    enabled: !!tenantId,
    staleTime: 5 * 60 * 1000,
  });

  const filtered = useMemo(() => {
    const list = serviceDefs ?? [];
    if (!search) return list;
    const needle = search.toLowerCase();
    return list.filter((s) =>
      s.serviceCode.toLowerCase().includes(needle) ||
      (s.serviceName?.toLowerCase().includes(needle) ?? false) ||
      (s.department?.toLowerCase().includes(needle) ?? false)
    );
  }, [serviceDefs, search]);

  const overridden = new Set(Object.keys(value));

  const addOverride = (code: string) => {
    if (overridden.has(code)) return;
    // Seed with empty array — SlaByLevelInput will let the user populate.
    field.onChange({ ...value, [code]: [] });
    setSelectedCode(code);
  };

  const removeOverride = (code: string) => {
    const next = { ...value };
    delete next[code];
    field.onChange(next);
    if (selectedCode === code) {
      const remaining = Object.keys(next);
      setSelectedCode(remaining[0] ?? null);
    }
  };

  const clearAll = () => {
    if (!confirm('Remove all per-service SLA overrides? Defaults will apply to every service.')) return;
    field.onChange({});
    setSelectedCode(null);
  };

  return (
    <div>
      {label && (
        <div className="mb-1.5 flex items-center justify-between">
          <Label htmlFor={id} className="block text-sm font-medium text-foreground">
            {label}
            {isRequired && <span className="text-destructive ml-0.5">*</span>}
          </Label>
          {Object.keys(value).length > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={clearAll}
              className="text-xs text-destructive hover:bg-destructive/10"
            >
              <RotateCcw className="w-3.5 h-3.5 mr-1" /> Clear all overrides
            </Button>
          )}
        </div>
      )}
      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-3 rounded border border-border bg-muted/10 p-3">
        {/* Left pane: service code list */}
        <div className="border-r-0 lg:border-r border-border/60 pr-0 lg:pr-3">
          <div className="relative mb-2">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search service codes..."
              className="pl-8 h-8 text-sm"
            />
          </div>
          {isLoading && <p className="text-xs text-muted-foreground p-2">Loading service definitions...</p>}
          {!isLoading && filtered.length === 0 && (
            <p className="text-xs text-muted-foreground p-2 italic">
              {search ? 'No matches.' : 'No service definitions found.'}
            </p>
          )}
          <ul className="max-h-80 overflow-y-auto space-y-0.5">
            {filtered.map((s) => {
              const isOverridden = overridden.has(s.serviceCode);
              const isSelected = selectedCode === s.serviceCode;
              return (
                <li key={s.serviceCode}>
                  <div
                    className={`group flex items-center gap-1 rounded px-2 py-1 text-sm cursor-pointer ${
                      isSelected ? 'bg-primary/15 text-primary font-medium' : 'hover:bg-muted'
                    }`}
                    onClick={() => {
                      if (!isOverridden) addOverride(s.serviceCode);
                      else setSelectedCode(s.serviceCode);
                    }}
                  >
                    <div className="flex-1 truncate">
                      <span className="font-mono text-xs">{s.serviceCode}</span>
                      {s.serviceName && <span className="text-xs text-muted-foreground ml-1">— {s.serviceName}</span>}
                    </div>
                    {isOverridden && (
                      <span
                        className="text-[10px] font-medium rounded px-1 py-0.5 bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
                        title="Has override"
                      >
                        OVR
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        {/* Right pane: SLA editor for the selected service */}
        <div>
          {!selectedCode && (
            <div className="h-full flex items-center justify-center text-sm text-muted-foreground italic p-6 text-center">
              {Object.keys(value).length === 0
                ? 'No per-service overrides set. Click a service on the left to add one.'
                : 'Select a service on the left to edit its SLAs.'}
            </div>
          )}
          {selectedCode && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-medium text-muted-foreground">Override for</div>
                  <div className="font-mono text-sm">{selectedCode}</div>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => removeOverride(selectedCode)}
                  className="text-xs"
                >
                  <X className="w-3.5 h-3.5 mr-1" /> Remove override
                </Button>
              </div>
              <SlaByLevelInput
                source={`${inputProps.source}.${selectedCode}`}
                label="SLA per level"
                help="Same shape as the default SLA array — one entry per level."
              />
            </div>
          )}
        </div>
      </div>
      {help && <p className="mt-1 text-xs text-muted-foreground">{help}</p>}
    </div>
  );
}
