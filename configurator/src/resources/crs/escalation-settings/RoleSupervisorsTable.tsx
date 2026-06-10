/**
 * "Pin a specific person per role…" — the CRS.RoleSupervisors editor,
 * rendered inside PolicyCard's role-escalation block.
 *
 * Each pin maps (role, department) → one employee; the resolver checks
 * pins before the role ladder. Rows save individually (not with the
 * policy) through slaService.saveRoleSupervisorRow, and a row can only
 * save after its employee ID has been looked up successfully — the
 * "Look up" button resolves the ID to a name via the employees search,
 * which is validation feedback, not a full picker. (role, department)
 * is the record's identity, so those fields lock once a pin is saved;
 * to move a pin, switch it off and add a new one.
 */
import { useEffect, useState } from 'react';
import { Plus, Search, Save, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { digitClient } from '@/providers/bridge';
import type { MdmsRecord } from '@digit-mcp/data-provider';
import {
  loadRoleSupervisors,
  saveRoleSupervisorRow,
  type AuditActor,
} from '../sla-matrix/slaService';
import { isUuidFormat } from './roleEscalationDraft';

interface RoleSupervisorsTableProps {
  tenantId: string;
  actor: AuditActor;
  /** id of the shared role <datalist> rendered by PolicyCard. */
  roleListId: string;
}

type LookupStatus = 'idle' | 'loading' | 'found' | 'not-found' | 'error';

interface PinDraft {
  /** Local-only stable key — survives edits. */
  id: number;
  role: string;
  department: string;
  assigneeUuid: string;
  isActive: boolean;
  recordId?: string;
  original?: MdmsRecord;
  lookup: LookupStatus;
  /** Name the last successful look-up resolved. */
  lookupName?: string;
  /** The exact ID that look-up confirmed — editing the ID re-arms it. */
  verifiedUuid?: string;
  saving?: boolean;
  dirty: boolean;
}

// Module-scope counter so draft-row ids stay unique without a ref (refs
// must not be read during render, and the useState initializer is render).
let pinIdCounter = 0;
function nextPinId(): number {
  return ++pinIdCounter;
}

export function RoleSupervisorsTable({ tenantId, actor, roleListId }: RoleSupervisorsTableProps) {
  const { toast } = useToast();
  const [rows, setRows] = useState<PinDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const pins = await loadRoleSupervisors(tenantId);
        if (cancelled) return;
        setRows(
          pins.map((pin) => ({
            id: nextPinId(),
            role: pin.role,
            department: pin.department,
            assigneeUuid: pin.assigneeUuid,
            isActive: pin.isActive,
            recordId: pin.recordId,
            original: pin.original,
            lookup: 'idle',
            dirty: false,
          })),
        );
        setLoadError(null);
      } catch {
        if (!cancelled) setLoadError("Couldn't load the pinned people — reload the page to retry.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  function patchRow(id: number, patch: Partial<PinDraft>) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  /**
   * Patch a row only while its ID input still holds `uuid` (captured when
   * "Look up" was clicked). Editing the ID mid-flight resets the row to
   * 'idle'; without this guard the late resolve would paint "✓ name" over
   * the edited ID — the save gate (verifiedUuid === current uuid) already
   * refuses to save, but the feedback would mislead.
   */
  function patchRowForUuid(id: number, uuid: string, patch: Partial<PinDraft>) {
    setRows((prev) =>
      prev.map((r) => (r.id === id && r.assigneeUuid.trim() === uuid ? { ...r, ...patch } : r)),
    );
  }

  function addRow() {
    setRows((prev) => [
      ...prev,
      {
        id: nextPinId(),
        role: '',
        department: 'ALL',
        assigneeUuid: '',
        isActive: true,
        lookup: 'idle',
        dirty: true,
      },
    ]);
  }

  function removeRow(id: number) {
    // Only unsaved rows can be removed locally; saved pins are switched
    // off via the active checkbox instead (MDMS has no hard delete).
    setRows((prev) => prev.filter((r) => r.id !== id));
  }

  async function lookUp(row: PinDraft) {
    const uuid = row.assigneeUuid.trim();
    patchRow(row.id, { lookup: 'loading', lookupName: undefined, verifiedUuid: undefined });
    try {
      // Employees live at the page tenant (city level); the pin itself
      // stores only the tenant-agnostic employee ID.
      const employees = await digitClient.employeeSearch(tenantId, { uuids: [uuid], limit: 5 });
      const active = employees.filter((e) => e.isActive !== false);
      if (active.length === 0) {
        patchRowForUuid(row.id, uuid, { lookup: 'not-found' });
        return;
      }
      const user = active[0].user as Record<string, unknown> | undefined;
      const name = String(user?.name ?? active[0].code ?? uuid);
      patchRowForUuid(row.id, uuid, { lookup: 'found', lookupName: name, verifiedUuid: uuid });
    } catch {
      patchRowForUuid(row.id, uuid, { lookup: 'error' });
    }
  }

  function uuidError(row: PinDraft): string | null {
    const uuid = row.assigneeUuid.trim();
    if (!uuid || isUuidFormat(uuid)) return null;
    return 'not a valid employee ID';
  }

  function canSave(row: PinDraft): boolean {
    const uuid = row.assigneeUuid.trim();
    return (
      row.dirty &&
      !row.saving &&
      row.role.trim() !== '' &&
      row.department.trim() !== '' &&
      isUuidFormat(uuid) &&
      row.lookup === 'found' &&
      row.verifiedUuid === uuid
    );
  }

  async function handleSaveRow(row: PinDraft) {
    patchRow(row.id, { saving: true });
    try {
      const saved = await saveRoleSupervisorRow(
        tenantId,
        {
          role: row.role.trim(),
          department: row.department.trim(),
          assigneeUuid: row.assigneeUuid.trim(),
          isActive: row.isActive,
        },
        row.original,
        actor,
      );
      patchRow(row.id, { recordId: saved.id, original: saved, dirty: false, saving: false });
      toast({
        title: 'Pin saved',
        description: `${row.role.trim()} now escalates to ${row.lookupName ?? 'the pinned person'}.`,
      });
    } catch (err) {
      patchRow(row.id, { saving: false });
      toast({
        title: 'Save failed',
        description: err instanceof Error ? err.message : 'unknown',
        variant: 'destructive',
      });
    }
  }

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">Pin a specific person per role…</p>
      <p className="text-xs text-muted-foreground">
        A pinned person is checked before the role ladder. Use department <code className="font-mono text-[10px] bg-muted px-1 py-0.5 rounded">ALL</code> to
        apply a pin to every department. Each pin saves on its own.
      </p>

      {loadError && <p className="text-xs text-destructive">{loadError}</p>}
      {loading && <p className="text-xs text-muted-foreground">Loading pinned people…</p>}

      {!loading && (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="py-1.5 pr-2 font-medium">Role</th>
              <th className="py-1.5 pr-2 font-medium">Department</th>
              <th className="py-1.5 pr-2 font-medium">Person (employee ID)</th>
              <th className="py-1.5 pr-2 font-medium w-16">Active</th>
              <th className="py-1.5 w-28" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="py-2 text-muted-foreground">
                  No people pinned yet.
                </td>
              </tr>
            )}
            {rows.map((row) => {
              const idErr = uuidError(row);
              const saved = row.recordId !== undefined;
              return (
                <tr key={row.id} className="border-t border-border align-top">
                  <td className="py-1.5 pr-2">
                    <Input
                      value={row.role}
                      onChange={(e) => patchRow(row.id, { role: e.target.value, dirty: true })}
                      className="h-7 text-xs font-mono"
                      placeholder="e.g. GRO"
                      list={roleListId}
                      aria-label="Pinned role"
                      // (role, department) is the pin's identity — locked once saved.
                      disabled={row.saving || saved}
                    />
                  </td>
                  <td className="py-1.5 pr-2">
                    <Input
                      value={row.department}
                      onChange={(e) => patchRow(row.id, { department: e.target.value, dirty: true })}
                      className="h-7 text-xs font-mono"
                      placeholder="ALL"
                      aria-label="Pinned department (ALL for every department)"
                      disabled={row.saving || saved}
                    />
                  </td>
                  <td className="py-1.5 pr-2">
                    <div className="flex items-center gap-1.5">
                      <Input
                        value={row.assigneeUuid}
                        onChange={(e) =>
                          patchRow(row.id, {
                            assigneeUuid: e.target.value,
                            dirty: true,
                            // A changed ID invalidates the previous look-up.
                            lookup: 'idle',
                            lookupName: undefined,
                            verifiedUuid: undefined,
                          })
                        }
                        className="h-7 text-xs font-mono"
                        placeholder="employee ID"
                        aria-label="Pinned employee ID"
                        aria-invalid={idErr !== null}
                        disabled={row.saving}
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 px-2"
                        onClick={() => lookUp(row)}
                        disabled={row.saving || row.lookup === 'loading' || !isUuidFormat(row.assigneeUuid)}
                      >
                        <Search className="w-3 h-3 mr-1" />
                        {row.lookup === 'loading' ? 'Looking…' : 'Look up'}
                      </Button>
                    </div>
                    {idErr && <p className="text-[10px] text-destructive mt-0.5">{idErr}</p>}
                    {row.lookup === 'found' && (
                      <p className="text-[10px] text-emerald-700 mt-0.5">✓ {row.lookupName}</p>
                    )}
                    {row.lookup === 'not-found' && (
                      <p className="text-[10px] text-destructive mt-0.5">
                        No active employee found with this ID.
                      </p>
                    )}
                    {row.lookup === 'error' && (
                      <p className="text-[10px] text-destructive mt-0.5">Look-up failed — try again.</p>
                    )}
                  </td>
                  <td className="py-1.5 pr-2">
                    <input
                      type="checkbox"
                      checked={row.isActive}
                      onChange={(e) => patchRow(row.id, { isActive: e.target.checked, dirty: true })}
                      aria-label="Pin active"
                      disabled={row.saving}
                    />
                  </td>
                  <td className="py-1.5 text-right whitespace-nowrap">
                    <Button
                      size="sm"
                      className="h-7 px-2"
                      onClick={() => handleSaveRow(row)}
                      disabled={!canSave(row)}
                    >
                      <Save className="w-3 h-3 mr-1" />
                      {row.saving ? 'Saving…' : saved ? 'Update' : 'Save pin'}
                    </Button>
                    {!saved && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 ml-1"
                        onClick={() => removeRow(row.id)}
                        aria-label={`Remove unsaved pin ${row.role || '(blank)'}`}
                        disabled={row.saving}
                      >
                        <X className="w-3.5 h-3.5" />
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <Button variant="outline" size="sm" onClick={addRow} disabled={loading}>
        <Plus className="w-3.5 h-3.5 mr-1.5" />
        Pin a person
      </Button>
      <p className="text-xs text-muted-foreground">
        Look up the employee ID before saving — the pin must point at one active staff member. If a
        pinned person later leaves, escalation falls back to the role ladder.
      </p>
    </div>
  );
}
