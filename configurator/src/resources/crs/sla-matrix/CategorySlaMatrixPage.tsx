/**
 * Category SLA Matrix — escalation-SLA configurator page.
 *
 * One screen per tenant for managing CRS.CategorySLA + CRS.StateSLA. The
 * underlying scheduler (EscalationScheduler.resolveSlaHours) reads this
 * data directly; the page is the only operator-facing entry point for it.
 *
 * IMPORTANT — category/subcategory are free-text comboboxes with autocomplete
 * from existing rows. This is interim: the planned CRS.CategoryTaxonomy
 * editor (roadmap phase G1) will replace the free-text inputs with a
 * picker bound to the canonical taxonomy. Until then we keep the inputs
 * permissive so operators can backfill values from the BRD or external
 * lists; the bulk-import path enforces the same liberal shape.
 *
 * Save flow is transactional per-row, NOT all-or-nothing — a single
 * failing row leaves the others queued so the operator can fix and retry.
 * Audit-log entries are written AFTER each successful MDMS write (never
 * before), so a half-saved batch still has a faithful audit trail.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../../../App';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Grid3x3,
  Plus,
  Save,
  Undo2,
  Upload,
  Download,
  History,
  Search as SearchIcon,
  MoreVertical,
  AlertTriangle,
  RefreshCw,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import {
  loadCategorySla,
  loadStateSla,
  saveCategoryRow,
  saveStateSla,
  writeAuditEntry,
  loadAuditEntries,
  deactivateCategoryRow,
  CATEGORY_SLA_SCHEMA,
  STATE_SLA_SCHEMA,
  type MatrixRow,
  type AuditEntry,
} from './slaService';
import {
  BRD_STATE_DEFAULTS,
  PATHS,
  STATE_KEYS,
  STATE_LABELS,
  formatCell,
  makeCategoryUid,
  type CellValue,
  type Path,
  type StateDefaults,
  type StateKey,
} from './types';
import { BulkImportDialog } from './BulkImportDialog';
import { TraceBackDialog } from './TraceBackDialog';
import { recordsToCsv } from './csvParser';
import type { MdmsRecord } from '@digit-mcp/data-provider';
import type { CategorySlaRecord } from './types';

type PathFilter = 'all' | Path;

export function CategorySlaMatrixPage() {
  const { state } = useApp();
  const tenantId = state.targetTenant || state.tenant;
  const { toast } = useToast();

  // --- state ---
  const [rows, setRows] = useState<MatrixRow[]>([]);
  const [stateDefaults, setStateDefaults] = useState<StateDefaults>(BRD_STATE_DEFAULTS);
  const [stateDefaultsRecord, setStateDefaultsRecord] = useState<MdmsRecord | undefined>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pathFilter, setPathFilter] = useState<PathFilter>('all');
  const [searchText, setSearchText] = useState('');
  const [showBulkImport, setShowBulkImport] = useState(false);
  const [showTrace, setShowTrace] = useState(false);
  const [showAudit, setShowAudit] = useState(false);
  const [showAddRow, setShowAddRow] = useState(false);
  const [auditEntries, setAuditEntries] = useState<AuditEntry[] | null>(null);
  const [perRowErrors, setPerRowErrors] = useState<Record<string, string>>({});

  const initialRowsRef = useRef<MatrixRow[]>([]);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [matrixRows, sla] = await Promise.all([
        loadCategorySla(tenantId),
        loadStateSla(tenantId),
      ]);
      setRows(matrixRows);
      initialRowsRef.current = matrixRows.map((r) => ({ ...r, slaHoursByState: { ...r.slaHoursByState } }));
      setStateDefaults(sla.defaults);
      setStateDefaultsRecord(sla.record);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load SLA matrix');
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    reload();
  }, [reload]);

  // --- derived ---
  const filteredRows = useMemo(() => {
    const needle = searchText.toLowerCase().trim();
    return rows.filter((r) => {
      if (pathFilter !== 'all' && r.path !== pathFilter) return false;
      if (!needle) return true;
      return (
        r.category.toLowerCase().includes(needle) ||
        r.subcategoryL1.toLowerCase().includes(needle)
      );
    });
  }, [rows, pathFilter, searchText]);

  const pendingCount = useMemo(
    () => rows.filter((r) => r.pending || r.modified).length,
    [rows],
  );

  const categoryAutocomplete = useMemo(
    () => Array.from(new Set(rows.map((r) => r.category).filter(Boolean))).sort(),
    [rows],
  );
  const subcatAutocomplete = useMemo(
    () => Array.from(new Set(rows.map((r) => r.subcategoryL1).filter(Boolean))).sort(),
    [rows],
  );

  // Detect duplicate (path, category, subcategoryL1) tuples across active rows.
  const duplicateUids = useMemo(() => {
    const seen = new Map<string, number>();
    rows.forEach((r) => {
      if (!r.isActive) return;
      const uid = makeCategoryUid(r);
      seen.set(uid, (seen.get(uid) ?? 0) + 1);
    });
    return new Set(Array.from(seen.entries()).filter(([, n]) => n > 1).map(([uid]) => uid));
  }, [rows]);

  // --- row mutations ---
  function patchRow(rowKey: string, patch: Partial<MatrixRow>) {
    setRows((prev) => prev.map((r) => (rowKeyOf(r) === rowKey ? { ...r, ...patch, modified: true } : r)));
  }

  function patchCell(rowKey: string, stateKey: StateKey, value: CellValue) {
    setRows((prev) => prev.map((r) => {
      if (rowKeyOf(r) !== rowKey) return r;
      return {
        ...r,
        modified: true,
        slaHoursByState: { ...r.slaHoursByState, [stateKey]: value },
      };
    }));
  }

  function addRow(partial: { path: Path; category: string; subcategoryL1: string }) {
    const newRow: MatrixRow = {
      ...partial,
      slaHoursByState: {},
      isActive: true,
      uniqueIdentifier: makeCategoryUid(partial),
      pending: true,
      modified: true,
    };
    setRows((prev) => [newRow, ...prev]);
  }

  async function deleteRow(rowKey: string) {
    const row = rows.find((r) => rowKeyOf(r) === rowKey);
    if (!row) return;
    if (row.pending && !row.recordId) {
      // unsaved local row — just drop
      setRows((prev) => prev.filter((r) => rowKeyOf(r) !== rowKey));
      return;
    }
    try {
      const updated = await deactivateCategoryRow(row);
      if (updated) {
        await writeAuditEntry(tenantId, makeAudit(state, 'delete', CATEGORY_SLA_SCHEMA, row.uniqueIdentifier, row, { ...row, isActive: false }, 'soft-delete via deactivation'));
        toast({ title: 'Row deactivated', description: row.uniqueIdentifier });
        reload();
      }
    } catch (err) {
      toast({ title: 'Delete failed', description: err instanceof Error ? err.message : 'unknown', variant: 'destructive' });
    }
  }

  function resetRowToDefaults(rowKey: string) {
    setRows((prev) => prev.map((r) => {
      if (rowKeyOf(r) !== rowKey) return r;
      const cleared: typeof r.slaHoursByState = {};
      STATE_KEYS.forEach((k) => { cleared[k] = null; });
      return { ...r, slaHoursByState: cleared, modified: true };
    }));
  }

  function revertChanges() {
    setRows(initialRowsRef.current.map((r) => ({ ...r, slaHoursByState: { ...r.slaHoursByState }, modified: false, pending: false })));
    setPerRowErrors({});
  }

  // --- save ---
  async function handleSaveAll() {
    if (pendingCount === 0) return;
    const validationErrors: Record<string, string> = {};
    for (const r of rows) {
      if (!r.modified && !r.pending) continue;
      if (!r.path || !r.category.trim() || !r.subcategoryL1.trim()) {
        validationErrors[rowKeyOf(r)] = 'path/category/subcategoryL1 required';
        continue;
      }
      if (duplicateUids.has(makeCategoryUid(r))) {
        validationErrors[rowKeyOf(r)] = 'duplicate (path, category, subcategoryL1)';
        continue;
      }
      for (const k of STATE_KEYS) {
        const v = r.slaHoursByState[k];
        if (v === null || v === undefined) continue;
        if (Array.isArray(v)) {
          if (!(v[0] > 0 && v[1] > 0 && v[0] < v[1] && v[1] < 8760)) {
            validationErrors[rowKeyOf(r)] = `${k}: invalid range`;
          }
        } else if (!(v > 0 && v < 8760)) {
          validationErrors[rowKeyOf(r)] = `${k}: must be 0 < n < 8760`;
        }
      }
    }
    setPerRowErrors(validationErrors);
    if (Object.keys(validationErrors).length > 0) {
      toast({
        title: 'Validation errors',
        description: `${Object.keys(validationErrors).length} row(s) need fixing`,
        variant: 'destructive',
      });
      return;
    }

    setSaving(true);
    let saved = 0;
    let failed = 0;
    try {
      for (const r of rows) {
        if (!r.modified && !r.pending) continue;
        try {
          const before = r.original ? JSON.stringify(r.original.data) : undefined;
          const saved$ = await saveCategoryRow(tenantId, r);
          await writeAuditEntry(
            tenantId,
            makeAudit(
              state,
              r.recordId ? 'update' : 'create',
              CATEGORY_SLA_SCHEMA,
              r.uniqueIdentifier,
              before ? JSON.parse(before) : undefined,
              saved$.data,
            ),
          );
          saved++;
        } catch (err) {
          failed++;
          setPerRowErrors((prev) => ({
            ...prev,
            [rowKeyOf(r)]: err instanceof Error ? err.message : 'save failed',
          }));
        }
      }
    } finally {
      setSaving(false);
    }
    toast({
      title: failed === 0 ? 'Changes saved' : 'Partial save',
      description: `${saved} saved, ${failed} failed`,
      variant: failed === 0 ? 'default' : 'destructive',
    });
    if (saved > 0) reload();
  }

  async function handleSaveStateDefaults(next: StateDefaults) {
    try {
      const before = stateDefaultsRecord ? JSON.stringify(stateDefaultsRecord.data) : undefined;
      const saved$ = await saveStateSla(tenantId, next, stateDefaultsRecord);
      await writeAuditEntry(
        tenantId,
        makeAudit(state, stateDefaultsRecord ? 'update' : 'create', STATE_SLA_SCHEMA, 'default', before ? JSON.parse(before) : undefined, saved$.data),
      );
      setStateDefaults(next);
      setStateDefaultsRecord(saved$);
      toast({ title: 'Defaults saved' });
    } catch (err) {
      toast({ title: 'Save failed', description: err instanceof Error ? err.message : 'unknown', variant: 'destructive' });
    }
  }

  // --- bulk import ---
  async function handleBulkImport(records: CategorySlaRecord[], filename: string) {
    let imported = 0;
    let failed = 0;
    for (const rec of records) {
      try {
        const uid = makeCategoryUid(rec);
        const existing = rows.find((r) => r.uniqueIdentifier === uid && r.original);
        const row: MatrixRow = existing
          ? { ...existing, ...rec, slaHoursByState: rec.slaHoursByState, modified: true }
          : { ...rec, uniqueIdentifier: uid, pending: true, modified: true };
        await saveCategoryRow(tenantId, row);
        imported++;
      } catch (err) {
        failed++;
        // eslint-disable-next-line no-console
        console.warn('[SLA matrix] bulk import row failed', rec, err);
      }
    }
    // Summary audit entry — one per import.
    await writeAuditEntry(
      tenantId,
      makeAudit(state, 'bulk-import', CATEGORY_SLA_SCHEMA, filename, undefined, undefined, `${imported} rows imported, ${failed} failed`),
    );
    toast({
      title: failed === 0 ? `Imported ${imported} rows` : 'Partial import',
      description: failed > 0 ? `${imported} ok, ${failed} failed` : undefined,
      variant: failed === 0 ? 'default' : 'destructive',
    });
    reload();
  }

  // --- export ---
  function handleExportCsv() {
    const csv = recordsToCsv(rows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `category-sla-${tenantId}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function handleOpenAudit() {
    setShowAudit(true);
    setAuditEntries(null);
    try {
      const entries = await loadAuditEntries(tenantId, 50);
      setAuditEntries(entries);
    } catch (err) {
      toast({ title: 'Audit load failed', description: err instanceof Error ? err.message : 'unknown', variant: 'destructive' });
    }
  }

  // --- render ---
  return (
    <div className="space-y-4">
      {/* Header */}
      <header className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-condensed font-bold tracking-tight flex items-center gap-2">
            <Grid3x3 className="w-6 h-6 text-primary" />
            Category SLA Matrix
          </h1>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Per (Path, Category, Subcategory) SLA targets used by the escalation scheduler.
            Empty cells fall back to per-state defaults from CRS.StateSLA.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowTrace(true)}>
            <SearchIcon className="w-4 h-4 mr-1.5" />
            Trace escalation…
          </Button>
        </div>
      </header>

      {/* Toolbar */}
      <div className="rounded-md border border-border bg-card p-3 flex flex-wrap items-center gap-2">
        {/* Path filter */}
        <div className="inline-flex rounded-md border border-border bg-background overflow-hidden">
          {(['all', ...PATHS] as PathFilter[]).map((p) => (
            <button
              key={p}
              onClick={() => setPathFilter(p)}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                pathFilter === p ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              {p === 'all' ? 'All' : p}
            </button>
          ))}
        </div>

        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="Filter by category or subcategory…"
            className="h-8 pl-8 text-xs"
          />
        </div>

        <Button variant="outline" size="sm" onClick={() => setShowBulkImport(true)}>
          <Upload className="w-3.5 h-3.5 mr-1.5" />
          Bulk import…
        </Button>
        <Button variant="outline" size="sm" onClick={() => setShowAddRow(true)}>
          <Plus className="w-3.5 h-3.5 mr-1.5" />
          Add row
        </Button>
        <Button variant="outline" size="sm" onClick={handleExportCsv}>
          <Download className="w-3.5 h-3.5 mr-1.5" />
          Export CSV
        </Button>
        <Button variant="outline" size="sm" onClick={reload} disabled={loading}>
          <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
          Reload
        </Button>

        <div className="flex-1" />

        {pendingCount > 0 && (
          <Badge variant="outline" className="bg-amber-50 border-amber-200 text-amber-900">
            {pendingCount} pending
          </Badge>
        )}
        <Button variant="outline" size="sm" onClick={revertChanges} disabled={pendingCount === 0}>
          <Undo2 className="w-3.5 h-3.5 mr-1.5" />
          Revert
        </Button>
        <Button size="sm" onClick={handleSaveAll} disabled={pendingCount === 0 || saving}>
          <Save className="w-3.5 h-3.5 mr-1.5" />
          {saving ? 'Saving…' : 'Save changes'}
        </Button>

        <Button variant="ghost" size="sm" onClick={handleOpenAudit}>
          <History className="w-3.5 h-3.5 mr-1.5" />
          Audit log
        </Button>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="w-4 h-4" />
          <AlertTitle>Couldn't load matrix</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Defaults row */}
      <StateDefaultsRow defaults={stateDefaults} onSave={handleSaveStateDefaults} />

      {/* Matrix */}
      <div className="rounded-md border border-border bg-card overflow-hidden">
        <div className="overflow-auto max-h-[60vh]">
          <table className="w-full text-xs border-collapse">
            <thead className="bg-muted/50 sticky top-0 z-10">
              <tr>
                <th className="px-2 py-2 text-left border-b border-border sticky left-0 bg-muted/50 z-20 min-w-[80px]">Path</th>
                <th className="px-2 py-2 text-left border-b border-border sticky left-[80px] bg-muted/50 z-20 min-w-[140px]">Category</th>
                <th className="px-2 py-2 text-left border-b border-border min-w-[180px]">Subcategory L1</th>
                <th className="px-2 py-2 text-center border-b border-border w-16">Active</th>
                {STATE_KEYS.map((k) => (
                  <th key={k} className="px-2 py-2 text-center border-b border-border min-w-[110px]">
                    {STATE_LABELS[k]}
                  </th>
                ))}
                <th className="px-2 py-2 border-b border-border w-10" />
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={11} className="px-3 py-8 text-center text-muted-foreground">Loading…</td>
                </tr>
              )}
              {!loading && filteredRows.length === 0 && (
                <tr>
                  <td colSpan={11} className="px-3 py-12 text-center text-muted-foreground space-y-3">
                    <p className="text-sm">No SLA rows yet for this tenant.</p>
                    <p className="text-xs">
                      Get started with the BRD Appendix A seed, or add a row manually.
                    </p>
                    <Button size="sm" onClick={() => setShowBulkImport(true)}>
                      <Upload className="w-3.5 h-3.5 mr-1.5" />
                      Import from BRD Appendix A
                    </Button>
                  </td>
                </tr>
              )}
              {filteredRows.map((r) => {
                const rk = rowKeyOf(r);
                const rowErr = perRowErrors[rk];
                const isDup = duplicateUids.has(makeCategoryUid(r));
                return (
                  <tr key={rk} className={`border-b border-border ${r.modified ? 'bg-amber-50/30' : ''} ${isDup ? 'bg-red-50/40' : ''}`}>
                    <td className="px-2 py-1.5 sticky left-0 bg-inherit">
                      <select
                        value={r.path}
                        onChange={(e) => patchRow(rk, { path: e.target.value as Path })}
                        className="text-xs h-7 border border-border rounded px-1.5 bg-background"
                      >
                        {PATHS.map((p) => <option key={p} value={p}>{p}</option>)}
                      </select>
                    </td>
                    <td className="px-2 py-1.5 sticky left-[80px] bg-inherit">
                      <Input
                        list="cat-autocomplete"
                        value={r.category}
                        onChange={(e) => patchRow(rk, { category: e.target.value })}
                        className="h-7 text-xs"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <Input
                        list="subcat-autocomplete"
                        value={r.subcategoryL1}
                        onChange={(e) => patchRow(rk, { subcategoryL1: e.target.value })}
                        className="h-7 text-xs"
                      />
                    </td>
                    <td className="px-2 py-1.5 text-center">
                      <input
                        type="checkbox"
                        checked={r.isActive}
                        onChange={(e) => patchRow(rk, { isActive: e.target.checked })}
                      />
                    </td>
                    {STATE_KEYS.map((k) => (
                      <td key={k} className="px-2 py-1.5 text-center">
                        <CellEditor
                          value={r.slaHoursByState[k] ?? null}
                          fallback={stateDefaults[k]}
                          onChange={(v) => patchCell(rk, k, v)}
                        />
                      </td>
                    ))}
                    <td className="px-1 py-1.5 text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-6 w-6">
                            <MoreVertical className="w-3.5 h-3.5" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-44">
                          <DropdownMenuItem onClick={() => resetRowToDefaults(rk)}>
                            Reset cells → defaults
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() => deleteRow(rk)}
                            className="text-destructive"
                          >
                            Delete row
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                      {rowErr && (
                        <p className="text-[10px] text-destructive pr-1 mt-0.5 text-right">{rowErr}</p>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Autocomplete datalists */}
      <datalist id="cat-autocomplete">
        {categoryAutocomplete.map((c) => <option key={c} value={c} />)}
      </datalist>
      <datalist id="subcat-autocomplete">
        {subcatAutocomplete.map((s) => <option key={s} value={s} />)}
      </datalist>

      {/* Modals */}
      <BulkImportDialog open={showBulkImport} onClose={() => setShowBulkImport(false)} onImport={handleBulkImport} />
      <TraceBackDialog open={showTrace} onClose={() => setShowTrace(false)} tenantId={tenantId} rows={rows} stateDefaults={stateDefaults} />
      <AddRowDialog open={showAddRow} onClose={() => setShowAddRow(false)} onAdd={addRow} />
      <AuditDrawer open={showAudit} onClose={() => setShowAudit(false)} entries={auditEntries} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Stable row key — recordId if persisted, otherwise the composed uid. */
function rowKeyOf(r: MatrixRow): string {
  return r.recordId ?? `pending:${r.uniqueIdentifier || `${r.path}:${r.category}:${r.subcategoryL1}`}`;
}

interface AuditMeta {
  user: { uuid?: string; name: string } | null;
}

function makeAudit(
  app: AuditMeta,
  action: AuditEntry['action'],
  schemaCode: string,
  recordIdentifier: string,
  before?: unknown,
  after?: unknown,
  reason?: string,
): AuditEntry {
  return {
    timestamp: Date.now(),
    userUuid: app.user?.uuid ?? 'unknown',
    userName: app.user?.name ?? 'unknown',
    action,
    schemaCode,
    recordIdentifier,
    beforeJson: before ? JSON.stringify(before) : undefined,
    afterJson: after ? JSON.stringify(after) : undefined,
    reason,
  };
}

// ---------------------------------------------------------------------------
// CellEditor — null / number / range, with greyed default hint
// ---------------------------------------------------------------------------
interface CellEditorProps {
  value: CellValue;
  fallback: number;
  onChange: (v: CellValue) => void;
}
function CellEditor({ value, fallback, onChange }: CellEditorProps) {
  const [editing, setEditing] = useState(false);
  const [useRange, setUseRange] = useState(Array.isArray(value));
  const [a, setA] = useState<string>(value === null || value === undefined ? '' : Array.isArray(value) ? String(value[0]) : String(value));
  const [b, setB] = useState<string>(Array.isArray(value) ? String(value[1]) : '');

  useEffect(() => {
    if (editing) return;
    setUseRange(Array.isArray(value));
    setA(value === null || value === undefined ? '' : Array.isArray(value) ? String(value[0]) : String(value));
    setB(Array.isArray(value) ? String(value[1]) : '');
  }, [value, editing]);

  function commit() {
    if (a === '' && (!useRange || b === '')) {
      onChange(null);
    } else if (useRange) {
      const av = Number(a);
      const bv = Number(b);
      if (Number.isFinite(av) && Number.isFinite(bv)) onChange([av, bv]);
    } else {
      const av = Number(a);
      if (Number.isFinite(av)) onChange(av);
    }
    setEditing(false);
  }

  if (!editing) {
    return (
      <button
        onClick={() => setEditing(true)}
        className="w-full text-center hover:bg-muted/50 rounded px-1 py-0.5 transition-colors"
        title={`Default: ${fallback}h`}
      >
        {value === null || value === undefined ? (
          <span className="text-muted-foreground/60 italic">— <span className="text-[10px]">(def {fallback}h)</span></span>
        ) : (
          <span className="font-medium">{formatCell(value)}</span>
        )}
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-1 min-w-[100px]">
      <div className="flex items-center gap-1">
        <input
          type="number"
          value={a}
          onChange={(e) => setA(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
          className="h-6 w-14 text-xs border border-border rounded px-1"
          autoFocus
        />
        {useRange && (
          <>
            <span className="text-muted-foreground">–</span>
            <input
              type="number"
              value={b}
              onChange={(e) => setB(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
              className="h-6 w-14 text-xs border border-border rounded px-1"
            />
          </>
        )}
      </div>
      <label className="flex items-center gap-1 text-[10px] text-muted-foreground">
        <input type="checkbox" checked={useRange} onChange={(e) => setUseRange(e.target.checked)} />
        use range
      </label>
    </div>
  );
}

// ---------------------------------------------------------------------------
// StateDefaultsRow — inline-edit StateSLA singleton
// ---------------------------------------------------------------------------
function StateDefaultsRow({ defaults, onSave }: { defaults: StateDefaults; onSave: (next: StateDefaults) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(defaults);
  useEffect(() => { setDraft(defaults); }, [defaults]);

  return (
    <div className="rounded-md border border-border bg-blue-50/40 p-3 flex items-center gap-3 flex-wrap">
      <Badge variant="outline" className="bg-blue-100 text-blue-900 border-blue-300">Defaults (StateSLA)</Badge>
      <span className="text-xs text-muted-foreground">Fallback when matrix cells are empty</span>
      <div className="flex items-center gap-3 ml-auto">
        {STATE_KEYS.map((k) => (
          <div key={k} className="flex items-center gap-1">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{STATE_LABELS[k]}</span>
            {editing ? (
              <input
                type="number"
                value={draft[k]}
                onChange={(e) => setDraft((d) => ({ ...d, [k]: Number(e.target.value) }))}
                className="h-6 w-14 text-xs border border-border rounded px-1"
              />
            ) : (
              <span className="text-xs font-medium">{defaults[k]}h</span>
            )}
          </div>
        ))}
        {editing ? (
          <>
            <Button size="sm" onClick={async () => { await onSave(draft); setEditing(false); }}>Save defaults</Button>
            <Button size="sm" variant="outline" onClick={() => { setDraft(defaults); setEditing(false); }}>Cancel</Button>
          </>
        ) : (
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>Edit defaults…</Button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AddRowDialog
// ---------------------------------------------------------------------------
function AddRowDialog({ open, onClose, onAdd }: { open: boolean; onClose: () => void; onAdd: (r: { path: Path; category: string; subcategoryL1: string }) => void }) {
  const [path, setPath] = useState<Path>('IGE');
  const [category, setCategory] = useState('');
  const [subcategoryL1, setSubcategoryL1] = useState('');
  function handleAdd() {
    if (!category.trim() || !subcategoryL1.trim()) return;
    onAdd({ path, category: category.trim(), subcategoryL1: subcategoryL1.trim() });
    setCategory('');
    setSubcategoryL1('');
    onClose();
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add SLA row</DialogTitle>
          <DialogDescription>Adds a draft row at the top of the matrix. Fill cells then Save changes.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs font-medium">Path</label>
            <select value={path} onChange={(e) => setPath(e.target.value as Path)} className="h-8 w-full text-xs border border-border rounded px-2">
              {PATHS.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium">Category</label>
            <Input value={category} onChange={(e) => setCategory(e.target.value)} className="h-8 text-xs" />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium">Subcategory L1</label>
            <Input value={subcategoryL1} onChange={(e) => setSubcategoryL1(e.target.value)} className="h-8 text-xs" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={handleAdd} disabled={!category.trim() || !subcategoryL1.trim()}>Add row</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// AuditDrawer
// ---------------------------------------------------------------------------
function AuditDrawer({ open, onClose, entries }: { open: boolean; onClose: () => void; entries: AuditEntry[] | null }) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>SLA audit log</DialogTitle>
          <DialogDescription>Last 50 changes to CRS.CategorySLA and CRS.StateSLA.</DialogDescription>
        </DialogHeader>
        <div className="overflow-auto flex-1">
          {entries === null && <p className="text-sm text-muted-foreground text-center py-8">Loading…</p>}
          {entries && entries.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">No audit entries yet.</p>}
          {entries && entries.length > 0 && (
            <table className="w-full text-xs">
              <thead className="bg-muted">
                <tr>
                  <th className="px-2 py-2 text-left">When</th>
                  <th className="px-2 py-2 text-left">User</th>
                  <th className="px-2 py-2 text-left">Action</th>
                  <th className="px-2 py-2 text-left">Schema</th>
                  <th className="px-2 py-2 text-left">Record</th>
                  <th className="px-2 py-2 text-left">Reason</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={`${e.timestamp}:${e.userUuid}:${e.recordIdentifier}`} className="border-t border-border">
                    <td className="px-2 py-1.5 text-muted-foreground">{new Date(e.timestamp).toLocaleString()}</td>
                    <td className="px-2 py-1.5">{e.userName}</td>
                    <td className="px-2 py-1.5"><Badge variant="outline">{e.action}</Badge></td>
                    <td className="px-2 py-1.5 font-mono text-[10px]">{e.schemaCode}</td>
                    <td className="px-2 py-1.5 font-mono text-[10px]">{e.recordIdentifier}</td>
                    <td className="px-2 py-1.5 text-muted-foreground">{e.reason ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
