import { useEffect } from 'react';
import { useListContext } from 'ra-core';
import { DigitList, DigitDatagrid } from '@/admin';
import type { DigitColumn } from '@/admin';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AVAILABLE_LOCALES } from '@/providers/i18nProvider';
import { LocalizationToolbar } from './LocalizationToolbar';

const truncate = (s: unknown) => {
  const t = String(s ?? '');
  return t.length > 80 ? t.slice(0, 80) + '…' : t;
};

// The configurator's supported locales — one editable column each.
const LOCALE_CODES = AVAILABLE_LOCALES.map((l) => l.locale);
const LOCALE_NAME: Record<string, string> = Object.fromEntries(
  AVAILABLE_LOCALES.map((l) => [l.locale, l.name]),
);

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

/** Pins the list to fetch every supported locale so the data provider pivots
 *  one msg__<locale> column per language. Runs once on mount. */
function LocalesFilterSetup() {
  const { filterValues, setFilters } = useListContext();
  useEffect(() => {
    if (!filterValues.locales) {
      setFilters({ ...filterValues, locales: LOCALE_CODES }, undefined, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

/** One editable column per locale (msg__<locale>) so every language can be
 *  edited inline, side by side. */
function MultiLocaleDatagrid() {
  const columns: DigitColumn[] = [
    { source: 'code', label: 'app.fields.code' },
    { source: 'module', label: 'app.fields.module' },
    ...LOCALE_CODES.map((loc) => ({
      source: `msg__${loc}`,
      label: `${LOCALE_NAME[loc]} (${loc})`,
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
  return (
    <DigitList
      title="app.resources.localization"
      hasCreate
      sort={{ field: 'code', order: 'ASC' }}
      actions={<LocalizationToolbar />}
    >
      <ModuleSelector />
      <LocalesFilterSetup />
      <MultiLocaleDatagrid />
    </DigitList>
  );
}
