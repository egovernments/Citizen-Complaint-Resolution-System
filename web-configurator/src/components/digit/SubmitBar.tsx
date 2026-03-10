import React from 'react';
import { cn } from '@/lib/utils';

interface SubmitBarProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  onSubmit?: () => void;
  icon?: React.ReactNode;
}

const SubmitBar = React.forwardRef<HTMLButtonElement, SubmitBarProps>(
  ({ label, onSubmit, disabled, className, icon, ...props }, ref) => {
    return (
      <button
        ref={ref}
        type="button"
        disabled={disabled}
        className={cn(
          'h-10 bg-primary text-center w-full sm:w-60 outline-none cursor-pointer',
          'font-condensed font-medium text-[19px] text-primary-foreground leading-10',
          'shadow-[inset_0px_-2px_0px_#0B0C0C]',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          className
        )}
        onClick={onSubmit}
        {...props}
      >
        <span className="flex items-center justify-center gap-2">
          {label}
          {icon}
        </span>
      </button>
    );
  }
);

SubmitBar.displayName = 'SubmitBar';

export { SubmitBar };
