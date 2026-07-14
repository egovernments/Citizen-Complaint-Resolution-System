import { DigitShow } from '@/admin';
import { FieldSection, FieldRow, DateField } from '@/admin/fields';
import { Badge } from '@/components/ui/badge';
import { ArrowDown } from 'lucide-react';
import { ComplaintHierarchyTree } from './ComplaintHierarchyTree';
import { useShowController } from 'ra-core';
import { useQuery } from '@tanstack/react-query';
import { mdmsService } from '@/api';
import { useApp } from '../../App';

/** A raw RAINMAKER-PGR.ComplaintHierarchy adjacency-list row (interior node or leaf). */
interface HierarchyNode {
  hierarchyType?: string;
  levelCode?: string;
  code: string;
  parentCode?: string | null;
  name?: string;
  order?: number;
  active?: boolean;
  path?: string;
  department?: string;
  slaHours?: number;
}

const isLeafNode = (n: HierarchyNode) => n.department != null || n.slaHours != null;

export function ComplaintHierarchyShow() {
  const { record } = useShowController();
  const { state } = useApp();
  // ComplaintHierarchy data is scoped PER TENANT — in some deployments it lives at
  // the state root, in others at the sub-tenant the user operates under (prod: the
  // "Complaint_Hierarchy" nodes are seeded at mz.ige, not mz). The definition is
  // read from state.tenant, so the nodes must be too. Fetch at the CURRENT tenant
  // AND the state root, then keep this hierarchyType — finds the nodes wherever
  // they were seeded. (The old `state.tenant.split('.')[0]` forced the root and
  // returned nothing for sub-tenant-scoped hierarchies.)
  const currentTenant = state.tenant || '';
  const stateRoot = currentTenant.split('.')[0] || currentTenant;
  const hierarchyType = String((record as Record<string, unknown> | undefined)?.hierarchyType ?? '');

  const { data: nodes = [], isLoading } = useQuery({
    queryKey: ['complaint-hierarchy-tree', currentTenant, stateRoot, hierarchyType],
    enabled: !!currentTenant && !!hierarchyType,
    queryFn: async () => {
      // Page through the WHOLE hierarchy — it can be thousands of nodes, and a
      // single { limit } silently truncated large tenants (the old 2000 cap).
      const PAGE = 1000;
      const fetchAll = async (tenant: string) => {
        const acc: HierarchyNode[] = [];
        for (let offset = 0; ; offset += PAGE) {
          const page = await mdmsService.search<HierarchyNode>(
            tenant,
            'RAINMAKER-PGR.ComplaintHierarchy',
            { limit: PAGE, offset },
          );
          acc.push(...page);
          if (page.length < PAGE || offset > 100000) break; // last page (or safety cap)
        }
        return acc;
      };
      // Current tenant first (where the definition came from), then the state root
      // as a fallback; dedupe by code so a node present at both isn't doubled.
      const tenants = Array.from(new Set([currentTenant, stateRoot].filter(Boolean)));
      const seen = new Set<string>();
      const all: HierarchyNode[] = [];
      for (const t of tenants) {
        for (const r of await fetchAll(t)) {
          if (!seen.has(r.code)) {
            seen.add(r.code);
            all.push(r);
          }
        }
      }
      return all.filter((r) => r.active !== false && (!r.hierarchyType || r.hierarchyType === hierarchyType));
    },
  });

  const leafCount = nodes.filter(isLeafNode).length;

  return (
    <DigitShow
      title={record ? `Hierarchy: ${record.hierarchyType ?? record.id}` : 'Complaint Hierarchy'}
    >
      {(rec: Record<string, unknown>) => {
        const levels = (rec.levels as Array<Record<string, unknown>> | undefined) ?? [];
        const ordered = [...levels].sort(
          (a, b) => (Number(a.order) || 0) - (Number(b.order) || 0)
        );
        const audit = rec.auditDetails as Record<string, unknown> | undefined;
        const labelByLevel = new Map<string, string>(
          ordered.map((l) => [String(l.levelCode), String(l.label || l.levelCode)])
        );

        return (
          <div className="space-y-6">
            <FieldSection title="Details">
              <FieldRow label="Hierarchy Type">{String(rec.hierarchyType ?? '')}</FieldRow>
              <FieldRow label="Levels">{String(ordered.length)}</FieldRow>
              <FieldRow label="Total nodes">{isLoading ? '…' : String(nodes.length)}</FieldRow>
              <FieldRow label="Leaf complaint types">{isLoading ? '…' : String(leafCount)}</FieldRow>
            </FieldSection>

            {ordered.length > 0 && (
              <FieldSection title="Hierarchy Levels (definition)">
                <div className="flex flex-col items-start gap-1">
                  {ordered.map((level, i) => {
                    const code = String(level.levelCode ?? `Level ${i + 1}`);
                    const isLeaf = !!level.isLeafServiceCode;
                    return (
                      <div key={i} className="flex flex-col items-start">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-xs">
                            {code}
                          </Badge>
                          {isLeaf && (
                            <span className="text-xs text-emerald-600">
                              leaf · serviceCode level
                            </span>
                          )}
                        </div>
                        {i < ordered.length - 1 && (
                          <div className="flex items-center ml-3 my-0.5">
                            <ArrowDown className="w-3 h-3 text-muted-foreground" />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </FieldSection>
            )}

            {/* The ENTIRE hierarchy — every node at every level, nested by parentCode. */}
            <FieldSection title="Full Hierarchy">
              {isLoading ? (
                <p className="text-sm text-muted-foreground">Loading hierarchy…</p>
              ) : nodes.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No hierarchy nodes found for {hierarchyType || 'this hierarchy'} at {currentTenant}
                  {stateRoot !== currentTenant ? ` (or ${stateRoot})` : ''}.
                </p>
              ) : (
                <ComplaintHierarchyTree nodes={nodes} labelByLevel={labelByLevel} />
              )}
            </FieldSection>

            {audit && (
              <FieldSection title="Audit">
                <FieldRow label="Created by">{String(audit.createdBy ?? '--')}</FieldRow>
                <FieldRow label="Created at">
                  <DateField value={audit.createdTime} />
                </FieldRow>
              </FieldSection>
            )}
          </div>
        );
      }}
    </DigitShow>
  );
}
