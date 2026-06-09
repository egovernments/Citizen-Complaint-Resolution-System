import React from 'react';
import { EditBase, useEditContext, Form, useResourceContext, useRedirect, type TransformData, type RaRecord } from 'ra-core';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Save, RefreshCw } from 'lucide-react';
import { DigitCard } from '@/components/digit/DigitCard';
import { ActionBar } from '@/components/digit/ActionBar';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';
import {
  useMutationError,
  MutationErrorBanner,
  type MutationErrorInfo,
} from './mutationError';

function pickRecordLabel(data: RaRecord | undefined): string {
  if (!data) return 'Record';
  const rec = data as unknown as Record<string, unknown>;
  for (const key of ['name', 'code', 'userName', 'id']) {
    const v = rec[key];
    if (typeof v === 'string' && v.trim()) return v;
  }
  return 'Record';
}

function prettyResourceSingular(resource: string | undefined): string {
  if (!resource) return 'Record';
  const head = resource.replace(/-/g, ' ').replace(/s$/, '');
  return head.charAt(0).toUpperCase() + head.slice(1);
}

export interface DigitEditProps {
  /** Page title */
  title?: string;
  /** Form fields (DigitFormInput components) */
  children: React.ReactNode;
  /** Resource name (optional, from ResourceContext by default) */
  resource?: string;
  /** Record id (optional, from URL by default) */
  id?: string | number;
  /** Where to redirect after successful update (default: "list") */
  redirect?: 'list' | 'edit' | 'show' | false;
  /** Optional pre-submit transform */
  transform?: TransformData;
}

function DigitEditContent({
  title,
  children,
  errorInfo,
  onDismissError,
}: {
  title?: string;
  children: React.ReactNode;
  errorInfo: MutationErrorInfo | null;
  onDismissError: () => void;
}) {
  const { record, isPending, saving, error, defaultTitle, refetch } =
    useEditContext();
  const navigate = useNavigate();

  const displayTitle = title || defaultTitle || 'Edit';

  const handleBack = () => {
    navigate(-1);
  };

  const handleCancel = () => {
    navigate(-1);
  };

  if (isPending) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={handleBack} className="gap-1.5">
            <ArrowLeft className="w-4 h-4" />
            Back
          </Button>
        </div>
        <DigitCard className="max-w-none">
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <RefreshCw className="w-5 h-5 animate-spin mr-2" />
            Loading...
          </div>
        </DigitCard>
      </div>
    );
  }

  if (error && !record) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={handleBack} className="gap-1.5">
            <ArrowLeft className="w-4 h-4" />
            Back
          </Button>
        </div>
        <DigitCard className="max-w-none">
          <div className="text-center py-12">
            <p className="text-destructive font-medium">Error loading record</p>
            <p className="text-sm text-muted-foreground mt-1">
              {error instanceof Error ? error.message : 'An unexpected error occurred'}
            </p>
            <Button variant="outline" size="sm" onClick={() => refetch()} className="mt-3">
              Try again
            </Button>
          </div>
        </DigitCard>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={handleBack} className="gap-1.5">
          <ArrowLeft className="w-4 h-4" />
          Back
        </Button>
        <h1 className="text-2xl sm:text-3xl font-bold font-condensed text-foreground">
          {displayTitle}
        </h1>
        {saving && (
          <RefreshCw className="w-4 h-4 animate-spin text-muted-foreground" />
        )}
      </div>

      {/* Form card */}
      <DigitCard className="max-w-none">
        <MutationErrorBanner info={errorInfo} onDismiss={onDismissError} />
        <Form>
          <div className="space-y-4">
            {children}
          </div>

          <ActionBar>
            <Button
              type="button"
              variant="outline"
              onClick={handleCancel}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving} className="gap-1.5">
              {saving ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <Save className="w-4 h-4" />
              )}
              Save
            </Button>
          </ActionBar>
        </Form>
      </DigitCard>
    </div>
  );
}

export function DigitEdit({ title, children, resource, id, redirect = 'list', transform }: DigitEditProps) {
  const { info, capture, clear } = useMutationError();
  const contextResource = useResourceContext();
  const redirectTo = useRedirect();
  const effectiveResource = resource ?? contextResource;
  return (
    <EditBase
      resource={resource}
      id={id}
      mutationMode="pessimistic"
      // See note in DigitCreate: ra-core treats a custom mutationOptions.onSuccess
      // as a full override of its post-update handler and silently drops the
      // built-in redirect. Drive the redirect ourselves from inside onSuccess.
      transform={transform}
      mutationOptions={{
        onError: (err) => capture(err),
        onSuccess: (data) => {
          clear();
          const label = pickRecordLabel(data);
          toast({
            title: `${prettyResourceSingular(effectiveResource)} updated`,
            description: label !== 'Record' ? label : undefined,
          });
          if (redirect && effectiveResource) {
            redirectTo(redirect, effectiveResource, (data as RaRecord | undefined)?.id, data as RaRecord | undefined);
          }
        },
      }}
    >
      <DigitEditContent title={title} errorInfo={info} onDismissError={clear}>
        {children}
      </DigitEditContent>
    </EditBase>
  );
}
