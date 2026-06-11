/**
 * Card 3 — "Complaint-status mapping": the CRS.WorkflowStateMapping form.
 *
 * The mapping is the cascade's gate: without it the scheduler skips every
 * per-state SLA source (matrix cells + the defaults row). The table edits
 * a local draft of (status name → SLA column) rows; the object map only
 * materialises on save, so duplicate names get caught with inline errors
 * here instead of collapsing silently in Record<string, StateKey>.
 *
 * "Add standard complaint statuses" merges standardStateMappings.ts
 * non-destructively — rows the operator already has win.
 */
import { useMemo, useState } from 'react';
import { GitBranch, Plus, ListPlus, Save, Undo2, X, AlertTriangle } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import type { MdmsRecord } from '@digit-mcp/data-provider';
import type { StateKey } from '../sla-matrix/types';
import { STATE_KEYS } from '../sla-matrix/types';
import { STANDARD_STATE_MAPPINGS } from '../sla-matrix/standardStateMappings';
import type { WorkflowStateMapping } from '../sla-matrix/escalationTypes';
import {
  loadWorkflowStateMapping,
  saveWorkflowStateMapping,
  verifyAfterWrite,
  type AuditActor,
} from '../sla-matrix/slaService';

/** Operator-facing labels for the six SLA columns. */
const KEY_LABELS: Record<StateKey, string> = {
  new: 'New',
  triage: 'Triage',
  forwarded: 'Forwarded',
  investigation: 'Investigation',
  awaiting: 'Awaiting info',
  resolved: 'Resolved',
};

interface StateMappingCardProps {
  tenantId: string;
  actor: AuditActor;
  /**
   * The card owns its draft after mount — the page remounts it with a
   * fresh `key` on reload so a re-fetched mapping reseeds the table.
   */
  mapping: WorkflowStateMapping | null;
  record?: MdmsRecord;
  onSaved: (mapping: WorkflowStateMapping, record: MdmsRecord) => void;
}

interface DraftRow {
  /** Local-only stable key — survives renames while editing. */
  id: number;
  status: string;
  key: StateKey;
}

// Module-scope counter so draft-row ids stay unique without a ref (refs
// must not be read during render, and the useState initializer is render).
let rowIdCounter = 0;
function nextRowId(): number {
  return ++rowIdCounter;
}

/** Key-order-independent comparison for read-after-write verification. */
function canonMappings(m: Record<string, string>): string {
  return JSON.stringify(Object.keys(m).sort().map((k) => [k, m[k]]));
}

export function StateMappingCard({ tenantId, actor, mapping, record, onSaved }: StateMappingCardProps) {
  const { toast } = useToast();

  const [draft, setDraft] = useState<DraftRow[]>(() =>
    Object.entries(mapping?.mappings ?? {}).map(([status, key]) => ({
      id: nextRowId(),
      status,
      key,
    })),
  );
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  // Blank-name errors only show after a save attempt — half-typed rows
  // are normal while editing; duplicates are flagged live.
  const [triedSave, setTriedSave] = useState(false);

  /** Reset the draft to the latest loaded/saved mapping (Revert). */
  function seed() {
    setDraft(
      Object.entries(mapping?.mappings ?? {}).map(([status, key]) => ({
        id: nextRowId(),
        status,
        key,
      })),
    );
    setDirty(false);
    setTriedSave(false);
  }

  const duplicateNames = useMemo(() => {
    const counts = new Map<string, number>();
    draft.forEach((r) => {
      const name = r.status.trim();
      if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
    });
    return new Set(Array.from(counts.entries()).filter(([, n]) => n > 1).map(([name]) => name));
  }, [draft]);

  function rowError(row: DraftRow): string | null {
    const name = row.status.trim();
    if (!name) return triedSave ? 'enter a status name' : null;
    if (duplicateNames.has(name)) return 'duplicate — each status can be mapped only once';
    return null;
  }

  function patchRow(id: number, patch: Partial<DraftRow>) {
    setDraft((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    setDirty(true);
  }

  function removeRow(id: number) {
    setDraft((prev) => prev.filter((r) => r.id !== id));
    setDirty(true);
  }

  function addRow() {
    setDraft((prev) => [...prev, { id: nextRowId(), status: '', key: 'new' }]);
    setDirty(true);
  }

  function addStandard() {
    setDraft((prev) => {
      const existing = new Set(prev.map((r) => r.status.trim()));
      const additions = Object.entries(STANDARD_STATE_MAPPINGS)
        .filter(([status]) => !existing.has(status))
        .map(([status, key]) => ({ id: nextRowId(), status, key }));
      if (additions.length === 0) {
        toast({ title: 'Nothing to add', description: 'All standard statuses are already listed.' });
        return prev;
      }
      return [...prev, ...additions];
    });
    setDirty(true);
  }

  async function handleSave() {
    setTriedSave(true);
    const hasBlank = draft.some((r) => !r.status.trim());
    if (hasBlank || duplicateNames.size > 0) {
      toast({ title: "Can't save yet", description: 'Fix the highlighted rows first.', variant: 'destructive' });
      return;
    }

    const mappings: Record<string, StateKey> = {};
    for (const r of draft) mappings[r.status.trim()] = r.key;
    const next: WorkflowStateMapping = { singletonKey: 'default', mappings };

    setSaving(true);
    try {
      const saved = await saveWorkflowStateMapping(tenantId, next, record, actor);
      onSaved(next, saved);
      // The draft now matches the saved record — no reseed needed.
      setDirty(false);
      setTriedSave(false);
      const verified = await verifyAfterWrite(
        () => loadWorkflowStateMapping(tenantId),
        ({ mapping: current }) => canonMappings(current?.mappings ?? {}) === canonMappings(mappings),
      );
      if (verified) {
        toast({ title: 'Saved ✓ verified', description: 'Complaint-status mapping updated.' });
      } else {
        toast({
          title: 'Saved but not yet visible',
          description: 'The data pipeline may be delayed; reload in a few seconds.',
        });
      }
    } catch (err) {
      toast({
        title: 'Save failed',
        description: err instanceof Error ? err.message : 'unknown',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card id="status-mapping">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <GitBranch className="w-4 h-4 text-primary" />
          Complaint-status mapping
        </CardTitle>
        <CardDescription>
          Connect each complaint status to an SLA column so per-state SLAs can apply to it.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {draft.length === 0 && (
          <Alert variant="warning">
            <AlertTriangle className="w-4 h-4" />
            <AlertTitle className="flex items-center gap-2">
              No statuses mapped
              <Badge variant="outline" className="font-mono text-[10px] text-muted-foreground">
                STATE_MAPPING_MISSING
              </Badge>
            </AlertTitle>
            <AlertDescription>
              Without this mapping, per-state SLAs (matrix cells and the defaults row) are ignored.
              Level SLAs still apply; complaints with neither use the previous settings.
            </AlertDescription>
          </Alert>
        )}

        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="py-1.5 pr-2 font-medium">Complaint status</th>
              <th className="py-1.5 pr-2 font-medium w-48">SLA column</th>
              <th className="py-1.5 w-10" />
            </tr>
          </thead>
          <tbody>
            {draft.map((row) => {
              const err = rowError(row);
              return (
                <tr key={row.id} className="border-t border-border align-top">
                  <td className="py-1.5 pr-2">
                    <Input
                      value={row.status}
                      onChange={(e) => patchRow(row.id, { status: e.target.value })}
                      className="h-7 text-xs font-mono"
                      placeholder="e.g. PENDINGFORASSIGNMENT"
                      aria-label="Complaint status name"
                      aria-invalid={err !== null}
                      disabled={saving}
                    />
                    {err && <p className="text-[10px] text-destructive mt-0.5">{err}</p>}
                  </td>
                  <td className="py-1.5 pr-2">
                    <Select
                      value={row.key}
                      onValueChange={(v) => patchRow(row.id, { key: v as StateKey })}
                      disabled={saving}
                    >
                      <SelectTrigger className="h-7 text-xs" aria-label="SLA column">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {STATE_KEYS.map((k) => (
                          <SelectItem key={k} value={k} className="text-xs">
                            {KEY_LABELS[k]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="py-1.5 text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => removeRow(row.id)}
                      aria-label={`Remove status ${row.status || '(blank)'}`}
                      disabled={saving}
                    >
                      <X className="w-3.5 h-3.5" />
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={addRow} disabled={saving}>
            <Plus className="w-3.5 h-3.5 mr-1.5" />
            Add a status
          </Button>
          <Button variant="outline" size="sm" onClick={addStandard} disabled={saving}>
            <ListPlus className="w-3.5 h-3.5 mr-1.5" />
            Add standard complaint statuses
          </Button>
        </div>

        <p className="text-xs text-muted-foreground">
          The escalation scan currently watches statuses{' '}
          <code className="font-mono text-[10px] bg-muted px-1 py-0.5 rounded">PENDINGATLME</code> and{' '}
          <code className="font-mono text-[10px] bg-muted px-1 py-0.5 rounded">PENDINGFORASSIGNMENT</code>;
          other mappings are used by the complaint checker.
        </p>

        <div className="flex items-center gap-2 pt-1">
          <Button size="sm" onClick={handleSave} disabled={!dirty || saving}>
            <Save className="w-3.5 h-3.5 mr-1.5" />
            {saving ? 'Saving…' : 'Save mapping'}
          </Button>
          <Button size="sm" variant="outline" onClick={seed} disabled={!dirty || saving}>
            <Undo2 className="w-3.5 h-3.5 mr-1.5" />
            Revert
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
