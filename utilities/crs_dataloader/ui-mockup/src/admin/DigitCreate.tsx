import React from 'react';
import { CreateBase, useCreateContext, Form } from 'ra-core';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Save, RefreshCw } from 'lucide-react';
import { DigitCard } from '@/components/digit/DigitCard';
import { ActionBar } from '@/components/digit/ActionBar';
import { Button } from '@/components/ui/button';

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
}

function DigitCreateContent({
  title,
  children,
}: {
  title?: string;
  children: React.ReactNode;
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
              Create
            </Button>
          </ActionBar>
        </Form>
      </DigitCard>
    </div>
  );
}

export function DigitCreate({ title, children, resource, record, redirect = 'list' }: DigitCreateProps) {
  return (
    <CreateBase resource={resource} record={record} redirect={redirect}>
      <DigitCreateContent title={title}>{children}</DigitCreateContent>
    </CreateBase>
  );
}
