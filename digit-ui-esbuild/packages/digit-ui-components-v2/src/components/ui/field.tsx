import * as React from "react";
import { cn } from "../../lib/cn";
import { Label } from "./label";

export interface FieldProps {
  /** Visible label text. */
  label?: React.ReactNode;
  /** Helper text shown beneath the field. */
  hint?: React.ReactNode;
  /** Error text — when present, overrides hint and marks the field invalid. */
  error?: React.ReactNode;
  /** Mark the visual asterisk on the label. */
  required?: boolean;
  /** htmlFor target — usually the id of the inner control. */
  htmlFor?: string;
  className?: string;
  children: React.ReactNode;
}

/**
 * Generic form field wrapper — Label + control + hint/error stacked.
 * Use this around <Input>, <Textarea>, <Select>, etc. for consistent spacing.
 */
export function Field({
  label,
  hint,
  error,
  required,
  htmlFor,
  className,
  children,
}: FieldProps) {
  const describedById = hint || error ? `${htmlFor ?? ""}-desc` : undefined;
  return (
    <div className={cn("space-y-2", className)}>
      {label ? (
        <Label htmlFor={htmlFor} required={required}>
          {label}
        </Label>
      ) : null}
      {/*
        Children consume aria-describedby via ...props if passed; for the common
        case we expose describedById as a hint via the id below and rely on the
        consumer to wire aria-describedby manually when needed (most field controls
        don't auto-receive it without a Slot wrapper). The Label still reads first
        in screen-reader order so the error/hint coming after is accessible context.
      */}
      {children}
      {error ? (
        <p id={describedById} className="text-sm text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p id={describedById} className="text-sm text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
