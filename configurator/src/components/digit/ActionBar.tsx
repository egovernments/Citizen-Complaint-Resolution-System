import React from 'react';
import { cn } from '@/lib/utils';

interface ActionBarProps {
  children: React.ReactNode;
  className?: string;
}

const ActionBar: React.FC<ActionBarProps> = ({ children, className }) => {
  return (
    <div
      className={cn(
        'flex flex-col sm:flex-row gap-3 sm:gap-4 items-stretch sm:items-center justify-end',
        'pt-4 mt-4 border-t border-border',
        className
      )}
    >
      {children}
    </div>
  );
};

export { ActionBar };
