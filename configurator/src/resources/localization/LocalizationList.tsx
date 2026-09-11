import { useListContext } from 'ra-core';
import { DigitList, DigitDatagrid } from '@/admin';
import type { DigitColumn } from '@/admin';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAvailableLocales, type LocaleOption } from '@/hooks/useAvailableLocales';
import { LocalizationToolbar } from './LocalizationToolbar';

const truncate = (s: unknown) => {
  const t = String(s ?? '');
  return t.length > 80 ? t.slice(0, 80) + '…' : t;
};

// Sentinel for the "all modules" option — Radix Select disallows an empty value.
const ALL_MODULES = '__all__';

/** Modules worth filtering to. `configurator-ui` (the configurator's own UI
 *  strings) is first since that's the common reason to come here. The list is
 *  curated because the localization service has no module-enumeration endpoint;
 *  any module not listed can still be reached by typing its code in search. */
const MODULE_OPTIONS: { value: string; label: string }[] = [
  { value: ALL_MODULES, label: 'All modules' },
  { value: 'configurator-ui', label: 'Configurator UI (configurator-ui)' },
  { value: 'rainmaker-common', label: 'rainmaker-common' },
  { value: 'rainmaker-common-masters', label: 'rainmaker-common-masters' },
  { value: 'rainmaker-pgr', label: 'rainmaker-pgr' },
  { value: 'rainmaker-hr', label: 'rainmaker-hr' },
  { value: 'rainmaker-hrms', label: 'rainmaker-hrms' },
  { value: 'rainmaker-workbench', label: 'rainmaker-workbench' },
  { value: 'egov-user', label: 'egov-user' },
  { value: 'egov-hrms', label: 'egov-hrms' },
];

/** Module filter. Writes `module` into the list filter state; the localization
 *  data provider passes it straight to the localization search so the grid
 *  shows just that module's messages (e.g. the configurator's own strings). */
function ModuleSelector() {
  const { filterValues, setFilters } = useListContext();
  const current = String(filterValues.module ?? '');
  const onChange = (v: string) => {
    const next = { ...filterValues };
    if (v === ALL_MODULES) delete next.module;
    else next.module = v;
    setFilters(next, undefined, true);
  };
  return (
    <div className="flex items-center gap-2 mb-3">
      <span className="text-xs font-medium text-muted-foreground">Module:</span>
      <Select value={current || ALL_MODULES} onValueChange={onChange}>
        <SelectTrigger className="w-[280px] h-8 text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>
          {MODULE_OPTIONS.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

/** One editable column per locale (msg__<locale>) so every language can be
 *  edited inline, side by side. `locales` is the tenant's own configured set
 *  (StateInfo.languages via useAvailableLocales) — NOT the configurator app's
 *  own UI-chrome locales, which is a different, unrelated list (see #1712). */
function MultiLocaleDatagrid({ locales }: { locales: LocaleOption[] }) {
  const columns: DigitColumn[] = [
    { source: 'code', label: 'app.fields.code' },
    { source: 'module', label: 'app.fields.module' },
    ...locales.map(({ value: loc, label }) => ({
      source: `msg__${loc}`,
      label,
      editable: true as const,
      render: (record: Record<string, unknown>) => {
        const v = record[`msg__${loc}`];
        return (
          <span className={`block max-w-[260px] truncate ${v ? '' : 'italic text-muted-foreground'}`}>
            {v ? truncate(v) : '— missing —'}
          </span>
        );
      },
    })),
  ];
  return <DigitDatagrid columns={columns} />;
}

export function LocalizationList() {
  // Tenant-scoped locales (StateInfo.languages) — same source every other
  // localization screen (Create/Edit/Toolbar/BulkImport) already uses. Was
  // previously the configurator app's own fixed UI-chrome locale list, which
  // showed languages the tenant never configured and the wrong regional code
  // for shared languages (e.g. pt_BR instead of a tenant's pt_PT) — #1712.
  const { locales } = useAvailableLocales();
  const localeCodes = locales.map((l) => l.value);
  return (
    <DigitList
      title="app.resources.localization"
      hasCreate
      sort={{ field: 'code', order: 'ASC' }}
      actions={<LocalizationToolbar />}
      // Permanent filter so the FIRST getList already pivots every locale.
      // LocalesFilterSetup used to apply this in a debounced effect, so the
      // badge flashed en_IN-only (~7900) then the union (~14000).
      filter={{ locales: localeCodes }}
    >
      <ModuleSelector />
      <MultiLocaleDatagrid locales={locales} />
    </DigitList>
  );
}
