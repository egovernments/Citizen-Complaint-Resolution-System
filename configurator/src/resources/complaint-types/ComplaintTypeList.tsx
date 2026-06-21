import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGetList, useTranslate, useDataProvider, useLocaleState, type RaRecord } from 'ra-core';
import { RefreshCw, ChevronRight, ChevronDown, Search, Plus, Pencil } from 'lucide-react';
import { DigitCard } from '@/components/digit/DigitCard';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { groupComplaintTypes, type SubTypeRecord } from './groupComplaintTypes';
import { filterComplaintTypeGroups } from './filterComplaintTypeGroups';
import { SubTypeTable } from './SubTypeTable';
import { RenameTypeDialog } from './RenameTypeDialog';
import { useServiceDefLabels } from './useServiceDefLabels';
import { menuPathCode } from './menuPathCode';
import { CopyableCode } from '@/components/ui/copyable-code';
import { localizationService } from '@/api/services/localization';
import { digitClient } from '@/providers/bridge';
import { toast } from '@/hooks/use-toast';

const GRID = 'grid grid-cols-[28px_1fr_120px_120px] gap-2';

export function ComplaintTypeList() {
  const translate = useTranslate();
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');

  const { data, isPending, isFetching, error, refetch } = useGetList(
    'complaint-types',
    {
      pagination: { page: 1, perPage: 1000 },
      sort: { field: 'serviceCode', order: 'ASC' },
    },
  );

  const dataProvider = useDataProvider();
  const [locale] = useLocaleState();
  const { labels: serviceDefLabels, refetch: refetchLabels } = useServiceDefLabels();

  // The configurator i18n only loads the `configurator-ui` module, so the
  // SERVICEDEFS.* type labels (module `rainmaker-pgr`) won't resolve through
  // `translate`. Resolve them from the fetched map; when a type has no label
  // yet, fall back to its raw menuPath code (last segment), which the UI shows
  // in monospace so it reads as an unnamed code rather than a real name.
  const labelTranslate = (key: string, opts?: { _?: string }) =>
    key.startsWith('SERVICEDEFS.')
      ? serviceDefLabels[key] ?? menuPathCode(opts?._ ?? '')
      : translate(key, opts);

  const handleRenameType = async (menuPath: string, newName: string) => {
    const tenantId = digitClient.stateTenantId;
    if (!tenantId) return;
    // The type's display name is localization-only. We upsert SERVICEDEFS.<CODE>
    // for the ACTIVE locale only: localization rows are keyed per
    // (tenant, module, locale, code), so writing every locale would clobber
    // other languages' existing translations with this one string. Other
    // locales are translated separately (Localization screen / bulk import).
    // The menuPath code itself is never modified.
    const code = `SERVICEDEFS.${menuPath.toUpperCase()}`;
    await localizationService.upsertMessages(tenantId, locale, [
      { code, message: newName, module: 'rainmaker-pgr', locale },
    ]);
    await localizationService.cacheBust();
    toast({ title: 'Complaint type renamed', description: newName });
    await refetchLabels();
    await refetch();
  };

  const handleDeleteSubType = async (record: SubTypeRecord) => {
    // dataProvider.delete maps to an MDMS soft-delete (isActive:false). On
    // success the active-only list no longer returns the row; refetch reflects
    // it (and drops the whole type if that was its last sub-type). A rejection
    // propagates to DeleteConfirmDialog, which shows the message in-dialog.
    await dataProvider.delete('complaint-types', {
      id: record.id,
      previousData: record as unknown as RaRecord,
    });
    toast({ title: 'Sub-type deleted', description: record.name ?? record.serviceName });
    await refetch();
  };

  const allGroups = groupComplaintTypes(
    (data ?? []) as unknown as SubTypeRecord[],
    labelTranslate,
  );
  const searching = query.trim().length > 0;
  const groups = filterComplaintTypeGroups(allGroups, query);

  const toggle = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  return (
    <div className="space-y-4">
      {/* Title bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl sm:text-3xl font-bold font-condensed text-foreground">
            {translate('app.resources.complaint_types', { _: 'Complaint Types' })}
          </h1>
          {data && (
            <Badge variant="secondary" className="text-xs">
              {allGroups.length}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={() => navigate('/manage/complaint-types/create')}
            className="gap-1.5"
          >
            <Plus className="w-4 h-4" />
            {translate('app.complaintTypes.add_type', { _: 'Add Complaint Type' })}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            className="gap-1.5"
          >
            <RefreshCw className={`w-4 h-4 ${isFetching ? 'animate-spin' : ''}`} />
            {translate('app.list.refresh', { _: 'Refresh' })}
          </Button>
        </div>
      </div>

      <DigitCard className="max-w-none">
        {/* Search */}
        <div className="mb-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder={translate('app.list.search', { _: 'Search complaint types…' })}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-9 max-w-sm"
            />
          </div>
        </div>

        {isPending && (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <RefreshCw className="w-5 h-5 animate-spin mr-2" />
            {translate('app.list.loading', { _: 'Loading…' })}
          </div>
        )}

        {error && !isPending && (
          <div className="text-center py-12">
            <p className="text-destructive font-medium">
              {translate('app.list.error_loading', { _: 'Failed to load' })}
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              {error instanceof Error
                ? error.message
                : translate('app.list.error_unexpected', {
                    _: 'An unexpected error occurred',
                  })}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              className="mt-3"
            >
              {translate('app.list.try_again', { _: 'Try Again' })}
            </Button>
          </div>
        )}

        {!isPending && !error && groups.length === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            <p className="font-medium">
              {searching
                ? translate('app.list.no_matches', {
                    _: 'No complaint types match your search.',
                  })
                : translate('app.list.no_records', { _: 'No complaint types yet' })}
            </p>
          </div>
        )}

        {!isPending && !error && groups.length > 0 && (
          <div className="border border-border rounded-md overflow-hidden">
            {/* Column header */}
            <div
              className={`${GRID} px-3 py-2 text-xs uppercase text-muted-foreground bg-muted/50 border-b border-border`}
            >
              <span />
              <span>{translate('app.fields.complaint_type', { _: 'Complaint Type' })}</span>
              <span>{translate('app.fields.sub_types', { _: 'Sub-Types' })}</span>
              <span>{translate('app.fields.active', { _: 'Active' })}</span>
            </div>

            {groups.map((g) => {
              const key = g.menuPath || '__uncategorized__';
              const isOpen = searching || expanded.has(g.menuPath);
              // No localized label → g.label is the raw menuPath code; render it
              // in monospace so operators can spot types that still need naming.
              const isCodeLabel =
                !g.isUncategorized && !serviceDefLabels[`SERVICEDEFS.${g.menuPath}`];
              return (
                <div key={key}>
                  <div
                    onClick={() => toggle(g.menuPath)}
                    className={`${GRID} px-3 py-3 items-center cursor-pointer border-b border-border hover:bg-muted/40 ${
                      isOpen ? 'bg-muted/40' : ''
                    }`}
                  >
                    <span className="text-muted-foreground">
                      {isOpen ? (
                        <ChevronDown className="w-4 h-4" />
                      ) : (
                        <ChevronRight className="w-4 h-4" />
                      )}
                    </span>
                    {isCodeLabel ? (
                      <CopyableCode
                        value={g.label}
                        showCopy={false}
                        maxChars={32}
                        className="text-sm text-muted-foreground"
                      />
                    ) : (
                      <span
                        className={`min-w-0 break-words text-sm ${
                          g.isUncategorized ? 'text-muted-foreground' : ''
                        }`}
                      >
                        {g.label}
                      </span>
                    )}
                    <span className="tabular-nums">{g.count}</span>
                    <span className="flex items-center justify-end gap-2">
                      <Badge
                        variant="outline"
                        className="text-xs bg-green-100 text-green-800 border-green-200"
                      >
                        {g.activeCount} active
                      </Badge>
                      {!g.isUncategorized && (
                        <RenameTypeDialog
                          currentName={g.label}
                          onRename={(newName) => handleRenameType(g.menuPath, newName)}
                          trigger={
                            <Button
                              variant="ghost"
                              size="sm"
                              aria-label={`Rename ${g.label}`}
                              className="h-7 w-7 p-0 flex-shrink-0"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                          }
                        />
                      )}
                    </span>
                  </div>
                  {isOpen && (
                    <div className="bg-muted/20 border-b border-border px-3 py-2 pl-10">
                      <SubTypeTable subTypes={g.subTypes} onDelete={handleDeleteSubType} />
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          const raw = g.isUncategorized
                            ? ''
                            : g.subTypes[0]?.menuPath ?? '';
                          navigate(
                            raw
                              ? `/manage/complaint-types/create?menuPath=${encodeURIComponent(raw)}`
                              : '/manage/complaint-types/create',
                          );
                        }}
                        className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        {translate('app.complaint_types.add_sub_type', { _: 'Add Sub-Type' })}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </DigitCard>
    </div>
  );
}
