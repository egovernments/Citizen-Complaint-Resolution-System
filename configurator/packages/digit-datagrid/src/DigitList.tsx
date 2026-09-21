import React, { useState, useCallback, useMemo } from 'react';
import {
  useListController,
  ListContextProvider,
  useTranslate,
  type ListControllerProps,
  type SortPayload,
  type FilterPayload,
  type RaRecord,
} from 'ra-core';
import { useNavigate, useLocation } from 'react-router-dom';
import { RefreshCw, Plus, Search, Settings2 } from 'lucide-react';
import { Badge } from './primitives/badge';
import { Button } from './primitives/button';
import { Input } from './primitives/input';
import { Popover, PopoverTrigger, PopoverContent } from './primitives/popover';
import { useColumnConfig } from './editing/useColumnConfig';
import type { DigitColumn } from './columns/types';
import type { FilterElement } from './filters/types';
import { FilterBar } from './filters/FilterBar';

export interface DigitListProps {
  /** Page title displayed as h1 */
  title: string;
  /** Optional subtitle shown below the title */
  subtitle?: string;
  /** Resource name (overrides ResourceContext) */
  resource?: string;
  /** Child components, typically DigitDatagrid */
  children: React.ReactNode;
  /** Show a Create button */
  hasCreate?: boolean;
  /** Callback when Create button is clicked */
  onCreate?: () => void;
  /** Additional action buttons rendered next to Refresh */
  actions?: React.ReactNode;
  /** Default sort */
  sort?: SortPayload;
  /** Records per page */
  perPage?: number;
  /** Permanent filter */
  filter?: FilterPayload;
  /** Enable column configurability popover */
  configurable?: boolean;
  /** Column definitions for the configurability popover */
  columns?: DigitColumn[];
  /** Column sources that cannot be hidden */
  alwaysVisibleSources?: string[];
  /** Custom localStorage key for column preferences */
  preferenceKey?: string;
  /** Filter input elements (react-admin style) */
  filters?: FilterElement[];
  /**
   * Drop records this screen must never show, e.g. a notification integration
   * on a channel we cannot deliver on. Unlike `filter` (a query the fetcher
   * runs) this is a client-side rule applied to the fetched page, so the count
   * badge is corrected by the number of records dropped FROM THAT PAGE — exact
   * for a list that fits on one page, an approximation beyond it. Use it for
   * rows that are never legitimate here, not as a substitute for a real filter.
   */
  recordFilter?: (record: RaRecord) => boolean;
}

export function DigitList({
  title,
  subtitle,
  resource,
  children,
  hasCreate = false,
  onCreate,
  actions,
  sort,
  perPage = 10,
  filter,
  configurable = false,
  columns,
  alwaysVisibleSources,
  preferenceKey,
  filters,
  recordFilter,
}: DigitListProps) {
  const [searchValue, setSearchValue] = useState('');
  const navigate = useNavigate();
  const location = useLocation();
  const translate = useTranslate();

  const controllerProps: ListControllerProps = {
    resource,
    sort,
    perPage,
    filter,
    disableSyncWithLocation: true,
  };

  const rawContext = useListController(controllerProps);

  // What the screen actually shows. Built once here (rather than inside the
  // datagrid) so the count badge, the empty state and the rows all agree.
  const listContext = useMemo(() => {
    const fetched: RaRecord[] | undefined = rawContext.data;
    const total: number | undefined = rawContext.total;
    if (!recordFilter || !fetched) return rawContext;
    const kept = fetched.filter(recordFilter);
    const dropped = fetched.length - kept.length;
    if (dropped === 0) return rawContext;
    // `ListControllerResult` is a discriminated union (loading / error / success),
    // and spreading it loses the discriminant; the values themselves are exactly
    // the ones the controller produced, minus the records we dropped.
    return {
      ...rawContext,
      data: kept,
      total: total != null ? Math.max(0, total - dropped) : total,
    } as typeof rawContext;
  }, [rawContext, recordFilter]);

  const columnConfig =
    configurable && columns
      ? useColumnConfig({
          resource: resource || '',
          columns,
          alwaysVisibleSources,
          preferenceKey,
        })
      : null;

  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setSearchValue(value);
      listContext.setFilters(
        { ...listContext.filterValues, q: value },
        undefined,
        true
      );
    },
    [listContext]
  );

  const handleRefresh = useCallback(() => {
    listContext.refetch();
  }, [listContext]);

  return (
    <ListContextProvider value={listContext}>
      <div className="space-y-4">
        {/* Title bar. The subtitle sits BELOW the title rather than beside it:
            on a wide title with several actions ("Notification Providers" plus
            Sync / Add / Refresh at 1280px) an inline subtitle squeezed the
            heading into two lines and left the mono text wedged against the
            buttons. Stacked, the heading keeps the full row width to itself. */}
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl sm:text-3xl font-bold font-condensed text-foreground">
                {translate(title, { _: title })}
              </h1>
              {listContext.total != null && (
                <Badge variant="secondary" className="text-xs">
                  {listContext.total}
                </Badge>
              )}
            </div>
            {subtitle && (
              <p className="mt-1 text-xs text-muted-foreground font-mono">
                {subtitle}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {actions}
            {columnConfig && (
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-1.5">
                    <Settings2 className="w-4 h-4" />
                    {translate('app.list.columns', { _: 'Columns' })}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-56">
                  <div className="space-y-1">
                    <p className="text-sm font-medium mb-2">{translate('app.list.show_columns', { _: 'Show columns' })}</p>
                    {columns!.map((col) => (
                      <label
                        key={col.source}
                        className="flex items-center gap-2 text-sm py-1 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={!columnConfig.isColumnHidden(col.source)}
                          onChange={() => columnConfig.toggleColumn(col.source)}
                          disabled={alwaysVisibleSources?.includes(col.source)}
                          className="rounded"
                        />
                        {translate(col.label, { _: col.label })}
                      </label>
                    ))}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={columnConfig.resetColumns}
                      className="w-full mt-2"
                    >
                      {translate('app.list.reset', { _: 'Reset' })}
                    </Button>
                  </div>
                </PopoverContent>
              </Popover>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefresh}
              disabled={listContext.isFetching}
              className="gap-1.5"
            >
              <RefreshCw
                className={`w-4 h-4 ${listContext.isFetching ? 'animate-spin' : ''}`}
              />
              {translate('app.list.refresh', { _: 'Refresh' })}
            </Button>
            {hasCreate && (
              <Button size="sm" onClick={onCreate ?? (() => navigate(`${location.pathname}/create`))} className="gap-1.5">
                <Plus className="w-4 h-4" />
                {translate('app.list.create', { _: 'Create' })}
              </Button>
            )}
          </div>
        </div>

        {/* Card with search and content */}
        <div className="rounded-lg border bg-card text-card-foreground shadow-sm p-6">
          {/* Filter bar OR built-in search */}
          {filters ? (
            <div className="mb-4">
              <FilterBar filters={filters} />
            </div>
          ) : (
            <div className="mb-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder={translate('app.list.search', { _: 'Search...' })}
                  value={searchValue}
                  onChange={handleSearchChange}
                  className="pl-9 max-w-sm"
                />
              </div>
            </div>
          )}

          {/* Loading state */}
          {listContext.isPending && (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <RefreshCw className="w-5 h-5 animate-spin mr-2" />
              {translate('app.list.loading', { _: 'Loading...' })}
            </div>
          )}

          {/* Error state */}
          {listContext.error && !listContext.isPending && (
            <div className="text-center py-12">
              <p className="text-destructive font-medium">
                {translate('app.list.error_loading', { _: 'Error loading data' })}
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                {listContext.error instanceof Error
                  ? listContext.error.message
                  : translate('app.list.error_unexpected', { _: 'An unexpected error occurred' })}
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={handleRefresh}
                className="mt-3"
              >
                {translate('app.list.try_again', { _: 'Try again' })}
              </Button>
            </div>
          )}

          {/* Content (datagrid) */}
          {!listContext.isPending && !listContext.error && children}

          {/* Empty state */}
          {!listContext.isPending &&
            !listContext.error &&
            listContext.data &&
            listContext.data.length === 0 && (
              <div className="text-center py-12 text-muted-foreground">
                <p className="font-medium">{translate('app.list.no_records', { _: 'No records found' })}</p>
                {searchValue && (
                  <p className="text-sm mt-1">
                    {translate('app.list.adjust_search', { _: 'Try adjusting your search query' })}
                  </p>
                )}
              </div>
            )}
        </div>
      </div>
    </ListContextProvider>
  );
}
