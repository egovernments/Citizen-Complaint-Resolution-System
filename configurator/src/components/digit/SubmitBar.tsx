import React from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface SubmitBarProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  onSubmit?: () => void;
  icon?: React.ReactNode;
}

/**
 * A step's main action, drawn with the shared primary Button so onboarding's
 * calls to action match the rest of the app. Full width on a phone.
 */
const SubmitBar = React.forwardRef<HTMLButtonElement, SubmitBarProps>(
  ({ label, onSubmit, disabled, className, icon, ...props }, ref) => {
    return (
      <Button
        ref={ref}
        type="button"
        disabled={disabled}
        className={cn('h-10 w-full sm:w-auto sm:min-w-40 px-5', className)}
        onClick={onSubmit}
        {...props}
      >
        {label}
        {icon}
      </Button>
    );
  }
);

SubmitBar.displayName = 'SubmitBar';

export { SubmitBar };
