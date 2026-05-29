/**
 * Citizen complaint detail — summary + location map + photos + workflow
 * timeline. Read-only in T1 (no reopen/rate actions — that's T2).
 *
 * Uses ra-core's <ShowBase> for the data fetch (which calls our
 * dataProvider.getOne, which fans out to /pgr-services/v2/request/_search
 * with serviceRequestId filter).
 */
import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ShowBase, useShowContext } from 'ra-core';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowLeft, ImageOff, Loader2 } from 'lucide-react';
import ComplaintMap from '@/components/digit/ComplaintMap';
import { useServiceDefs } from '@/hooks/useServiceDefs';
import { apiClient, getApiBaseUrl } from '@/api';
import type { Complaint } from '@/providers/citizenBridge';
import { cn } from '@/lib/utils';

const CITY_TENANT = (import.meta.env.VITE_CITIZEN_TENANT as string) || 'ke.nairobi';

const CLOSED = ['RESOLVED', 'CLOSEDAFTERRESOLUTION'];
const REJECTED = ['REJECTED', 'CLOSEDAFTERREJECTION'];

function StatusPill({ status }: { status: string }) {
  const isClosed = CLOSED.includes(status);
  const isRejected = REJECTED.includes(status);
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-3 py-1 text-xs font-medium',
        !isClosed && !isRejected && 'bg-blue-100 text-blue-700',
        isClosed && 'bg-emerald-100 text-emerald-700',
        isRejected && 'bg-rose-100 text-rose-700',
      )}
    >
      {status}
    </span>
  );
}

function usePhotoUrls(fileStoreIds: string[]): { urls: Record<string, string>; isLoading: boolean } {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [isLoading, setLoading] = useState(false);

  useEffect(() => {
    if (fileStoreIds.length === 0) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const { token } = apiClient.getAuth();
        const qs = new URLSearchParams({ tenantId: CITY_TENANT, fileStoreIds: fileStoreIds.join(',') });
        const res = await fetch(`${getApiBaseUrl()}/filestore/v1/files/url?${qs.toString()}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) return;
        const data = await res.json();
        const map: Record<string, string> = {};
        if (Array.isArray(data.fileStoreIds) && Array.isArray(data.urlList)) {
          data.fileStoreIds.forEach((id: string, i: number) => {
            map[id] = data.urlList[i];
          });
        } else if (data.fileStoreUrls) {
          // Newer response shape — { fileStoreUrls: { id: url, ... } }
          Object.assign(map, data.fileStoreUrls);
        }
        if (!cancelled) setUrls(map);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fileStoreIds.join(',')]);

  return { urls, isLoading };
}

function ServiceLabel({ code }: { code: string }) {
  const { tree } = useServiceDefs();
  for (const p of tree) {
    if (p.serviceCode === code) return <>{p.name}</>;
    const c = p.children.find((c) => c.serviceCode === code);
    if (c) return <>{p.name} · {c.name}</>;
  }
  return <>{code}</>;
}

function ShowBody() {
  const { record, isPending, error } = useShowContext<Complaint>();
  const photoIds = record?.photos ?? [];
  const { urls: photoUrls } = usePhotoUrls(photoIds);

  if (isPending) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground text-sm py-8">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading complaint…
      </div>
    );
  }
  if (error || !record) {
    return (
      <Card className="p-6">
        <div className="text-sm text-destructive">
          Couldn't load this complaint.
        </div>
      </Card>
    );
  }

  const created = new Date(record.createdTime).toLocaleString();
  const updated = record.lastModifiedTime
    ? new Date(record.lastModifiedTime).toLocaleString()
    : null;
  const hasLocation = record.latitude != null && record.longitude != null;
  const timeline = record.workflow?.processInstances ?? [];

  return (
    <div className="space-y-5">
      {/* Summary */}
      <Card>
        <CardContent className="p-5 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <div className="text-xs text-muted-foreground font-mono">{record.serviceRequestId}</div>
              <h1 className="text-xl font-semibold mt-1">
                <ServiceLabel code={record.serviceCode} />
              </h1>
            </div>
            <StatusPill status={record.applicationStatus} />
          </div>
          {record.description && (
            <p className="text-sm text-foreground/90 whitespace-pre-wrap">{record.description}</p>
          )}
          <div className="text-xs text-muted-foreground flex flex-wrap gap-x-4">
            <span>Filed: {created}</span>
            {updated && updated !== created && <span>Last update: {updated}</span>}
          </div>
        </CardContent>
      </Card>

      {/* Location */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Location</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {record.locality && <div className="text-sm"><span className="text-muted-foreground">Locality: </span>{record.locality}</div>}
          {record.landmark && <div className="text-sm"><span className="text-muted-foreground">Landmark: </span>{record.landmark}</div>}
          {hasLocation ? (
            <ComplaintMap mode="view" lat={record.latitude} lng={record.longitude} />
          ) : (
            <p className="text-sm text-muted-foreground">No coordinates captured for this complaint.</p>
          )}
        </CardContent>
      </Card>

      {/* Photos */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Photos</CardTitle>
        </CardHeader>
        <CardContent>
          {photoIds.length === 0 ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <ImageOff className="h-4 w-4" />
              No photos attached.
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {photoIds.map((id) => {
                const url = photoUrls[id];
                return (
                  <a
                    key={id}
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block rounded-md overflow-hidden border bg-muted aspect-square"
                  >
                    {url ? (
                      <img
                        src={url}
                        alt="Complaint attachment"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs">
                        loading…
                      </div>
                    )}
                  </a>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Timeline */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Timeline</CardTitle>
        </CardHeader>
        <CardContent>
          {timeline.length === 0 ? (
            <p className="text-sm text-muted-foreground">No status updates yet.</p>
          ) : (
            <ol className="space-y-4">
              {timeline.map((inst, i) => (
                <li key={i} className="flex gap-3">
                  <div className="relative flex-shrink-0 mt-1">
                    <div
                      className={cn(
                        'h-3 w-3 rounded-full border-2',
                        i === 0 ? 'bg-primary border-primary' : 'bg-background border-muted-foreground/50',
                      )}
                    />
                    {i < timeline.length - 1 && (
                      <div className="absolute top-3 left-1/2 -translate-x-1/2 h-full w-px bg-muted-foreground/30" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0 pb-2">
                    <div className="text-sm font-medium">{inst.state?.state ?? inst.action ?? 'Update'}</div>
                    {inst.assignee?.name && (
                      <div className="text-xs text-muted-foreground">Assignee: {inst.assignee.name}</div>
                    )}
                    {inst.comment && <div className="text-xs text-foreground/80 mt-0.5">"{inst.comment}"</div>}
                    {inst.auditDetails?.createdTime && (
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {new Date(inst.auditDetails.createdTime).toLocaleString()}
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function CitizenComplaintShowPage() {
  const { id } = useParams();
  if (!id) return null;

  return (
    <div className="max-w-3xl">
      <div className="mb-4">
        <Button asChild variant="ghost" size="sm">
          <Link to="/complaints">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back to My Complaints
          </Link>
        </Button>
      </div>
      <ShowBase resource="complaints" id={id}>
        <ShowBody />
      </ShowBase>
    </div>
  );
}
