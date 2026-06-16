import { useCallback, useMemo, useState } from 'react';
import {
  ReactFlow, ReactFlowProvider, Background, Controls, type NodeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useGetList } from 'ra-core';
import { useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { useOrgChartData } from './useOrgChartData';
import { EmployeeNode } from './EmployeeNode';

const nodeTypes: NodeTypes = { employee: EmployeeNode };

interface TenantRecord { id: string; code: string; name?: string }

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="px-3 py-1.5 rounded-md bg-muted/50 text-center">
      <div className="text-lg font-semibold leading-none">{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground mt-0.5">{label}</div>
    </div>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
      <span className="flex items-center gap-1"><span className="w-3 h-3 rounded border border-primary/40 bg-card" /> Manager</span>
      <span className="flex items-center gap-1"><span className="w-3 h-3 rounded border bg-card" /> Member</span>
      <span className="flex items-center gap-1"><span className="w-3 h-3 rounded border border-dashed border-amber-500 bg-amber-50" /> Unresolved manager</span>
      <span className="flex items-center gap-1"><span className="w-3 h-3 rounded border bg-card opacity-60" /> Inactive</span>
    </div>
  );
}

export default function OrgChartPage() {
  const navigate = useNavigate();
  const { data: tenants, isLoading: tenantsLoading } = useGetList<TenantRecord>('tenants', {
    pagination: { page: 1, perPage: 1000 },
    sort: { field: 'code', order: 'ASC' },
  });
  const [selectedTenantId, setSelectedTenantId] = useState<string>('');
  const [query, setQuery] = useState('');

  // Default to the first tenant until the user picks one. Derived during render
  // (rather than set via an effect) to avoid an extra render.
  const tenantId = selectedTenantId || tenants?.find((t) => t.code)?.code || '';

  const { data, isLoading, isError, refetch } = useOrgChartData(tenantId || undefined);

  const matches = useCallback(
    (text: string) =>
      query.trim() !== '' && text.toLowerCase().includes(query.trim().toLowerCase()),
    [query],
  );

  const canvasNodes = useMemo(() => {
    if (!data) return [];
    return data.canvasNodes.map((n) => {
      const hit = matches(`${n.data.name} ${n.data.code ?? ''}`);
      return { ...n, className: hit ? 'ring-2 ring-primary rounded-md' : undefined };
    });
  }, [data, matches]);

  const filteredOrphans = useMemo(() => {
    if (!data) return [];
    if (query.trim() === '') return data.orphanNodes;
    return data.orphanNodes.filter((o) => matches(`${o.name} ${o.code ?? ''}`));
  }, [data, matches, query]);

  return (
    <div className="flex flex-col h-full min-h-0 p-4 gap-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-xl font-semibold">Org Chart</h1>
        <div className="flex items-center gap-2">
          <Select value={tenantId} onValueChange={setSelectedTenantId} disabled={tenantsLoading}>
            <SelectTrigger className="w-[260px]">
              <SelectValue placeholder={tenantsLoading ? 'Loading tenants…' : 'Select a tenant…'} />
            </SelectTrigger>
            <SelectContent>
              {(tenants ?? []).filter((t) => t.code).map((t) => (
                <SelectItem key={t.code} value={t.code}>{t.name ?? t.code}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            placeholder="Search name or code…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-[220px]"
            disabled={!data}
            aria-label="Search employees by name or code"
          />
        </div>
      </div>

      {data && (
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex gap-2">
            <Stat label="Total" value={data.graph.stats.total} />
            <Stat label="With mgr" value={data.graph.stats.withManager} />
            <Stat label="Orphans" value={data.graph.stats.orphans} />
            <Stat label="Unresolved" value={data.graph.stats.unresolved} />
            <Stat label="Cycles" value={data.graph.stats.cycles} />
          </div>
          <Legend />
        </div>
      )}

      {data?.truncated && (
        <div className="text-xs text-amber-700">Showing the first 1000 employees for this tenant.</div>
      )}

      <div className="flex flex-1 gap-3 min-h-0">
        <Card className="flex-1 min-w-0 overflow-hidden">
          {tenantsLoading && !tenantId ? (
            <div className="h-full grid place-items-center text-muted-foreground gap-2 text-sm">
              <Loader2 className="w-6 h-6 animate-spin" />
              Loading tenants…
            </div>
          ) : !tenantId ? (
            <div className="h-full grid place-items-center text-muted-foreground text-sm">No tenants available.</div>
          ) : isLoading ? (
            <div className="h-full grid place-items-center text-muted-foreground"><Loader2 className="w-6 h-6 animate-spin" /></div>
          ) : isError ? (
            <div className="h-full grid place-items-center text-sm text-destructive">
              Failed to load. <button className="underline ml-1" onClick={() => refetch()}>Retry</button>
            </div>
          ) : canvasNodes.length === 0 ? (
            <div className="h-full grid place-items-center text-muted-foreground text-sm text-center px-6">
              No reporting relationships for this tenant.<br />Everyone is listed under "No reporting relationship".
            </div>
          ) : (
            <ReactFlowProvider>
              <ReactFlow
                nodes={canvasNodes}
                edges={data?.canvasEdges ?? []}
                nodeTypes={nodeTypes}
                fitView
                minZoom={0.1}
              >
                <Background />
                <Controls />
              </ReactFlow>
            </ReactFlowProvider>
          )}
        </Card>

        {data && data.orphanNodes.length > 0 && (
          <Card className="w-[260px] flex-shrink-0 overflow-auto p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
              No reporting relationship ({query.trim() ? `${filteredOrphans.length} of ${data.orphanNodes.length}` : data.orphanNodes.length})
            </div>
            <div className="space-y-1">
              {filteredOrphans.map((o) => (
                <button
                  key={o.id}
                  onClick={() => navigate(`/manage/employees/${o.id}/show`)}
                  className="w-full text-left text-sm px-2 py-1.5 rounded hover:bg-muted truncate"
                  title={`${o.name} — ${o.code ?? ''}`}
                >
                  {o.name}
                  <span className="block text-[10px] text-muted-foreground truncate">
                    {[o.designation, o.department].filter(Boolean).join(' · ') || o.code}
                  </span>
                </button>
              ))}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
