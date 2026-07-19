import React from 'react';
import { CreateBase, useCreateContext, Form, useResourceContext, useRedirect, type TransformData, type RaRecord } from 'ra-core';
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

/** Pull a human-facing label off a just-created record for the toast copy. */
function pickRecordLabel(data: RaRecord | undefined): string {
  if (!data) return 'Record';
  const rec = data as unknown as Record<string, unknown>;
  for (const key of ['name', 'code', 'userName', 'id']) {
    const v = rec[key];
    if (typeof v === 'string' && v.trim()) return v;
  }
  return 'Record';
}

/** Prettify a resource name for toast copy: 'boundary-hierarchies' → 'Boundary hierarchy'. */
function prettyResourceSingular(resource: string | undefined): string {
  if (!resource) return 'Record';
  const head = resource.replace(/-/g, ' ').replace(/s$/, '');
  return head.charAt(0).toUpperCase() + head.slice(1);
}

export interface DigitCreateProps {
  /** Page title */
  title?: string;
  /** Form fields (DigitFormInput components) */
  children: React.ReactNode;
  /** Resource name (optional, from ResourceContext by default) */
  resource?: string;
  /** Default values for the new record */
  record?: Record<string, unknown>;
  /** Where to redirect after successful creation (default: "list") */
  redirect?: 'list' | 'edit' | 'show' | false;
  /** Optional pre-submit transform (stamp server-required nested fields, etc.) */
  transform?: TransformData;
  /** Optional post-success side-effect — e.g. seed dependent localization
   *  rows for the new record. Runs after create succeeds, before the
   *  redirect. Failures are caught + surfaced as a toast; the redirect
   *  still fires so the operator isn't stranded on the create form. */
  afterCreate?: (data: RaRecord) => void | Promise<void>;
}

function DigitCreateContent({
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
  const { saving, defaultTitle } = useCreateContext();
  const navigate = useNavigate();

  const displayTitle = title || defaultTitle || 'Create';

  const handleBack = () => {
    navigate(-1);
  };

  const handleCancel = () => {
    navigate(-1);
  };

  return (
    <div className="space-y-4">
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

      <DigitCard className="max-w-none">
        <MutationErrorBanner info={errorInfo} onDismiss={onDismissError} />
        {/* mode="onChange": ra-core's <Form> defaults to react-hook-form's
            "onSubmit" mode, which leaves fieldState.invalid unset (and thus
            no red/error styling) until the first submit attempt. */}
        <Form mode="onChange">
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
              Create
            </Button>
          </ActionBar>
        </Form>
      </DigitCard>
    </div>
  );
}

export function DigitCreate({ title, children, resource, record, redirect = 'list', transform, afterCreate }: DigitCreateProps) {
  const { info, capture, clear } = useMutationError();
  const contextResource = useResourceContext();
  const redirectTo = useRedirect();
  const effectiveResource = resource ?? contextResource;
  return (
    <CreateBase
      resource={resource}
      record={record}
      // Don't pass `redirect` to CreateBase — when `mutationOptions.onSuccess`
      // is provided, ra-core treats it as a full override of the default
      // post-create handler and skips its built-in redirect step. We need
      // the toast (next block) AND the redirect, so we drive the redirect
      // ourselves from inside onSuccess.
      transform={transform}
      mutationOptions={{
        onError: (err) => capture(err),
        onSuccess: async (data) => {
          clear();
          // Without a toast the page silently redirects to list — operators
          // have no way to tell a 200 apart from a quietly-swallowed 500
          // (closes egovernments/CCRS#436 second half).
          const label = pickRecordLabel(data);
          toast({
            title: `${prettyResourceSingular(effectiveResource)} created`,
            description: label !== 'Record' ? label : undefined,
          });
          // Run any per-resource post-create side-effect (e.g. seeding
          // localization rows for the new record). Errors don't block the
          // redirect — the record itself was saved successfully, so the
          // operator should still land on the list view and can re-run
          // the side-effect manually if needed.
          if (afterCreate && data) {
            try {
              await afterCreate(data as RaRecord);
            } catch (e) {
              toast({
                title: 'Post-create step failed',
                description: e instanceof Error ? e.message : String(e),
                variant: 'destructive',
              });
            }
          }
          // Manually fire the redirect since our custom onSuccess swallows
          // ra-core's default redirect side-effect. Without this the form
          // stayed populated after a successful create, leaving operators
          // confused about whether the submit actually went through
          // (closes egovernments/CCRS#471).
          if (redirect && effectiveResource) {
            redirectTo(redirect, effectiveResource, (data as RaRecord | undefined)?.id, data as RaRecord | undefined);
          }
        },
      }}
    >
      <DigitCreateContent title={title} errorInfo={info} onDismissError={clear}>
        {children}
      </DigitCreateContent>
    </CreateBase>
  );
}
