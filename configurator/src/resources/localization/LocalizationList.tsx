import { useEffect } from 'react';
import { useListContext } from 'ra-core';
import { DigitList, DigitDatagrid } from '@/admin';
import type { DigitColumn } from '@/admin';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAvailableLocales, type LocaleOption } from '@/hooks/useAvailableLocales';
import { LocalizationToolbar } from './LocalizationToolbar';

const labelFor = (code: string, locales: LocaleOption[]) =>
  locales.find((o) => o.value === code)?.label ?? code;

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

const truncate = (s: unknown) => {
  const t = String(s ?? '');
  return t.length > 80 ? t.slice(0, 80) + '…' : t;
};

/** Two-locale picker rendered above the datagrid. Writes to the list filter
 *  state — the data provider reads `locale` (left col) + `locale2` (right
 *  col) and pivots both into one row per (code, module). */
function LocaleSelector() {
  const { filterValues, setFilters } = useListContext();
  const { locales, isLoading } = useAvailableLocales();

  // Defaults: first locale on the left, second locale on the right (or
  // duplicate when only one is registered). Honors any user choice in URL/state.
  const fallbackA = locales[0]?.value ?? 'en_IN';
  const fallbackB = locales[1]?.value ?? locales[0]?.value ?? 'en_IN';
  const localeA = String(filterValues.locale || fallbackA);
  const localeB = String(filterValues.locale2 || fallbackB);
  const update = (key: 'locale' | 'locale2') => (v: string) =>
    setFilters({ ...filterValues, [key]: v }, undefined, true);

  // Once locales are loaded, write the defaults into filter state so the
  // data provider receives locale/locale2 on the initial fetch instead of
  // waiting for the user to manually pick a locale.
  useEffect(() => {
    if (isLoading || locales.length === 0) return;
    const needsA = !filterValues.locale;
    const needsB = !filterValues.locale2;
    if (needsA || needsB) {
      setFilters({
        ...filterValues,
        ...(needsA ? { locale: fallbackA } : {}),
        ...(needsB ? { locale2: fallbackB } : {}),
      }, undefined, true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, fallbackA, fallbackB]);

  return (
    <div className="flex items-center gap-3 mb-3 flex-wrap">
      <span className="text-xs font-medium text-muted-foreground">Compare locales:</span>
      <Select value={localeA} onValueChange={update('locale')} disabled={isLoading}>
        <SelectTrigger className="w-[200px] h-8 text-xs"><SelectValue placeholder={isLoading ? 'loading…' : 'pick locale'} /></SelectTrigger>
        <SelectContent>
          {locales.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
        </SelectContent>
      </Select>
      <span className="text-xs text-muted-foreground">vs</span>
      <Select value={localeB} onValueChange={update('locale2')} disabled={isLoading}>
        <SelectTrigger className="w-[200px] h-8 text-xs"><SelectValue placeholder={isLoading ? 'loading…' : 'pick locale'} /></SelectTrigger>
        <SelectContent>
          {locales.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
        </SelectContent>
      </Select>
      {localeA === localeB && (
        <span className="text-xs text-warning-dark">Same locale on both sides — pick different ones to compare.</span>
      )}
    </div>
  );
}

/** Datagrid with column labels driven by the locale dropdowns. Rendered
 *  inside DigitList so it shares the ListContextProvider with the selector. */
function PivotDatagrid() {
  const { filterValues } = useListContext();
  const { locales } = useAvailableLocales();
  const fallbackA = locales[0]?.value ?? 'en_IN';
  const fallbackB = locales[1]?.value ?? locales[0]?.value ?? 'en_IN';
  const localeA = String(filterValues.locale || fallbackA);
  const localeB = String(filterValues.locale2 || fallbackB);

  const columns: DigitColumn[] = [
    { source: 'code', label: 'app.fields.code' },
    { source: 'module', label: 'app.fields.module' },
    {
      source: 'message',
      label: `Message · ${labelFor(localeA, locales)}`,
      editable: true,
      render: (record) => <span className="block max-w-[300px] truncate">{truncate(record.message)}</span>,
    },
    {
      source: 'message2',
      label: `Message · ${labelFor(localeB, locales)}`,
      editable: true,
      render: (record) => (
        <span className={`block max-w-[300px] truncate ${record.message2 ? '' : 'italic text-muted-foreground'}`}>
          {record.message2 ? truncate(record.message2) : '— missing —'}
        </span>
      ),
    },
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
      <LocaleSelector />
      <PivotDatagrid />
    </DigitList>
  );
}
