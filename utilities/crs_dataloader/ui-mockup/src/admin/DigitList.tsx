import React, { useState, useCallback } from 'react';
import {
  useListController,
  ListContextProvider,
  type ListControllerProps,
  type SortPayload,
  type FilterPayload,
} from 'ra-core';
import { useNavigate, useLocation } from 'react-router-dom';
import { RefreshCw, Plus, Search } from 'lucide-react';
import { DigitCard } from '@/components/digit/DigitCard';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

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
}: DigitListProps) {
  const [searchValue, setSearchValue] = useState('');
  const navigate = useNavigate();
  const location = useLocation();

  const controllerProps: ListControllerProps = {
    resource,
    sort,
    perPage,
    filter,
    disableSyncWithLocation: true,
  };

  const listContext = useListController(controllerProps);

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
              <span className="text-xs text-muted-foreground font-mono">{subtitle}</span>
            )}
            {listContext.total != null && (
              <Badge variant="secondary" className="text-xs">
                {listContext.total}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            {actions}
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
              <Button size="sm" onClick={onCreate ?? (() => navigate(`${location.pathname}/create`))} className="gap-1.5">
                <Plus className="w-4 h-4" />
                Create
              </Button>
            )}
          </div>
        </div>

        {/* Card with search and content */}
        <DigitCard className="max-w-none">
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
        </DigitCard>
      </div>
    </ListContextProvider>
  );
}
