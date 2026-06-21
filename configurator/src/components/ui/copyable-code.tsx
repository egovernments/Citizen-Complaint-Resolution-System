import { useState, type MouseEvent } from 'react';
import { Copy, Check } from 'lucide-react';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

interface CopyableCodeProps {
  /** The code string to display, truncate, reveal on hover, and copy. */
  value: string;
  /** Extra classes on the wrapper — set width (e.g. `max-w-[200px]`), size, color. */
  className?: string;
  /** Render the copy button (default true). */
  showCopy?: boolean;
}

/**
 * A monospace code that truncates to its container with an ellipsis, reveals the
 * full value in a tooltip on hover, and (optionally) offers a one-click copy.
 * Font size and color are inherited from `className` so callers can theme it.
 */
export function CopyableCode({ value, className, showCopy = true }: CopyableCodeProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e: MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable (e.g. insecure context) — fail silently.
    }
  };

  return (
    <span className={cn('inline-flex items-center gap-1 min-w-0 max-w-full', className)}>
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="min-w-0 truncate font-mono">{value}</span>
          </TooltipTrigger>
          <TooltipContent>
            <span className="font-mono">{value}</span>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      {showCopy && (
        <button
          type="button"
          aria-label={`Copy ${value}`}
          onClick={handleCopy}
          className="flex-shrink-0 text-muted-foreground hover:text-foreground"
        >
          {copied ? (
            <Check className="h-3 w-3 text-green-600" />
          ) : (
            <Copy className="h-3 w-3" />
          )}
        </button>
      )}
    </span>
  );
}
