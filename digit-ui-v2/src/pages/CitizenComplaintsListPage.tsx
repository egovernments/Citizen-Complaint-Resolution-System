/**
 * "My Complaints" — list of the signed-in citizen's PGR complaints.
 *
 * Uses ra-core's <ListBase> for the data-fetch + pagination plumbing,
 * but renders the rows ourselves as shadcn Cards so the chrome stays
 * consistent with the rest of the citizen UI. dataProvider injects the
 * mobileNumber filter from the citizen session — see citizenBridge.ts.
 */
import { useListContext, ListBase, useGetList } from 'ra-core';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronRight, FilePlus2, Inbox, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { useServiceDefs } from '@/hooks/useServiceDefs';
import type { Complaint } from '@/providers/citizenBridge';

const CLOSED_STATUSES = ['RESOLVED', 'CLOSEDAFTERRESOLUTION'];
const REJECTED_STATUSES = ['REJECTED', 'CLOSEDAFTERREJECTION'];

function statusToBucket(status: string): 'open' | 'closed' | 'rejected' {
  if (REJECTED_STATUSES.includes(status)) return 'rejected';
  if (CLOSED_STATUSES.includes(status)) return 'closed';
  return 'open';
}

function StatusPill({ status }: { status: string }) {
  const bucket = statusToBucket(status);
  const labels: Record<typeof bucket, string> = {
    open: 'Open',
    closed: 'Resolved',
    rejected: 'Rejected',
  };
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
        bucket === 'open' && 'bg-blue-100 text-blue-700',
        bucket === 'closed' && 'bg-emerald-100 text-emerald-700',
        bucket === 'rejected' && 'bg-rose-100 text-rose-700',
      )}
    >
      {labels[bucket]}
    </span>
  );
}

function ServiceLabel({ code }: { code: string }) {
  const { tree } = useServiceDefs();
  // Try parent match first, then child.
  for (const p of tree) {
    if (p.serviceCode === code) return <>{p.name}</>;
    const c = p.children.find((c) => c.serviceCode === code);
    if (c) return <>{p.name} · {c.name}</>;
  }
  return <>{code}</>;
}

function ListBody() {
  const { data, isPending, error } = useListContext<Complaint>();
  const navigate = useNavigate();

  if (isPending) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground text-sm py-8">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading complaints…
      </div>
    );
  }
  if (error) {
    return (
      <Card className="p-4 text-sm text-destructive">
        Couldn't load complaints. Try refreshing.
      </Card>
    );
  }
  if (!data || data.length === 0) {
    return (
      <Card className="p-8 text-center">
        <Inbox className="h-10 w-10 mx-auto text-muted-foreground/60 mb-3" />
        <h3 className="text-base font-medium">No complaints yet</h3>
        <p className="text-sm text-muted-foreground mt-1 mb-4">
          When you file a complaint we'll track it here.
        </p>
        <Button onClick={() => navigate('/complaints/create')}>
          <FilePlus2 className="h-4 w-4 mr-2" />
          File a complaint
        </Button>
      </Card>
    );
  }

  return (
    <div className="space-y-2">
      {data.map((c) => (
        <Link
          key={c.id}
          to={`/complaints/${encodeURIComponent(c.id)}/show`}
          className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-lg"
        >
          <Card className="p-4 hover:bg-muted/40 transition-colors">
            <div className="flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <StatusPill status={c.applicationStatus} />
                  <span className="text-xs text-muted-foreground font-mono">{c.serviceRequestId}</span>
                </div>
                <div className="text-sm font-medium truncate">
                  <ServiceLabel code={c.serviceCode} />
                </div>
                {c.description && (
                  <div className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{c.description}</div>
                )}
                <div className="text-xs text-muted-foreground mt-1">
                  Filed {new Date(c.createdTime).toLocaleString()}
                </div>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
            </div>
          </Card>
        </Link>
      ))}
    </div>
  );
}

export default function CitizenComplaintsListPage() {
  // Prefetch the service-defs catalogue so the per-row label resolves
  // synchronously when ListBase's data arrives — avoids a flash of raw
  // serviceCode strings.
  useGetList; // (lint-keep — react-admin re-export reachable for future filter UI)
  useServiceDefs();

  return (
    <div className="max-w-3xl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">My Complaints</h1>
          <p className="text-sm text-muted-foreground mt-1">Track everything you've reported.</p>
        </div>
        <Button asChild>
          <Link to="/complaints/create">
            <FilePlus2 className="h-4 w-4 mr-2" />
            File a complaint
          </Link>
        </Button>
      </div>
      <ListBase resource="complaints" perPage={50} sort={{ field: 'createdTime', order: 'DESC' }}>
        <ListBody />
      </ListBase>
    </div>
  );
}
