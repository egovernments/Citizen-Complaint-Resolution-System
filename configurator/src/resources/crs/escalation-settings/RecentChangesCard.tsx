/**
 * Bottom card — "Recent changes": collapsible audit list for the two
 * deployment-wide records this page edits. Reads the shared
 * CRS.SLAAuditLog (same store the matrix page writes to) and filters to
 * the escalation-settings schemas; entries load lazily on first expand.
 */
import { useState } from 'react';
import { History, ChevronDown, ChevronRight } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  loadAuditEntries,
  ESCALATION_POLICY_SCHEMA,
  WORKFLOW_STATE_MAPPING_SCHEMA,
  type AuditEntry,
} from '../sla-matrix/slaService';

/** Operator labels — the schema codes themselves stay out of the copy. */
const SETTING_LABELS: Record<string, string> = {
  [ESCALATION_POLICY_SCHEMA]: 'Escalation behaviour',
  [WORKFLOW_STATE_MAPPING_SCHEMA]: 'Status mapping',
};

interface RecentChangesCardProps {
  /** Audit entries for these records live at the state tenant. */
  stateTenant: string;
}

export function RecentChangesCard({ stateTenant }: RecentChangesCardProps) {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && entries === null && loadError === null) {
      try {
        const all = await loadAuditEntries(stateTenant, 50);
        setEntries(all.filter((e) => e.schemaCode in SETTING_LABELS));
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : 'failed to load changes');
      }
    }
  }

  return (
    <Card>
      <button onClick={toggle} className="w-full text-left" aria-expanded={open}>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div className="space-y-1.5">
            <CardTitle className="flex items-center gap-2">
              <History className="w-4 h-4 text-primary" />
              Recent changes
            </CardTitle>
            <CardDescription>Who changed these settings, and when.</CardDescription>
          </div>
          {open ? (
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
          )}
        </CardHeader>
      </button>
      {open && (
        <CardContent>
          {loadError && <p className="text-sm text-destructive">{loadError}</p>}
          {!loadError && entries === null && (
            <p className="text-sm text-muted-foreground">Loading…</p>
          )}
          {!loadError && entries && entries.length === 0 && (
            <p className="text-sm text-muted-foreground">No changes recorded yet.</p>
          )}
          {!loadError && entries && entries.length > 0 && (
            <table className="w-full text-xs">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="py-1.5 pr-2 font-medium">When</th>
                  <th className="py-1.5 pr-2 font-medium">User</th>
                  <th className="py-1.5 pr-2 font-medium">Action</th>
                  <th className="py-1.5 font-medium">Setting</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={`${e.timestamp}:${e.userUuid}:${e.recordIdentifier}`} className="border-t border-border">
                    <td className="py-1.5 pr-2 text-muted-foreground">
                      {new Date(e.timestamp).toLocaleString()}
                    </td>
                    <td className="py-1.5 pr-2">{e.userName}</td>
                    <td className="py-1.5 pr-2">
                      <Badge variant="outline">{e.action}</Badge>
                    </td>
                    <td className="py-1.5">{SETTING_LABELS[e.schemaCode] ?? e.schemaCode}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      )}
    </Card>
  );
}
