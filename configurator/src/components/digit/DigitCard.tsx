import React from 'react';
import { cn } from '@/lib/utils';

interface DigitCardProps {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

const DigitCard: React.FC<DigitCardProps> = ({ children, className, style }) => {
  return (
    <div
      className={cn(
        'bg-card rounded shadow-card p-4 sm:p-6 mb-4',
        'max-w-[960px]',
        className
      )}
      style={style}
    >
      {children}
    </div>
  );
};

interface CardHeaderProps {
  children: React.ReactNode;
  className?: string;
}

const DigitCardHeader: React.FC<CardHeaderProps> = ({ children, className }) => {
  return (
    <h2
      className={cn(
        'text-foreground text-2xl sm:text-3xl font-bold font-condensed mb-4',
        className
      )}
    >
      {children}
    </h2>
  );
};

interface CardSubHeaderProps {
  children: React.ReactNode;
  className?: string;
}

const DigitCardSubHeader: React.FC<CardSubHeaderProps> = ({ children, className }) => {
  return (
    <h3
      className={cn(
        'text-foreground text-lg sm:text-xl font-bold mb-2',
        className
      )}
    >
      {children}
    </h3>
  );
};

interface CardTextProps {
  children: React.ReactNode;
  className?: string;
}

const DigitCardText: React.FC<CardTextProps> = ({ children, className }) => {
  return (
    <p
      className={cn(
        'text-muted-foreground text-base sm:text-lg mb-4',
        className
      )}
    >
      {children}
    </p>
  );
};

export { DigitCard, DigitCardHeader, DigitCardSubHeader, DigitCardText };
