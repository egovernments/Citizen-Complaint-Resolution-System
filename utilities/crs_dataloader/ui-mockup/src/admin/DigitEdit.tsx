import React from 'react';
import { EditBase, useEditContext, Form } from 'ra-core';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Save, RefreshCw } from 'lucide-react';
import { DigitCard } from '@/components/digit/DigitCard';
import { ActionBar } from '@/components/digit/ActionBar';
import { Button } from '@/components/ui/button';

export interface DigitEditProps {
  /** Page title */
  title?: string;
  /** Form fields (DigitFormInput components) */
  children: React.ReactNode;
  /** Resource name (optional, from ResourceContext by default) */
  resource?: string;
  /** Record id (optional, from URL by default) */
  id?: string | number;
}

function DigitEditContent({
  title,
  children,
}: {
  title?: string;
  children: React.ReactNode;
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

export function DigitEdit({ title, children, resource, id }: DigitEditProps) {
  return (
    <EditBase resource={resource} id={id} mutationMode="pessimistic">
      <DigitEditContent title={title}>{children}</DigitEditContent>
    </EditBase>
  );
}
