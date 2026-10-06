import { useId, useState } from 'react';
import { ArrowRight, LayoutGrid } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { PreconfiguredState } from '@/hooks/usePreconfiguredBoundaries';
import {
  CONFIDENCE_HINT,
  confidenceHeadline,
  confidenceLevel,
  countryName,
  sourceLine,
  type OfficialSet,
} from '@/utils/officialBoundaries';
import { ConfidenceTag } from './OfficialConfidence';

/** "Confidence: Medium (i)" — the (i) opens what the label measures and why this set got it. */
function Confidence({ set }: { set: OfficialSet }) {
  const [open, setOpen] = useState(false);
  const tipId = useId();
  const level = confidenceLevel(set);
  if (!level) return null;
  const headline = confidenceHeadline(set);
  return (
    <div className="relative flex items-center gap-2" data-testid="preconfigured-confidence">
      <span className="text-[13px] text-muted-foreground">Confidence:</span>
      <ConfidenceTag set={set} short />
      <button
        type="button"
        aria-label="What confidence means"
        aria-describedby={open ? tipId : undefined}
        aria-expanded={open}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen((o) => !o)}
        className="flex h-[18px] w-[18px] flex-none items-center justify-center rounded-full border border-muted-foreground/70 text-[11px] font-bold italic text-muted-foreground"
      >
        i
      </button>
      {open && (
        <div
          id={tipId}
          role="tooltip"
          className="absolute bottom-[calc(100%+8px)] left-0 z-10 w-[310px] space-y-2 rounded-lg bg-foreground px-3 py-3 text-xs leading-[1.55] text-background shadow-lg"
        >
          <p>Confidence shows how far a second, independently drawn boundary set confirms these boundaries.</p>
          <p>{CONFIDENCE_HINT[level]}</p>
          {headline && <p data-testid="preconfigured-headline">{headline}</p>}
          <p>
            If you find that key boundaries are not present in the preconfigured set, kindly upload them using the
            “Upload from Excel” option.
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * Geography's "Preconfigured boundaries" option, per the CMS design: the
 * official boundary set turbopass holds for the country chosen at signup, and
 * how confident we are in it. Choosing it opens the Fetch search with the
 * source fixed to that set. The country is not editable here — it is the
 * tenant's — so a tenant without one is told why the option is unavailable
 * rather than asked to pick.
 */
export function PreconfiguredCard({ state, onUse }: { state: PreconfiguredState; onUse: () => void }) {
  return (
    <div className="flex flex-col rounded-lg border border-border bg-card p-4" data-testid="preconfigured-card">
      <div className="w-10 h-10 rounded-md bg-primary/10 text-primary flex items-center justify-center">
        <LayoutGrid className="w-5 h-5" />
      </div>
      <h4 className="mt-3 text-base font-medium text-foreground">Preconfigured boundaries</h4>

      <div className="mt-3 flex flex-1 flex-col gap-3">
        {state.status === 'loading' && (
          <p className="text-sm leading-5 text-muted-foreground" aria-busy="true">
            Checking which boundaries we hold for your country…
          </p>
        )}
        {state.status === 'unavailable' && (
          <p className="text-xs leading-5 text-muted-foreground" data-testid="option-unavailable">
            This needs the turbopass boundary service with official boundary sets loaded, which this deployment doesn't
            have.
          </p>
        )}
        {state.status === 'unknown-country' && (
          <p className="text-xs leading-5 text-muted-foreground" data-testid="option-unavailable">
            This tenant has no country recorded from signup, so we can't tell which boundaries to offer. Fetch or upload
            them instead.
          </p>
        )}
        {state.status === 'none' && (
          <p className="text-xs leading-5 text-muted-foreground" data-testid="option-unavailable">
            We don't hold preconfigured boundaries for {countryName(state.country.country)} yet. Fetch or upload them
            instead.
          </p>
        )}
        {state.status === 'ready' && (
          <>
            <div className="rounded-md border border-border bg-muted/40 px-3.5 py-3">
              <p className="mb-1.5 text-xs font-bold uppercase tracking-[0.04em] text-muted-foreground">Boundaries detected</p>
              <p className="mb-1 text-sm font-bold text-foreground" data-testid="preconfigured-country">
                {countryName(state.set.country)}
              </p>
              <p className="text-sm leading-normal text-foreground">
                {state.set.levels.map((l) => l.name ?? l.level).join(' → ')}
              </p>
            </div>
            <Confidence set={state.set} />
            <p className="text-xs text-muted-foreground">Source: {sourceLine(state.set)}</p>
          </>
        )}
      </div>

      {state.status === 'ready' && (
        <div className="mt-4">
          <Button variant="outline" size="sm" onClick={onUse} className="h-9 gap-1.5 px-3">
            Use these boundaries
            <ArrowRight className="w-4 h-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
