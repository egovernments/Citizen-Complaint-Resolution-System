import React from 'react';
import { cn } from '@/lib/utils';

interface HeaderProps {
  children: React.ReactNode;
  className?: string;
}

const Header: React.FC<HeaderProps> = ({ children, className }) => {
  return (
    <h1
      className={cn(
        'text-foreground text-2xl sm:text-4xl font-bold font-condensed mb-4 sm:mb-6',
        className
      )}
    >
      {children}
    </h1>
  );
};

const SubHeader: React.FC<HeaderProps> = ({ children, className }) => {
  return (
    <h2
      className={cn(
        'text-foreground text-xl sm:text-2xl font-bold font-condensed mb-3 sm:mb-4',
        className
      )}
    >
      {children}
    </h2>
  );
};

export { Header, SubHeader };
