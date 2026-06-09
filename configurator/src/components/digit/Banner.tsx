import React from 'react';
import { cn } from '@/lib/utils';
import { CheckCircle, XCircle } from 'lucide-react';

interface BannerProps {
  successful: boolean;
  message: string;
  info?: string;
  applicationNumber?: string;
  className?: string;
}

const Banner: React.FC<BannerProps> = ({
  successful,
  message,
  info,
  applicationNumber,
  className,
}) => {
  return (
    <div
      className={cn(
        'text-center p-6 sm:p-8 rounded',
        successful ? 'bg-success/10' : 'bg-destructive/10',
        className
      )}
    >
      <div className="flex justify-center mb-4">
        {successful ? (
          <CheckCircle className="w-16 h-16 sm:w-20 sm:h-20 text-success" />
        ) : (
          <XCircle className="w-16 h-16 sm:w-20 sm:h-20 text-destructive" />
        )}
      </div>
      <h2
        className={cn(
          'text-xl sm:text-2xl font-bold mb-2',
          successful ? 'text-success' : 'text-destructive'
        )}
      >
        {message}
      </h2>
      {info && (
        <p className="text-muted-foreground text-base sm:text-lg mb-2">{info}</p>
      )}
      {applicationNumber && (
        <p className="text-foreground text-lg sm:text-xl font-semibold">
          {applicationNumber}
        </p>
      )}
    </div>
  );
};

export { Banner };
