import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { digitClient } from '@/providers/bridge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { ChevronDown, ChevronRight, RefreshCw, Users } from 'lucide-react';

interface DesignationRecord {
  code: string;
  name?: string;
  description?: string;
}

interface EmployeeRecord {
  uuid?: string;
  code?: string;
  user?: { name?: string; mobileNumber?: string };
  assignments?: Array<{ designation?: string; department?: string; isCurrentAssignment?: boolean }>;
}

interface DesignationTreePanelProps {
  /** City-level tenant to query HRMS against (e.g. `ke.bomet`). Falls back
   *  to the digitClient's stateTenantId. The tree itself (designations) is
   *  always read at the state tenant since common-masters lives there. */
  cityTenantId?: string;
  className?: string;
}

/**
 * Read-only side panel that lists every `common-masters.Designation` and,
 * optionally, the HRMS employees currently assigned to each one.
 *
 * Intended to be rendered alongside the EscalationConfig editor so operators
 * can sanity-check that their per-level SLAs match the staffing depth — e.g.
 * if maxDepth is 4 but only 2 designations have employees, escalation will
 * stall at level 2.
 *
 * This is a side panel — purely informational; it does NOT bind to the form.
 */
export function DesignationTreePanel({ cityTenantId, className }: DesignationTreePanelProps) {
  const stateTenantId = digitClient.stateTenantId;
  const effectiveCity = cityTenantId ?? stateTenantId;
  const [showEmployees, setShowEmployees] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const { data: designations, isLoading: loadingDesignations, refetch: refetchDesignations } = useQuery<DesignationRecord[], Error>({
    queryKey: ['designation-tree', 'designations', stateTenantId],
    queryFn: async () => {
      if (!stateTenantId) return [];
      const records = await digitClient.mdmsSearch(stateTenantId, 'common-masters.Designation', { limit: 500 });
      const out: DesignationRecord[] = [];
      for (const rec of records) {
        const data = (rec.data ?? {}) as Record<string, unknown>;
        const code = typeof data.code === 'string' ? data.code : (rec.uniqueIdentifier as string | undefined);
        if (!code) continue;
        out.push({
          code,
          name: typeof data.name === 'string' ? data.name : undefined,
          description: typeof data.description === 'string' ? data.description : undefined,
        });
      }
      out.sort((a, b) => a.code.localeCompare(b.code));
      return out;
    },
    enabled: !!stateTenantId,
    staleTime: 5 * 60 * 1000,
  });

  const { data: employees, isLoading: loadingEmployees, refetch: refetchEmployees } = useQuery<EmployeeRecord[], Error>({
    queryKey: ['designation-tree', 'employees', effectiveCity],
    queryFn: async () => {
      if (!effectiveCity) return [];
      const result = await digitClient.employeeSearch(effectiveCity, { limit: 500 });
      return result as EmployeeRecord[];
    },
    enabled: showEmployees && !!effectiveCity,
    staleTime: 60 * 1000,
  });

  const employeesByDesignation = useMemo<Record<string, EmployeeRecord[]>>(() => {
    const out: Record<string, EmployeeRecord[]> = {};
    for (const emp of employees ?? []) {
      const assignments = Array.isArray(emp.assignments) ? emp.assignments : [];
      // Prefer the current assignment; fall back to the first one with a designation.
      const current = assignments.find((a) => a.isCurrentAssignment) ?? assignments.find((a) => a.designation);
      const desigCode = current?.designation;
      if (!desigCode) continue;
      if (!out[desigCode]) out[desigCode] = [];
      out[desigCode].push(emp);
    }
    return out;
  }, [employees]);

  const toggle = (code: string) => {
    setExpanded((prev) => ({ ...prev, [code]: !prev[code] }));
  };

  const refreshAll = () => {
    refetchDesignations();
    if (showEmployees) refetchEmployees();
  };

  return (
    <aside className={`rounded border border-border bg-muted/10 p-3 ${className ?? ''}`}>
      <div className="flex items-center justify-between mb-2">
        <Label className="text-sm font-medium">Designations</Label>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={refreshAll}
            aria-label="refresh"
            className="h-7 w-7 p-0"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      <label className="flex items-center gap-2 text-xs text-muted-foreground mb-2 cursor-pointer">
        <input
          type="checkbox"
          checked={showEmployees}
          onChange={(e) => setShowEmployees(e.target.checked)}
          className="rounded"
        />
        <Users className="w-3.5 h-3.5" />
        Show employees per designation
      </label>

      {loadingDesignations && (
        <p className="text-xs text-muted-foreground p-2">Loading designations...</p>
      )}
      {!loadingDesignations && (designations ?? []).length === 0 && (
        <p className="text-xs text-muted-foreground p-2 italic">No designations found.</p>
      )}

      <ul className="max-h-96 overflow-y-auto space-y-0.5">
        {(designations ?? []).map((d) => {
          const emps = employeesByDesignation[d.code] ?? [];
          const isOpen = !!expanded[d.code];
          const showChevron = showEmployees;
          return (
            <li key={d.code} className="text-sm">
              <div
                className={`flex items-center gap-1 rounded px-2 py-1 ${
                  showChevron ? 'cursor-pointer hover:bg-muted' : ''
                }`}
                onClick={() => showChevron && toggle(d.code)}
              >
                {showChevron && (
                  isOpen
                    ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                    : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
                )}
                <span className="font-mono text-xs">{d.code}</span>
                {d.name && <span className="text-xs text-muted-foreground truncate">— {d.name}</span>}
                {showEmployees && (
                  <span className="ml-auto text-[10px] font-medium rounded px-1.5 py-0.5 bg-muted text-muted-foreground">
                    {loadingEmployees ? '...' : emps.length}
                  </span>
                )}
              </div>
              {showChevron && isOpen && (
                <ul className="ml-6 mt-0.5 mb-1 space-y-0.5">
                  {emps.length === 0 && !loadingEmployees && (
                    <li className="text-xs text-muted-foreground italic px-2 py-0.5">No employees assigned.</li>
                  )}
                  {emps.map((emp) => (
                    <li key={emp.uuid ?? emp.code} className="text-xs px-2 py-0.5 text-muted-foreground">
                      <span className="font-mono">{emp.code ?? emp.uuid}</span>
                      {emp.user?.name && <span className="ml-1">— {emp.user.name}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>

      <p className="mt-2 text-[11px] text-muted-foreground leading-snug">
        Cross-check: the escalation chain needs as many staffed designations as
        the max depth above. {showEmployees && effectiveCity && (
          <>Employees pulled from <code className="font-mono">{effectiveCity}</code>.</>
        )}
      </p>
    </aside>
  );
}
