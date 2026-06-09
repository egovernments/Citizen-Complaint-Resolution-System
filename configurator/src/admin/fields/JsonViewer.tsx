import { useState } from 'react';
import { ChevronDown, ChevronRight, Copy, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface JsonViewerProps {
  data: unknown;
  initialExpanded?: boolean;
}

export function JsonViewer({ data, initialExpanded = true }: JsonViewerProps) {
  const [expanded, setExpanded] = useState(initialExpanded);
  const [copied, setCopied] = useState(false);
  const jsonStr = JSON.stringify(data, null, 2);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(jsonStr);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="border border-border rounded-md">
      <div className="flex items-center justify-between px-3 py-1.5 bg-muted/30 border-b border-border">
        <button onClick={() => setExpanded(!expanded)} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          JSON
        </button>
        <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={handleCopy}>
          {copied ? <Check className="w-3 h-3 text-green-600" /> : <Copy className="w-3 h-3" />}
        </Button>
      </div>
      {expanded && (
        <pre className="p-3 text-xs font-mono overflow-auto max-h-96 text-foreground">{jsonStr}</pre>
      )}
    </div>
  );
}
