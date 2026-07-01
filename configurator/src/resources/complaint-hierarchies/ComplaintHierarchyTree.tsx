/**
 * ComplaintHierarchyTree
 *
 * The original flat, indented hierarchy view — every node shown parent-before-
 * child with depth indentation — but with FOLDABLE parents: each node that has
 * children gets a chevron to collapse/expand its subtree (descendants of a
 * collapsed node are skipped, so a 2500-node tree can be folded down to its top
 * categories). Defaults to fully expanded so it looks like the original on load.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, ChevronDown, CornerDownRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

export interface HierNode {
  code: string;
  parentCode?: string | null;
  name?: string;
  levelCode?: string;
  order?: number;
  department?: string;
  slaHours?: number;
}

const isLeaf = (n: HierNode) => n.department != null || n.slaHours != null;

// Rows rendered per batch; the rest auto-load as the bottom scrolls into view.
const PAGE = 100;

function buildOrdered(nodes: HierNode[]) {
  const byParent = new Map<string, HierNode[]>();
  for (const n of nodes) {
    const key = n.parentCode == null || n.parentCode === '' ? '__root' : String(n.parentCode);
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(n);
  }
  for (const arr of byParent.values()) {
    arr.sort(
      (a, b) =>
        (Number(a.order) || 0) - (Number(b.order) || 0) ||
        (a.name || a.code).localeCompare(b.name || b.code),
    );
  }
  const interiorCodes = nodes.filter((n) => (byParent.get(n.code)?.length ?? 0) > 0).map((n) => n.code);
  return { byParent, interiorCodes };
}

export function ComplaintHierarchyTree({
  nodes,
  labelByLevel,
}: {
  nodes: HierNode[];
  labelByLevel: Map<string, string>;
}) {
  const { byParent, interiorCodes } = useMemo(() => buildOrdered(nodes), [nodes]);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  // Cap how many rows are in the DOM; the rest auto-load on scroll (no click).
  const [limit, setLimit] = useState(PAGE);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const toggle = (code: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });

  // Pre-order flatten with depth, skipping descendants of collapsed nodes.
  const rows: Array<{ node: HierNode; depth: number; hasChildren: boolean }> = [];
  const seen = new Set<string>();
  const walk = (key: string, depth: number) => {
    for (const n of byParent.get(key) ?? []) {
      if (seen.has(n.code)) continue; // cycle guard
      seen.add(n.code);
      const hasChildren = (byParent.get(String(n.code))?.length ?? 0) > 0;
      rows.push({ node: n, depth, hasChildren });
      if (hasChildren && !collapsed.has(n.code)) walk(String(n.code), depth + 1);
    }
  };
  walk('__root', 0);
  for (const n of nodes) {
    if (!seen.has(n.code)) {
      seen.add(n.code);
      rows.push({ node: n, depth: 0, hasChildren: false });
    }
  }

  // Auto-load the next batch as the bottom sentinel scrolls into view — reveals
  // the remaining rows without any "show more" click. rootMargin pre-loads a bit
  // early so scrolling stays smooth.
  const total = rows.length;
  useEffect(() => {
    if (total <= limit) return;
    const el = sentinelRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setLimit((l) => Math.min(l + PAGE, total));
      },
      { rootMargin: '400px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [total, limit]);

  return (
    <div className="space-y-2">
      {interiorCodes.length > 0 && (
        <div className="flex items-center gap-3 text-xs">
          <button
            type="button"
            onClick={() => setCollapsed(new Set(interiorCodes))}
            className="text-muted-foreground hover:text-foreground hover:underline"
          >
            Collapse all
          </button>
          <button
            type="button"
            onClick={() => setCollapsed(new Set())}
            className="text-muted-foreground hover:text-foreground hover:underline"
          >
            Expand all
          </button>
        </div>
      )}

      <div className="flex flex-col gap-0.5">
        {rows.slice(0, limit).map(({ node, depth, hasChildren }) => {
          const leaf = isLeaf(node);
          const isCollapsed = collapsed.has(node.code);
          return (
            <div
              key={`${node.code}-${depth}`}
              className="flex items-center gap-2 py-0.5"
              style={{ marginLeft: depth * 22 }}
            >
              {hasChildren ? (
                <button
                  type="button"
                  onClick={() => toggle(node.code)}
                  className="w-4 h-4 flex items-center justify-center shrink-0 text-muted-foreground hover:text-foreground"
                  aria-label={isCollapsed ? 'Expand' : 'Collapse'}
                >
                  {isCollapsed ? (
                    <ChevronRight className="w-3.5 h-3.5" />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5" />
                  )}
                </button>
              ) : depth > 0 ? (
                <CornerDownRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              ) : (
                <span className="w-4 h-4 shrink-0" />
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

      {total > limit && (
        <div ref={sentinelRef} className="py-3 text-center text-xs text-muted-foreground">
          Loading more… ({limit} of {total})
        </div>
      )}
    </div>
  );
}

export default ComplaintHierarchyTree;
