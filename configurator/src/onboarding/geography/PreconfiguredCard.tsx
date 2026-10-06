import { ArrowRight, LayoutGrid } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { PreconfiguredState } from '@/hooks/usePreconfiguredBoundaries';
import { confidenceHeadline, countryName, sourceLine } from '@/utils/officialBoundaries';
import { ConfidenceTag } from './OfficialConfidence';

/**
 * Geography's "Preconfigured" option: the official boundary set turbopass
 * holds for the tenant's country, with how confident we are in it. Choosing
 * it opens the Fetch search with the source fixed to that set. Same shell
 * as the other OptionCards, plus a country picker — the country comes from
 * the tenant record or its phone dial code, and the operator can correct it.
 */
export function PreconfiguredCard({
  state,
  onChooseCountry,
  onUse,
}: {
  state: PreconfiguredState;
  onChooseCountry: (code: string) => void;
  onUse: () => void;
}) {
  const unusable = state.status !== 'ready';
  const country = state.status === 'none' || state.status === 'ready' ? state.country.country : undefined;
  const countries = 'countries' in state ? state.countries : [];

  return (
    <div className={`flex flex-col rounded-lg border border-border bg-card p-4 ${unusable ? 'opacity-90' : ''}`} data-testid="preconfigured-card">
      <div className="w-10 h-10 rounded-md bg-primary/10 text-primary flex items-center justify-center">
        <LayoutGrid className="w-5 h-5" />
      </div>
      <h4 className="mt-3 text-base font-medium text-foreground">Preconfigured</h4>
      <div className="mt-1 flex-1 space-y-2 text-sm leading-5 text-muted-foreground">
        {state.status === 'loading' && <p aria-busy="true">Checking which boundaries we hold for your country…</p>}
        {state.status === 'unavailable' && (
          <p data-testid="option-unavailable">
            Start from a boundary set we hold for your country. This needs the turbopass boundary service with official
            sets loaded, which this deployment doesn't have.
          </p>
        )}
        {state.status === 'pick-country' && <p>Start from the official boundary set we hold for your country. Choose it first.</p>}
        {state.status === 'none' && (
          <p data-testid="option-unavailable">
            We don't hold official boundaries for {countryName(state.country.country)} yet. Fetch or upload them instead.
          </p>
        )}
        {state.status === 'ready' && (
          <>
            <p>
              Official boundaries for <span className="font-medium text-foreground">{countryName(state.set.country)}</span>
              {state.set.levels.length > 0 && (
                <>: {state.set.levels.map((l) => l.name ?? l.level).join(' → ')}</>
              )}
              .
            </p>
            {confidenceHeadline(state.set) && <p data-testid="preconfigured-headline">{confidenceHeadline(state.set)}</p>}
            <p className="flex flex-wrap items-center gap-2 text-xs">
              <ConfidenceTag set={state.set} />
              {sourceLine(state.set)}
            </p>
          </>
        )}
      </div>

      {countries.length > 0 && (
        <div className="mt-3">
          <Select value={country} onValueChange={onChooseCountry}>
            <SelectTrigger className="h-9" aria-label="Country">
              <SelectValue placeholder="Choose your country" />
            </SelectTrigger>
            <SelectContent>
              {countries.map((code) => (
                <SelectItem key={code} value={code}>
                  {countryName(code)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

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
