/** Live preview pane (P4a, CCSD-2009).
 *
 * Embeds the PRODUCTION landing page (same bundle, same renderer, same CSS) at
 * /<contextPath>/landing?builderPreview=1 and drives it over a same-origin
 * postMessage bridge: waits for the page's `pgrl-preview-ready` handshake,
 * then pushes the draft config (debounced) on every change and a scroll
 * command when the selection changes. Nothing is persisted through this path.
 */
import { useEffect, useRef, useState } from 'react';
import { useBuilder, buildPreviewConfig } from './builderStore';

const LANDING_PATH = '/digit-ui/landing?builderPreview=1';

const VIEWPORT_WIDTH: Record<string, string> = {
  desktop: '100%',
  tablet: '768px',
  mobile: '390px',
};

export function PreviewFrame() {
  const { state } = useBuilder();
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const debounceRef = useRef<number | undefined>(undefined);

  // Handshake: the embedded page announces readiness.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      if (e.data?.type === 'pgrl-preview-ready') setReady(true);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const post = (payload: Record<string, unknown>) => {
    frameRef.current?.contentWindow?.postMessage(payload, window.location.origin);
  };

  // Push the draft config on every relevant change (≤150 ms debounce).
  useEffect(() => {
    if (!ready || state.loading) return;
    window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      post({ type: 'pgrl-preview-config', config: buildPreviewConfig(state) });
    }, 150);
    return () => window.clearTimeout(debounceRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, state.loading, state.sections, state.page, state.previewMode]);

  // Scroll-to-preview sync on selection.
  useEffect(() => {
    if (!ready || state.selected === 'page') return;
    post({ type: 'pgrl-preview-scroll', code: state.selected });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, state.selected]);

  return (
    <div className="flex h-full flex-1 items-start justify-center overflow-auto bg-muted/40 p-4">
      <iframe
        ref={frameRef}
        title="Landing page preview"
        src={LANDING_PATH}
        className="h-full min-h-[70vh] rounded-md border border-border bg-white shadow-sm"
        style={{ width: VIEWPORT_WIDTH[state.viewport] ?? '100%' }}
      />
    </div>
  );
}
