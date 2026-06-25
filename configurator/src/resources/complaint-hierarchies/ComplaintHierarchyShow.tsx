import { DigitShow } from '@/admin';
import { FieldSection, FieldRow, DateField } from '@/admin/fields';
import { Badge } from '@/components/ui/badge';
import { ArrowDown, CornerDownRight } from 'lucide-react';
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

/** Flatten the adjacency list into render rows ordered parent-before-child, each
 *  carrying its depth, so the WHOLE tree (every category → sector → … → sub-type)
 *  renders — not just the level definition. */
function flattenTree(nodes: HierarchyNode[]): Array<{ node: HierarchyNode; depth: number }> {
  const byParent = new Map<string, HierarchyNode[]>();
  for (const n of nodes) {
    const key = n.parentCode == null || n.parentCode === '' ? '__root' : String(n.parentCode);
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(n);
  }
  for (const arr of byParent.values()) {
    arr.sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
  }
  const out: Array<{ node: HierarchyNode; depth: number }> = [];
  const seen = new Set<string>();
  const walk = (key: string, depth: number) => {
    for (const n of byParent.get(key) ?? []) {
      if (seen.has(n.code)) continue; // cycle guard
      seen.add(n.code);
      out.push({ node: n, depth });
      walk(String(n.code), depth + 1);
    }
  };
  walk('__root', 0);
  // Any node whose parent isn't present (orphan) still gets shown, at root depth.
  for (const n of nodes) {
    if (!seen.has(n.code)) {
      seen.add(n.code);
      out.push({ node: n, depth: 0 });
    }
  }
  return out;
}

export function ComplaintHierarchyShow() {
  const { record } = useShowController();
  const { state } = useApp();
  // ComplaintHierarchy is a state-level master; fetch at the state root tenant.
  const stateTenant = (state.tenant || '').split('.')[0] || state.tenant;
  const hierarchyType = String((record as Record<string, unknown> | undefined)?.hierarchyType ?? '');

  const { data: nodes = [], isLoading } = useQuery({
    queryKey: ['complaint-hierarchy-tree', stateTenant, hierarchyType],
    enabled: !!stateTenant && !!hierarchyType,
    queryFn: async () => {
      const rows = await mdmsService.search<HierarchyNode>(
        stateTenant,
        'RAINMAKER-PGR.ComplaintHierarchy',
        { limit: 2000 },
      );
      return rows.filter((r) => r.active !== false && (!r.hierarchyType || r.hierarchyType === hierarchyType));
    },
  });

  const tree = flattenTree(nodes);
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
              ) : tree.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No hierarchy nodes found for {hierarchyType || 'this hierarchy'} at {stateTenant}.
                </p>
              ) : (
                <div className="flex flex-col gap-0.5">
                  {tree.map(({ node, depth }) => {
                    const leaf = isLeafNode(node);
                    return (
                      <div
                        key={`${node.code}-${depth}`}
                        className="flex items-center gap-2 py-0.5"
                        style={{ marginLeft: depth * 22 }}
                      >
                        {depth > 0 && (
                          <CornerDownRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                        )}
                        <Badge variant="outline" className="text-[10px] shrink-0">
                          {labelByLevel.get(String(node.levelCode)) || String(node.levelCode ?? '')}
                        </Badge>
                        <span className="text-sm font-medium">{node.name || node.code}</span>
                        <span className="text-xs text-muted-foreground">({node.code})</span>
                        {leaf && (
                          <span className="text-[11px] text-emerald-600 shrink-0">
                            leaf{node.department ? ` · ${node.department}` : ''}
                            {node.slaHours != null ? ` · ${node.slaHours}h` : ''}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
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
