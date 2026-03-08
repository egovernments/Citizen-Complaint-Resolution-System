import { DigitShow } from '@/admin';
import { FieldSection, FieldRow, DateField, StatusChip } from '@/admin/fields';
import { EntityLink } from '@/components/ui/EntityLink';
import { useShowController, useGetManyReference } from 'ra-core';
import { Star } from 'lucide-react';

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
    { enabled: !!serviceRequestId }
  );

  if (isPending) return <div className="text-sm text-muted-foreground animate-pulse">Loading timeline...</div>;
  if (!data || data.length === 0) return <div className="text-sm text-muted-foreground">No workflow history</div>;

  return (
    <div className="space-y-3">
      {data.map((process, i) => {
        const p = process as Record<string, unknown>;
        const audit = p.auditDetails as Record<string, unknown> | undefined;
        return (
          <div key={i} className="flex gap-3 items-start">
            <div className="flex flex-col items-center">
              <div className="w-2.5 h-2.5 rounded-full bg-primary mt-1.5" />
              {i < data.length - 1 && <div className="w-0.5 flex-1 bg-border mt-1" />}
            </div>
            <div className="pb-4 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{String(p.action ?? '--')}</span>
                <StatusChip value={p.state} />
              </div>
              {p.comment != null && <p className="text-sm text-muted-foreground mt-1">{String(p.comment)}</p>}
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

export function ComplaintShow() {
  const { record } = useShowController();

  return (
    <DigitShow title={record ? `Complaint: ${record.serviceRequestId ?? record.id}` : 'Complaint'} hasEdit>
      {(rec: Record<string, unknown>) => {
        const citizen = rec.citizen as Record<string, unknown> | undefined;
        const address = rec.address as Record<string, unknown> | undefined;
        const locality = address?.locality as Record<string, unknown> | undefined;
        const audit = rec.auditDetails as Record<string, unknown> | undefined;

        return (
          <div className="space-y-6">
            <FieldSection title="Header">
              <FieldRow label="Request ID">{String(rec.serviceRequestId ?? '')}</FieldRow>
              <FieldRow label="Status"><StatusChip value={rec.applicationStatus} /></FieldRow>
              <FieldRow label="Rating"><RatingStars rating={rec.rating} /></FieldRow>
            </FieldSection>

            <FieldSection title="Details">
              <FieldRow label="Type">
                {rec.serviceCode ? <EntityLink resource="complaint-types" id={String(rec.serviceCode)} /> : '--'}
              </FieldRow>
              <FieldRow label="Description">{String(rec.description ?? '')}</FieldRow>
              <FieldRow label="Source">{String(rec.source ?? '--')}</FieldRow>
            </FieldSection>

            <FieldSection title="Citizen">
              <FieldRow label="Name">{String(citizen?.name ?? '--')}</FieldRow>
              <FieldRow label="Mobile">{String(citizen?.mobileNumber ?? '--')}</FieldRow>
            </FieldSection>

            <FieldSection title="Address">
              <FieldRow label="Locality">
                {locality?.code ? <EntityLink resource="boundaries" id={String(locality.code)} /> : '--'}
              </FieldRow>
              <FieldRow label="City">{String(address?.city ?? '--')}</FieldRow>
            </FieldSection>

            <FieldSection title="Workflow Timeline">
              <WorkflowTimeline
                serviceRequestId={String(rec.serviceRequestId ?? '')}
              />
            </FieldSection>

            <FieldSection title="Audit">
              <FieldRow label="Created"><DateField value={audit?.createdTime} /></FieldRow>
              <FieldRow label="Last Modified"><DateField value={audit?.lastModifiedTime} /></FieldRow>
            </FieldSection>
          </div>
        );
      }}
    </DigitShow>
  );
}
