import React from 'react';
import { cn } from '@/lib/utils';
import { X } from 'lucide-react';

interface ToastProps {
  label: string;
  type?: 'success' | 'error' | 'info';
  onClose?: () => void;
  className?: string;
}

const Toast: React.FC<ToastProps> = ({ label, type = 'info', onClose, className }) => {
  const bgColor = {
    success: 'bg-success text-white',
    error: 'bg-destructive text-white',
    info: 'bg-secondary text-white',
  };

  return (
    <div
      className={cn(
        'fixed bottom-4 left-4 right-4 sm:left-auto sm:right-4 sm:max-w-md',
        'flex items-center justify-between gap-4 p-4 rounded shadow-lg z-50',
        bgColor[type],
        className
      )}
      role="alert"
    >
      <span className="text-sm font-medium">{label}</span>
      {onClose && (
        <button
          onClick={onClose}
          className="flex-shrink-0 hover:opacity-80"
          aria-label="Close"
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
};

export { Toast };
