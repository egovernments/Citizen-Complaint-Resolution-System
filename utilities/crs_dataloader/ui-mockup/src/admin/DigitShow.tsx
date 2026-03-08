import React from 'react';
import { useShowController, type ShowControllerProps } from 'ra-core';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Pencil, RefreshCw } from 'lucide-react';
import { DigitCard } from '@/components/digit/DigitCard';
import { Button } from '@/components/ui/button';

export interface DigitShowProps extends ShowControllerProps {
  /** Page title (defaults to the record's defaultTitle from ra-core) */
  title?: string;
  /** Content rendered inside the card */
  children: React.ReactNode | ((record: Record<string, unknown>) => React.ReactNode);
  /** Show an Edit button */
  hasEdit?: boolean;
}

export function DigitShow({
  title,
  children,
  hasEdit = false,
  ...controllerOptions
}: DigitShowProps) {
  const {
    record,
    isPending,
    isFetching,
    error,
    refetch,
    resource,
    defaultTitle,
  } = useShowController(controllerOptions);
  const navigate = useNavigate();

  const displayTitle = title || defaultTitle || 'Detail';

  const handleBack = () => {
    navigate(-1);
  };

  const handleEdit = () => {
    if (record) {
      navigate(`/manage/${resource}/${record.id}/edit`);
    }
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

  if (error) {
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
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={handleBack} className="gap-1.5">
            <ArrowLeft className="w-4 h-4" />
            Back
          </Button>
          <h1 className="text-2xl sm:text-3xl font-bold font-condensed text-foreground">
            {displayTitle}
          </h1>
          {isFetching && (
            <RefreshCw className="w-4 h-4 animate-spin text-muted-foreground" />
          )}
        </div>
        {hasEdit && record && (
          <Button size="sm" onClick={handleEdit} className="gap-1.5">
            <Pencil className="w-4 h-4" />
            Edit
          </Button>
        )}
      </div>

      {/* Content card */}
      <DigitCard className="max-w-none">
        {typeof children === 'function' && record
          ? (children as (record: Record<string, unknown>) => React.ReactNode)(record as Record<string, unknown>)
          : (children as React.ReactNode)}
      </DigitCard>
    </div>
  );
}
