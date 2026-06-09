import { DigitShow } from '@/admin';
import { FieldSection, FieldRow, DateField, StatusChip } from '@/admin/fields';
import { EntityLink } from '@/components/ui/EntityLink';
import { useShowController, useGetManyReference } from 'ra-core';
import { Star, ExternalLink } from 'lucide-react';

function WorkflowTimeline({ serviceRequestId }: { serviceRequestId: string }) {
  const { data, isPending } = useGetManyReference(
    'workflow-processes',
    {
      target: 'businessId',
      id: serviceRequestId,
      pagination: { page: 1, perPage: 50 },
      sort: { field: 'auditDetails.createdTime', order: 'ASC' },
      filter: {},
    },
    { enabled: !!serviceRequestId },
  );

  if (isPending) return <div className="text-sm text-muted-foreground animate-pulse">Loading timeline…</div>;
  if (!data || data.length === 0) return <div className="text-sm text-muted-foreground">No workflow history</div>;

  return (
    <div className="space-y-3">
      {data.map((process, i) => {
        const p = process as Record<string, unknown>;
        const audit = p.auditDetails as Record<string, unknown> | undefined;
        const state = typeof p.state === 'object' ? (p.state as Record<string, unknown>)?.state : p.state;
        return (
          <div key={i} className="flex gap-3 items-start">
            <div className="flex flex-col items-center">
              <div className="w-2.5 h-2.5 rounded-full bg-primary mt-1.5" />
              {i < data.length - 1 && <div className="w-0.5 flex-1 bg-border mt-1" />}
            </div>
            <div className="pb-4 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{String(p.action ?? '--')}</span>
                <StatusChip value={state} />
              </div>
              {p.comment != null && (
                <p className="text-sm text-muted-foreground mt-1">{String(p.comment)}</p>
              )}
              <div className="text-xs text-muted-foreground mt-1">
                <DateField value={audit?.createdTime} />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function RatingStars({ rating }: { rating: unknown }) {
  const numRating = Number(rating);
  if (!numRating || numRating < 1) return <span className="text-muted-foreground">Not rated</span>;
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((star) => (
        <Star
          key={star}
          className={`w-4 h-4 ${star <= numRating ? 'text-yellow-500 fill-yellow-500' : 'text-gray-300'}`}
        />
      ))}
    </div>
  );
}

function GeoLocationLink({ lat, lng }: { lat: unknown; lng: unknown }) {
  const latN = Number(lat);
  const lngN = Number(lng);
  if (!Number.isFinite(latN) || !Number.isFinite(lngN) || (latN === 0 && lngN === 0)) {
    return <span className="text-muted-foreground">--</span>;
  }
  return (
    <a
      href={`https://www.google.com/maps?q=${latN},${lngN}`}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-primary hover:underline"
    >
      {latN.toFixed(6)}, {lngN.toFixed(6)}
      <ExternalLink className="w-3 h-3" />
    </a>
  );
}

export function ComplaintShow() {
  const { record } = useShowController();

  return (
    <DigitShow title={record ? `Complaint: ${record.serviceRequestId ?? record.id}` : 'Complaint'} hasEdit>
      {(rec: Record<string, unknown>) => {
        const citizen = rec.citizen as Record<string, unknown> | undefined;
        const address = rec.address as Record<string, unknown> | undefined;
        const locality = address?.locality as Record<string, unknown> | undefined;
        const geo = address?.geoLocation as Record<string, unknown> | undefined;
        const audit = rec.auditDetails as Record<string, unknown> | undefined;
        const additional = rec.additionalDetail as Record<string, unknown> | undefined;

        return (
          <div className="space-y-6">
            <FieldSection title="Header">
              <FieldRow label="Request ID">{String(rec.serviceRequestId ?? '')}</FieldRow>
              <FieldRow label="Status">
                <StatusChip value={rec.applicationStatus} />
              </FieldRow>
              <FieldRow label="Rating">
                <RatingStars rating={rec.rating} />
              </FieldRow>
            </FieldSection>

            <FieldSection title="Details">
              <FieldRow label="Type">
                {rec.serviceCode ? (
                  <EntityLink resource="complaint-types" id={String(rec.serviceCode)} />
                ) : (
                  '--'
                )}
              </FieldRow>
              <FieldRow label="Department">
                {additional?.department ? (
                  <EntityLink resource="departments" id={String(additional.department)} />
                ) : (
                  <span className="text-muted-foreground">--</span>
                )}
              </FieldRow>
              <FieldRow label="Description">{String(rec.description ?? '')}</FieldRow>
              <FieldRow label="Source">{String(rec.source ?? '--')}</FieldRow>
            </FieldSection>

            <FieldSection title="Citizen">
              <FieldRow label="Name">
                {(() => {
                  const name = citizen?.name ? String(citizen.name) : '';
                  const mobile = citizen?.mobileNumber ? String(citizen.mobileNumber) : '';
                  if (!name) return <span className="text-muted-foreground">--</span>;
                  // When the citizen registered via mobile-only OTP, the
                  // user-service sets `name = mobileNumber`. Flag that so
                  // operators don't mistake a phone number for a real name.
                  if (name === mobile) {
                    return (
                      <span>
                        {name}{' '}
                        <span className="text-xs text-muted-foreground">(mobile-only account)</span>
                      </span>
                    );
                  }
                  return name;
                })()}
              </FieldRow>
              <FieldRow label="Mobile">{String(citizen?.mobileNumber ?? '--')}</FieldRow>
            </FieldSection>

            <FieldSection title="Address">
              <FieldRow label="Locality">
                {locality?.code ? (
                  <EntityLink resource="boundaries" id={String(locality.code)} />
                ) : (
                  '--'
                )}
              </FieldRow>
              <FieldRow label="Landmark">{String(address?.landmark ?? '--')}</FieldRow>
              <FieldRow label="Street">{String(address?.street ?? '--')}</FieldRow>
              <FieldRow label="Pincode">{String(address?.pincode ?? '--')}</FieldRow>
              <FieldRow label="Geo">
                <GeoLocationLink lat={geo?.latitude} lng={geo?.longitude} />
              </FieldRow>
            </FieldSection>

            <FieldSection title="Workflow Timeline">
              <WorkflowTimeline serviceRequestId={String(rec.serviceRequestId ?? '')} />
            </FieldSection>

            <FieldSection title="Audit">
              <FieldRow label="Created">
                <DateField value={audit?.createdTime} />
              </FieldRow>
              <FieldRow label="Last Modified">
                <DateField value={audit?.lastModifiedTime} />
              </FieldRow>
            </FieldSection>
          </div>
        );
      }}
    </DigitShow>
  );
}
