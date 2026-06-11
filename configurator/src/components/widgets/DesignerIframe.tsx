import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ExternalLink, RefreshCw, Save } from 'lucide-react';

interface DesignerIframeProps {
  /** Workflow JSON to send to the designer once it's ready. */
  workflow: unknown;
  /** Called when the designer posts back a `save-workflow` message. */
  onSave?: (workflow: unknown) => void;
  /** Optional designer URL override. Defaults to `import.meta.env.VITE_DESIGNER_URL`
   *  or `/designer/`. */
  url?: string;
  className?: string;
}

/**
 * Embeds the workflow designer SPA (lives at `workflow.egov.theflywheel.in/designer/`
 * or, per server, at `<host>/designer/`) and bridges it with the configurator
 * via `postMessage`.
 *
 * Protocol:
 *   1. We mount the iframe.
 *   2. Designer sends `{ type: 'designer-ready' }` once initialized.
 *   3. We reply with `{ type: 'load-workflow', workflow }`.
 *   4. When the operator clicks Save in the designer, it sends
 *      `{ type: 'save-workflow', workflow }`. We surface that to onSave.
 *
 * Security: every inbound message is checked against an origin allowlist so
 * a malicious page can't push a tampered workflow. The allowlist is the
 * iframe URL's origin plus the current window origin (for same-origin
 * `/designer/` deploys).
 */
export function DesignerIframe({ workflow, onSave, url, className }: DesignerIframeProps) {
  const designerUrl = useMemo(() => {
    const envUrl = (import.meta.env.VITE_DESIGNER_URL as string | undefined) ?? '';
    return url ?? envUrl ?? '/designer/';
  }, [url]);

  const allowedOrigins = useMemo(() => {
    const set = new Set<string>();
    try {
      const u = new URL(designerUrl, window.location.href);
      set.add(u.origin);
    } catch { /* swallow */ }
    set.add(window.location.origin);
    return set;
  }, [designerUrl]);

  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [ready, setReady] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Push the current workflow whenever the designer reports ready or the
  // workflow input changes (so deep links / record refreshes are honored).
  useEffect(() => {
    if (!ready || !iframeRef.current?.contentWindow) return;
    try {
      iframeRef.current.contentWindow.postMessage(
        { type: 'load-workflow', workflow },
        '*', // We don't know the exact origin until after handshake. The
             // receiving end should also validate origin.
      );
    } catch (e) {
      setError(`Failed to post workflow: ${(e as Error).message}`);
    }
  }, [ready, workflow]);

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (!allowedOrigins.has(event.origin)) {
        // Silently drop — but keep noisy enough that devs notice during integration.
        // eslint-disable-next-line no-console
        console.debug('[DesignerIframe] rejected message from', event.origin);
        return;
      }
      const data = event.data;
      if (!data || typeof data !== 'object' || typeof data.type !== 'string') return;
      if (data.type === 'designer-ready') {
        setReady(true);
        setError(null);
      } else if (data.type === 'save-workflow') {
        setLastSavedAt(new Date());
        try {
          onSave?.(data.workflow);
        } catch (e) {
          setError(`onSave threw: ${(e as Error).message}`);
        }
      } else if (data.type === 'designer-error') {
        setError(typeof data.message === 'string' ? data.message : 'Designer reported an error');
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [allowedOrigins, onSave]);

  const reload = () => {
    setReady(false);
    if (iframeRef.current) {
      // Force a fresh load — works around designers that cache state.
      iframeRef.current.src = iframeRef.current.src;
    }
  };

  return (
    <div className={`flex flex-col rounded border border-border bg-background ${className ?? ''}`}>
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className={`inline-block w-2 h-2 rounded-full ${ready ? 'bg-green-500' : 'bg-amber-400'}`} />
          {ready ? 'Designer ready' : 'Loading designer...'}
          {lastSavedAt && <span className="ml-2">— last save {lastSavedAt.toLocaleTimeString()}</span>}
        </div>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={reload}
            aria-label="reload designer"
            className="h-7 w-7 p-0"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => window.open(designerUrl, '_blank', 'noopener')}
            aria-label="open in new tab"
            className="h-7 w-7 p-0"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>
      {error && (
        <div className="px-3 py-2 text-xs text-destructive border-b border-destructive/30 bg-destructive/5">
          <Save className="w-3.5 h-3.5 inline mr-1" />
          {error}
        </div>
      )}
      <iframe
        ref={iframeRef}
        src={designerUrl}
        title="Workflow designer"
        // sandbox kept permissive enough for the designer to run a full SPA,
        // but locked down from top-navigation hijacking.
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads"
        className="w-full flex-1 min-h-[600px] border-0"
      />
    </div>
  );
}
