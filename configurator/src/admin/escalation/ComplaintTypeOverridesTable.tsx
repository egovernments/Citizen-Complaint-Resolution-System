import { useState, useMemo } from 'react';
import {
  Search,
  Filter,
  Settings,
  Edit2,
  AlertCircle,
  Trash2,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type {
  CatalogueItem,
  StatusFilter,
} from './escalationPolicyTypes';

interface ComplaintTypeOverridesTableProps {
  catalogue: CatalogueItem[];
  orphanedOverrides: CatalogueItem[];
  defaultPcts: number[];
  readOnly?: boolean;
  onEditItem: (item: CatalogueItem) => void;
  onRemoveOverride: (serviceCode: string) => void;
  onBulkApply: (codes: string[]) => void;
}

type SortField = 'name' | 'department' | 'slaHours' | 'source';
type SortOrder = 'ASC' | 'DESC';

export function ComplaintTypeOverridesTable({
  catalogue,
  orphanedOverrides,
  defaultPcts,
  readOnly = false,
  onEditItem,
  onRemoveOverride,
  onBulkApply,
}: ComplaintTypeOverridesTableProps) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [departmentFilter, setDepartmentFilter] = useState<string>('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [selectedCodes, setSelectedCodes] = useState<Set<string>>(new Set());
  const [sortField, setSortField] = useState<SortField | null>(null);
  const [sortOrder, setSortOrder] = useState<SortOrder>('ASC');

  const handleSort = (field: SortField) => {
    setPage(1);
    if (sortField !== field) {
      setSortField(field);
      setSortOrder('ASC');
    } else if (sortOrder === 'ASC') {
      setSortOrder('DESC');
    } else {
      // Third click: reset to default/neutral state
      setSortField(null);
      setSortOrder('ASC');
    }
  };

  // Derive unique departments from catalogue
  const departments = useMemo(() => {
    const depts = new Set<string>();
    for (const item of catalogue) {
      if (item.department && item.department !== '—') {
        depts.add(item.department);
      }
    }
    return Array.from(depts).sort();
  }, [catalogue]);

  // Counts for statistics banner
  const stats = useMemo(() => {
    const total = catalogue.length;
    let overridden = 0;
    let usingDefault = 0;

    for (const item of catalogue) {
      if (item.override) overridden++;
      else usingDefault++;
    }

    return {
      total,
      overridden,
      usingDefault,
      orphaned: orphanedOverrides.length,
    };
  }, [catalogue, orphanedOverrides]);

  // Filter catalogue
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();

    return catalogue.filter((item) => {
      // Status filter
      if (statusFilter === 'override' && !item.override) return false;
      if (statusFilter === 'default' && item.override) return false;
      if (statusFilter === 'disabled') {
        if (!item.override || item.override.enabledByLevel.some((en) => en)) return false;
      }
      if (statusFilter === 'orphaned') return false; // Handled in orphaned section

      // Department filter
      if (departmentFilter !== 'all' && item.department !== departmentFilter) {
        return false;
      }

      // Search filter
      if (q) {
        const matchName = item.name.toLowerCase().includes(q);
        const matchCode = item.code.toLowerCase().includes(q);
        const matchPath = item.path.toLowerCase().includes(q);
        const matchDept = item.department.toLowerCase().includes(q);
        if (!matchName && !matchCode && !matchPath && !matchDept) return false;
      }

      return true;
    });
  }, [catalogue, search, statusFilter, departmentFilter]);

  // Sort catalogue
  const sorted = useMemo(() => {
    if (!sortField) return filtered;

    return [...filtered].sort((a, b) => {
      let cmp = 0;
      if (sortField === 'name') {
        cmp = a.name.localeCompare(b.name);
      } else if (sortField === 'department') {
        cmp = (a.department || '').localeCompare(b.department || '');
      } else if (sortField === 'slaHours') {
        const aSla = a.slaHours || 0;
        const bSla = b.slaHours || 0;
        // Push 0/missing SLA to bottom on ASC
        if (aSla === 0 && bSla !== 0) return 1;
        if (bSla === 0 && aSla !== 0) return -1;
        cmp = aSla - bSla;
      } else if (sortField === 'source') {
        const aSource = a.override ? 1 : 0;
        const bSource = b.override ? 1 : 0;
        cmp = aSource - bSource;
      }
      return sortOrder === 'ASC' ? cmp : -cmp;
    });
  }, [filtered, sortField, sortOrder]);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const startRecord = sorted.length > 0 ? (page - 1) * pageSize + 1 : 0;
  const endRecord = Math.min(page * pageSize, sorted.length);

  const paginatedItems = useMemo(() => {
    const start = (page - 1) * pageSize;
    return sorted.slice(start, start + pageSize);
  }, [sorted, page, pageSize]);

  // Toggle single item selection
  const toggleSelect = (code: string) => {
    const next = new Set(selectedCodes);
    if (next.has(code)) next.delete(code);
    else next.add(code);
    setSelectedCodes(next);
  };

  // Toggle select all on current page (unconfigured items only)
  const toggleSelectAllPage = () => {
    const unconfiguredOnPage = paginatedItems.filter((i) => !i.override).map((i) => i.code);
    const allSelected = unconfiguredOnPage.every((c) => selectedCodes.has(c));

    const next = new Set(selectedCodes);
    if (allSelected) {
      for (const c of unconfiguredOnPage) next.delete(c);
    } else {
      for (const c of unconfiguredOnPage) next.add(c);
    }
    setSelectedCodes(next);
  };

  const isAllPageSelected =
    paginatedItems.filter((i) => !i.override).length > 0 &&
    paginatedItems.filter((i) => !i.override).every((c) => selectedCodes.has(c.code));

  return (
    <div className="space-y-4">
      {/* Statistics Banner */}
      <div className="flex flex-wrap items-center justify-between gap-4 p-3 bg-muted/40 border border-border rounded-lg text-xs">
        <div className="flex items-center gap-4">
          <span className="font-semibold text-foreground">
            {stats.total} complaint types
          </span>
          <span className="text-muted-foreground">•</span>
          <span className="text-primary font-medium">{stats.overridden} overridden</span>
          <span className="text-muted-foreground">•</span>
          <span>{stats.usingDefault} using default</span>
          {stats.orphaned > 0 && (
            <>
              <span className="text-muted-foreground">•</span>
              <span className="text-destructive font-medium">{stats.orphaned} orphaned</span>
            </>
          )}
        </div>

        {!readOnly && selectedCodes.size > 0 && (
          <div className="flex items-center gap-2">
            <span className="font-medium text-foreground">
              {selectedCodes.size} selected
            </span>
            <Button
              size="sm"
              variant="default"
              onClick={() => {
                onBulkApply(Array.from(selectedCodes));
                setSelectedCodes(new Set());
              }}
              className="gap-1.5 h-8 text-xs"
            >
              <Settings className="w-3.5 h-3.5" /> Configure selected together
            </Button>
          </div>
        )}
      </div>

      {/* Filter Toolbar */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-3 text-muted-foreground" />
          <Input
            placeholder="Search name, service code, or hierarchy path…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="pl-9 h-10"
          />
        </div>

        <div className="flex items-center gap-2">
          <Select
            value={statusFilter}
            onValueChange={(v) => {
              setStatusFilter(v as StatusFilter);
              setPage(1);
            }}
          >
            <SelectTrigger className="w-40 h-10 text-xs">
              <Filter className="w-3.5 h-3.5 mr-1 text-muted-foreground" />
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="override">Overridden</SelectItem>
              <SelectItem value="default">Uses default</SelectItem>
              <SelectItem value="disabled">Automatic off</SelectItem>
            </SelectContent>
          </Select>

          {departments.length > 0 && (
            <Select
              value={departmentFilter}
              onValueChange={(v) => {
                setDepartmentFilter(v);
                setPage(1);
              }}
            >
              <SelectTrigger className="w-44 h-10 text-xs">
                <SelectValue placeholder="Department" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All departments</SelectItem>
                {departments.map((dept) => (
                  <SelectItem key={dept} value={dept}>
                    {dept}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {(search || statusFilter !== 'all' || departmentFilter !== 'all') && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearch('');
                setStatusFilter('all');
                setDepartmentFilter('all');
                setPage(1);
              }}
              className="text-xs h-10"
            >
              Clear
            </Button>
          )}
        </div>
      </div>

      {/* Catalogue Table */}
      <div className="rounded-md border border-border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              {!readOnly && (
                <TableHead className="w-10">
                  <input
                    type="checkbox"
                    checked={isAllPageSelected}
                    onChange={toggleSelectAllPage}
                    className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                    title="Select all unconfigured on this page"
                  />
                </TableHead>
              )}
              <TableHead className="min-w-[240px]">
                <button
                  type="button"
                  onClick={() => handleSort('name')}
                  className="flex items-center gap-1 font-medium text-muted-foreground hover:text-foreground transition-colors"
                >
                  Complaint Type & Hierarchy Path
                  {sortField === 'name' ? (
                    sortOrder === 'ASC' ? (
                      <ArrowUp className="w-3.5 h-3.5 text-foreground" />
                    ) : (
                      <ArrowDown className="w-3.5 h-3.5 text-foreground" />
                    )
                  ) : (
                    <ArrowUpDown className="w-3.5 h-3.5 opacity-40" />
                  )}
                </button>
              </TableHead>
              <TableHead className="w-36">
                <button
                  type="button"
                  onClick={() => handleSort('department')}
                  className="flex items-center gap-1 font-medium text-muted-foreground hover:text-foreground transition-colors"
                >
                  Department
                  {sortField === 'department' ? (
                    sortOrder === 'ASC' ? (
                      <ArrowUp className="w-3.5 h-3.5 text-foreground" />
                    ) : (
                      <ArrowDown className="w-3.5 h-3.5 text-foreground" />
                    )
                  ) : (
                    <ArrowUpDown className="w-3.5 h-3.5 opacity-40" />
                  )}
                </button>
              </TableHead>
              <TableHead className="w-28">
                <button
                  type="button"
                  onClick={() => handleSort('slaHours')}
                  className="flex items-center gap-1 font-medium text-muted-foreground hover:text-foreground transition-colors"
                >
                  Base SLA
                  {sortField === 'slaHours' ? (
                    sortOrder === 'ASC' ? (
                      <ArrowUp className="w-3.5 h-3.5 text-foreground" />
                    ) : (
                      <ArrowDown className="w-3.5 h-3.5 text-foreground" />
                    )
                  ) : (
                    <ArrowUpDown className="w-3.5 h-3.5 opacity-40" />
                  )}
                </button>
              </TableHead>
              <TableHead className="w-48">Effective Levels</TableHead>
              <TableHead className="w-28">
                <button
                  type="button"
                  onClick={() => handleSort('source')}
                  className="flex items-center gap-1 font-medium text-muted-foreground hover:text-foreground transition-colors"
                >
                  Source
                  {sortField === 'source' ? (
                    sortOrder === 'ASC' ? (
                      <ArrowUp className="w-3.5 h-3.5 text-foreground" />
                    ) : (
                      <ArrowDown className="w-3.5 h-3.5 text-foreground" />
                    )
                  ) : (
                    <ArrowUpDown className="w-3.5 h-3.5 opacity-40" />
                  )}
                </button>
              </TableHead>
              <TableHead className="w-24 text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paginatedItems.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={readOnly ? 6 : 7}
                  className="h-32 text-center text-muted-foreground"
                >
                  No complaint types match the selected filters.
                </TableCell>
              </TableRow>
            ) : (
              paginatedItems.map((item) => {
                const isOverridden = !!item.override;
                const isAutoOff =
                  isOverridden && item.override?.enabledByLevel.every((en) => !en);

                const effectivePcts = isOverridden
                  ? item.override!.slaPercentageByLevel
                  : defaultPcts;

                return (
                  <TableRow key={item.code}>
                    {!readOnly && (
                      <TableCell>
                        {!isOverridden ? (
                          <input
                            type="checkbox"
                            checked={selectedCodes.has(item.code)}
                            onChange={() => toggleSelect(item.code)}
                            className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                          />
                        ) : null}
                      </TableCell>
                    )}
                    <TableCell>
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-foreground">{item.name}</span>
                          <span className="font-mono text-xs text-muted-foreground bg-muted/60 px-1 py-0.2 rounded">
                            {item.code}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground truncate max-w-md">
                          {item.path}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {item.department || '—'}
                    </TableCell>
                    <TableCell className="text-xs font-semibold text-foreground">
                      {item.slaHours > 0 ? `${item.slaHours}h` : '—'}
                    </TableCell>
                    <TableCell className="text-xs font-mono">
                      {effectivePcts.map((p) => `${p}%`).join(' · ')}
                    </TableCell>
                    <TableCell>
                      {isAutoOff ? (
                        <Badge variant="outline" className="text-amber-600 border-amber-500/40">
                          Auto Off
                        </Badge>
                      ) : isOverridden ? (
                        <Badge variant="default">Override</Badge>
                      ) : (
                        <Badge variant="secondary">Default</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant={isOverridden ? 'outline' : 'ghost'}
                        size="sm"
                        disabled={readOnly}
                        onClick={() => onEditItem(item)}
                        className="h-8 gap-1 text-xs"
                      >
                        {isOverridden ? (
                          <>
                            <Edit2 className="w-3.5 h-3.5" /> Edit
                          </>
                        ) : (
                          <>
                            <Settings className="w-3.5 h-3.5" /> Set
                          </>
                        )}
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination Footer matching DigitDatagrid and Complaints page */}
      {sorted.length > 0 && (
        <div className="flex items-center justify-between pt-4 border-t border-border mt-2">
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <span>
              Showing {startRecord}-{endRecord} of {sorted.length}
            </span>
            <div className="flex items-center gap-1.5">
              <span>Rows per page:</span>
              <Select
                value={String(pageSize)}
                onValueChange={(val) => {
                  setPageSize(Number(val));
                  setPage(1);
                }}
              >
                <SelectTrigger className="h-8 w-20 text-xs font-mono">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="10">10</SelectItem>
                  <SelectItem value="25">25</SelectItem>
                  <SelectItem value="50">50</SelectItem>
                  <SelectItem value="100">100</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="gap-1 text-xs h-8"
            >
              <ChevronLeft className="w-3.5 h-3.5" /> Previous
            </Button>
            <span className="text-sm text-muted-foreground px-2">
              Page {page} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="gap-1 text-xs h-8"
            >
              Next <ChevronRight className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      )}

      {/* Orphaned Overrides Warning Section */}
      {orphanedOverrides.length > 0 && (
        <div className="border border-destructive/40 bg-destructive/5 rounded-lg p-4 space-y-3 mt-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-destructive font-semibold text-sm">
              <AlertCircle className="w-4 h-4" />
              <span>Orphaned Overrides ({orphanedOverrides.length})</span>
            </div>
            <p className="text-xs text-muted-foreground">
              These overrides exist in policy data but their complaint type is no longer active in
              the hierarchy. They are preserved unless explicitly removed.
            </p>
          </div>

          <div className="rounded border border-border bg-background overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead>Service Code</TableHead>
                  <TableHead>Configured Ladder</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orphanedOverrides.map((item) => (
                  <TableRow key={item.code}>
                    <TableCell className="font-mono text-xs font-semibold">
                      {item.code}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {item.override?.slaPercentageByLevel.map((p) => `${p}%`).join(' · ')}
                    </TableCell>
                    <TableCell className="text-right">
                      {!readOnly && (
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => onEditItem(item)}
                            className="h-7 text-xs"
                          >
                            Edit
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => onRemoveOverride(item.code)}
                            className="h-7 text-xs text-destructive hover:text-destructive gap-1"
                          >
                            <Trash2 className="w-3.5 h-3.5" /> Remove
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </div>
  );
}
