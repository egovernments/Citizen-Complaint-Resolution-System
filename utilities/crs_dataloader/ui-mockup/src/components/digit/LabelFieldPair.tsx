import React from 'react';
import { cn } from '@/lib/utils';

interface LabelFieldPairProps {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

const LabelFieldPair: React.FC<LabelFieldPairProps> = ({ children, className, style }) => {
  return (
    <div
      className={cn(
        'flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-0',
        className
      )}
      style={style}
    >
      {children}
    </div>
  );
};

interface CardLabelProps {
  children: React.ReactNode;
  className?: string;
  required?: boolean;
}

const CardLabel: React.FC<CardLabelProps> = ({ children, className, required }) => {
  return (
    <label
      className={cn(
        'text-[19px] text-foreground font-medium mb-2 sm:mb-0 sm:w-[30%] sm:flex-shrink-0',
        className
      )}
    >
      {children}
      {required && <span className="text-destructive ml-1">*</span>}
    </label>
  );
};

interface FieldProps {
  children: React.ReactNode;
  className?: string;
}

const Field: React.FC<FieldProps> = ({ children, className }) => {
  return (
    <div className={cn('sm:w-[50%] sm:mr-[20%]', className)}>
      {children}
    </div>
  );
};

export { LabelFieldPair, CardLabel, Field };
