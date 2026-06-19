import { useState } from 'react';
import { useGetList, useTranslate } from 'ra-core';
import { RefreshCw, ChevronRight, ChevronDown, Search } from 'lucide-react';
import { DigitCard } from '@/components/digit/DigitCard';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { groupComplaintTypes, type SubTypeRecord } from './groupComplaintTypes';
import { filterComplaintTypeGroups } from './filterComplaintTypeGroups';
import { SubTypeTable } from './SubTypeTable';

const GRID = 'grid grid-cols-[28px_1fr_120px_120px] gap-2';

export function ComplaintTypeList() {
  const translate = useTranslate();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');

  const { data, isPending, isFetching, error, refetch } = useGetList(
    'complaint-types',
    {
      pagination: { page: 1, perPage: 1000 },
      sort: { field: 'serviceCode', order: 'ASC' },
    },
  );

  const allGroups = groupComplaintTypes(
    (data ?? []) as unknown as SubTypeRecord[],
    translate,
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
                    <span
                      className={`min-w-0 break-words font-semibold ${
                        g.isUncategorized ? 'text-muted-foreground' : ''
                      }`}
                    >
                      {g.label}
                    </span>
                    <span className="tabular-nums">{g.count}</span>
                    <span>
                      <Badge
                        variant="outline"
                        className="text-xs bg-green-100 text-green-800 border-green-200"
                      >
                        {g.activeCount} active
                      </Badge>
                    </span>
                  </div>
                  {isOpen && (
                    <div className="bg-muted/20 border-b border-border px-3 py-2 pl-10">
                      <SubTypeTable subTypes={g.subTypes} />
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
