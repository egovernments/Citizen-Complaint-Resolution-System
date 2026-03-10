import React, { useState, useCallback } from 'react';
import {
  useListController,
  ListContextProvider,
  type ListControllerProps,
  type SortPayload,
  type FilterPayload,
} from 'ra-core';
import { RefreshCw, Plus, Search, Settings2 } from 'lucide-react';
import { Badge } from './primitives/badge';
import { Button } from './primitives/button';
import { Input } from './primitives/input';
import { Popover, PopoverTrigger, PopoverContent } from './primitives/popover';
import { useColumnConfig } from './editing/useColumnConfig';
import type { DigitColumn } from './columns/types';

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
  perPage = 25,
  filter,
  configurable = false,
  columns,
  alwaysVisibleSources,
  preferenceKey,
}: DigitListProps) {
  const [searchValue, setSearchValue] = useState('');

  const controllerProps: ListControllerProps = {
    resource,
    sort,
    perPage,
    filter,
    disableSyncWithLocation: true,
  };

  const listContext = useListController(controllerProps);

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
        {/* Title bar */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl sm:text-3xl font-bold font-condensed text-foreground">
              {title}
            </h1>
            {subtitle && (
              <span className="text-xs text-muted-foreground font-mono">
                {subtitle}
              </span>
            )}
            {listContext.total != null && (
              <Badge variant="secondary" className="text-xs">
                {listContext.total}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            {actions}
            {columnConfig && (
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-1.5">
                    <Settings2 className="w-4 h-4" />
                    Columns
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-56">
                  <div className="space-y-1">
                    <p className="text-sm font-medium mb-2">Show columns</p>
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
                        {col.label}
                      </label>
                    ))}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={columnConfig.resetColumns}
                      className="w-full mt-2"
                    >
                      Reset
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
              Refresh
            </Button>
            {hasCreate && (
              <Button size="sm" onClick={onCreate} className="gap-1.5">
                <Plus className="w-4 h-4" />
                Create
              </Button>
            )}
          </div>
        </div>

        {/* Card with search and content */}
        <div className="rounded-lg border bg-card text-card-foreground shadow-sm p-6">
          {/* Search input */}
          <div className="mb-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search..."
                value={searchValue}
                onChange={handleSearchChange}
                className="pl-9 max-w-sm"
              />
            </div>
          </div>

          {/* Loading state */}
          {listContext.isPending && (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <RefreshCw className="w-5 h-5 animate-spin mr-2" />
              Loading...
            </div>
          )}

          {/* Error state */}
          {listContext.error && !listContext.isPending && (
            <div className="text-center py-12">
              <p className="text-destructive font-medium">
                Error loading data
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                {listContext.error instanceof Error
                  ? listContext.error.message
                  : 'An unexpected error occurred'}
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={handleRefresh}
                className="mt-3"
              >
                Try again
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
                <p className="font-medium">No records found</p>
                {searchValue && (
                  <p className="text-sm mt-1">
                    Try adjusting your search query
                  </p>
                )}
              </div>
            )}
        </div>
      </div>
    </ListContextProvider>
  );
}
