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
  /** Full value — shown in the tooltip and copied to the clipboard. */
  value: string;
  /** Max characters shown before the label is shortened with an ellipsis. */
  maxChars?: number;
  /** Extra classes on the wrapper (size, color, etc.). */
  className?: string;
  /** Render the copy button (default true). */
  showCopy?: boolean;
}

/**
 * A monospace code that shortens long values with an ellipsis, reveals the FULL
 * value in a tooltip on hover, and (optionally) copies the full value.
 *
 * Truncation is done on the string (not via CSS `truncate`) because CSS
 * ellipsis doesn't work inside auto-layout table cells — there the cell just
 * grows to the content, so nothing actually gets shortened and the tooltip ends
 * up identical to the visible text.
 */
export function CopyableCode({
  value,
  maxChars = 24,
  className,
  showCopy = true,
}: CopyableCodeProps) {
  const [copied, setCopied] = useState(false);

  const display =
    value.length > maxChars ? `${value.slice(0, maxChars - 1).trimEnd()}…` : value;
  const isShortened = display !== value;

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
    <span className={cn('inline-flex items-center gap-1 max-w-full', className)}>
      {isShortened ? (
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="font-mono">{display}</span>
            </TooltipTrigger>
            <TooltipContent className="max-w-[min(90vw,28rem)]">
              {/* Codes have no spaces; break-all lets long ones wrap instead of
                  rendering one ultra-wide line that the tooltip clips. */}
              <span className="font-mono break-all">{value}</span>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : (
        <span className="font-mono">{display}</span>
      )}
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
