/**
 * Dashboard v2 — iframe to the Lovable-hosted Wardwise Whispers dashboard.
 *
 * The embedded site's top nav is hidden via the standard cross-origin clip
 * trick: wrap the iframe in an overflow:hidden box, then push the iframe
 * up by NAV_OFFSET so the nav scrolls off the top of the viewport. We
 * over-size the iframe height by the same offset so the bottom isn't cut
 * off. If Lovable changes their nav height the only knob to tune is
 * NAV_OFFSET_PX below.
 */
import { ExternalLink } from 'lucide-react';

const TARGET = 'https://wardwise-whispers-nairobi.lovable.app/data';
const NAV_OFFSET_PX = 252;
const FOOTER_OFFSET_PX = 630;

export default function CitizenDashboardV2Page() {
  return (
    <div className="h-[calc(100vh-7rem)] flex flex-col">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard v2</h1>
          <p className="text-sm text-muted-foreground">
            Wardwise Whispers — Nairobi
          </p>
        </div>
        <a
          href={TARGET}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
        >
          Open in new tab
          <ExternalLink className="h-4 w-4" />
        </a>
      </div>
      <div className="flex-1 overflow-hidden rounded-md border bg-background">
        <iframe
          src={TARGET}
          title="Wardwise Whispers Nairobi"
          style={{
            width: '100%',
            height: `calc(100% + ${NAV_OFFSET_PX + FOOTER_OFFSET_PX}px)`,
            marginTop: `-${NAV_OFFSET_PX}px`,
            border: 0,
            display: 'block',
          }}
        />
      </div>
    </div>
  );
}
