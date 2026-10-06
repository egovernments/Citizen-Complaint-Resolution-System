import { CheckCircle2, CircleDashed, CircleSlash, ShieldCheck } from 'lucide-react';
import {
  CONFIDENCE_HINT,
  CONFIDENCE_LABEL,
  confidenceHeadline,
  confidenceLevel,
  countryName,
  type Confidence,
  levelStatus,
  sourceLine,
  STATUS_LABEL,
  type LevelStatus,
  type OfficialLevel,
  type OfficialSet,
} from '@/utils/officialBoundaries';

const STATUS_STYLE: Record<LevelStatus, string> = {
  confirmed: 'bg-success/10 text-success',
  partly: 'bg-amber-50 text-amber-800',
  differs: 'bg-amber-50 text-amber-800',
  single: 'bg-muted text-muted-foreground',
  unmeasured: 'bg-muted text-muted-foreground',
};

const STATUS_ICON: Record<LevelStatus, typeof CheckCircle2> = {
  confirmed: CheckCircle2,
  partly: CircleDashed,
  differs: CircleDashed,
  single: CircleSlash,
  unmeasured: CircleSlash,
};

const CONFIDENCE_STYLE: Record<Confidence, string> = {
  high: 'bg-success/10 text-success',
  medium: 'bg-amber-50 text-amber-800',
  low: 'bg-destructive/10 text-destructive',
};

/** "High confidence" / "Medium confidence" / "Low confidence" for the whole set.
 *  `short` drops the word "confidence" ("High") for a row already labelled
 *  "Confidence:", in the Preconfigured card's design style. */
export function ConfidenceTag({ set, short = false }: { set: OfficialSet; short?: boolean }) {
  const level = confidenceLevel(set);
  if (!level) return null;
  return (
    <span
      className={
        short
          ? `inline-flex items-center rounded-[5px] px-2 py-0.5 text-xs font-semibold ${CONFIDENCE_STYLE[level]}`
          : `inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${CONFIDENCE_STYLE[level]}`
      }
      title={short ? undefined : CONFIDENCE_HINT[level]}
      data-testid="confidence-tag"
    >
      {short ? CONFIDENCE_LABEL[level].replace(/ confidence$/, '') : CONFIDENCE_LABEL[level]}
    </span>
  );
}

/** "Confirmed" / "Partly confirmed · 83%" / "One source only" pill for one level. */
export function LevelStatusBadge({ level }: { level: OfficialLevel }) {
  const status = levelStatus(level);
  if (status === 'unmeasured') return null;
  const Icon = STATUS_ICON[status];
  const pct = status === 'partly' || status === 'differs' ? ` · ${level.matched}%` : '';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[status]}`}
      data-testid="level-status"
    >
      <Icon className="w-3 h-3" />
      {STATUS_LABEL[status]}
      {pct}
    </span>
  );
}

/**
 * What the official set is and how far it is confirmed: the headline, its
 * source and date, and what "confirmed" does and doesn't mean.
 */
export function OfficialSetSummary({ set }: { set: OfficialSet }) {
  const headline = confidenceHeadline(set);
  return (
    <section className="flex items-start gap-3 rounded-lg border border-border bg-card p-4" data-testid="official-set-summary">
      <div className="w-10 h-10 rounded-md bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
        <ShieldCheck className="w-5 h-5" />
      </div>
      <div className="min-w-0 space-y-1">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-medium text-foreground">
          Official boundaries for {countryName(set.country)}
          <ConfidenceTag set={set} />
          <span className="text-sm font-normal text-muted-foreground">{sourceLine(set)}</span>
        </p>
        {headline && (
          <p className="text-sm text-foreground" data-testid="confidence-headline">
            {headline}
          </p>
        )}
        <p className="text-xs leading-5 text-muted-foreground">
          {set.agreement_measured
            ? `Confirmed means ${set.other ? 'a second, independently drawn set' : 'another source'} has nearly the same areas. ` +
              "It doesn't mean your government has endorsed this exact file, and “one source only” means a level couldn't be checked, not that it is wrong."
            : "This server's boundary data predates the agreement check, so it can't say how far the set is confirmed."}
        </p>
      </div>
    </section>
  );
}
