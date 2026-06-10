/**
 * Card 1 — "How the SLA for a complaint is chosen".
 *
 * Renders the resolution cascade as six rows: a gate row (the
 * complaint-status mapping, which switches the per-state sources on or
 * off) plus the five SLA sources in the exact order the scheduler checks
 * them (resolveSlaPreview.SLA_SOURCE_ORDER). Each row carries a live chip
 * computed from the loaded config so operators can see at a glance which
 * sources actually hold values on this deployment.
 *
 * The final row (previous SLA settings) is a terminal fallback — it is
 * NEVER rendered as a miss, only as "in use as final fallback".
 */
import { useNavigate } from 'react-router-dom';
import { ListOrdered, Filter, ExternalLink } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { MatrixRow } from '../sla-matrix/slaService';
import type { StateDefaults } from '../sla-matrix/types';
import { STATE_KEYS, isStateDefaultsEmpty } from '../sla-matrix/types';
import { isLevelValuesEmpty } from '../sla-matrix/levelSlaValues';
import type { EscalationPolicy } from '../sla-matrix/escalationTypes';
import { formatLegacyLevels, type LegacyEscalationConfig } from './legacyConfig';

interface CascadeCardProps {
  rows: MatrixRow[];
  stateDefaults: StateDefaults;
  policy: EscalationPolicy | null;
  legacy: LegacyEscalationConfig | null;
  /** Number of statuses in the saved CRS.WorkflowStateMapping record. */
  mappingCount: number;
  /** Scrolls to Card 3 so the operator can fix the gate. */
  onJumpToMapping: () => void;
}

export function CascadeCard({
  rows,
  stateDefaults,
  policy,
  legacy,
  mappingCount,
  onJumpToMapping,
}: CascadeCardProps) {
  const navigate = useNavigate();
  const mappingEmpty = mappingCount === 0;

  const levelRowCount = rows.filter(
    (r) => r.isActive && !isLevelValuesEmpty(r.slaHoursByLevel),
  ).length;
  const stateRowCount = rows.filter(
    (r) =>
      r.isActive &&
      STATE_KEYS.some((k) => r.slaHoursByState?.[k] !== null && r.slaHoursByState?.[k] !== undefined),
  ).length;
  const policyLevels = policy?.defaultSlaHoursByLevel ?? [];
  const stateDefaultsSet = !isStateDefaultsEmpty(stateDefaults);
  const legacyLevels = formatLegacyLevels(legacy?.defaultSlaByLevel);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ListOrdered className="w-4 h-4 text-primary" />
          How the SLA for a complaint is chosen
        </CardTitle>
        <CardDescription>
          <strong className="text-foreground">Checked top to bottom — the first source with a value wins.</strong>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ol className="space-y-1.5">
          {/* 0 — gate row: not an SLA source, but it switches per-state sources on/off */}
          <CascadeRow gate name="Complaint-status mapping">
            {mappingEmpty ? (
              <button onClick={onJumpToMapping} className="inline-flex">
                <Badge variant="outline" className="bg-amber-50 border-amber-200 text-amber-900 cursor-pointer">
                  not set — sources marked ⚠ below are inactive
                </Badge>
              </button>
            ) : (
              <Badge variant="outline">{plural(mappingCount, 'status mapped', 'statuses mapped')}</Badge>
            )}
          </CascadeRow>

          <CascadeRow
            index={1}
            name="Per-category level SLAs (SLA Matrix → Levels)"
            linkLabel="Open SLA Matrix"
            onLink={() => navigate('/manage/crs-sla-matrix')}
          >
            <Badge variant="outline">{plural(levelRowCount, 'row', 'rows')}</Badge>
          </CascadeRow>

          <CascadeRow index={2} name="Per-category state SLAs (SLA Matrix cells)">
            <Badge variant="outline">{plural(stateRowCount, 'row', 'rows')}</Badge>
            {mappingEmpty && <BlockedBadge />}
          </CascadeRow>

          <CascadeRow index={3} name="Deployment-wide level SLAs (card below)">
            <Badge variant="outline">
              {policyLevels.length > 0 ? `set (L0–L${policyLevels.length - 1})` : 'not set'}
            </Badge>
          </CascadeRow>

          <CascadeRow index={4} name="Deployment-wide state SLAs (SLA Matrix → Defaults row)">
            <Badge variant="outline">{stateDefaultsSet ? 'set' : 'not configured'}</Badge>
            {mappingEmpty && <BlockedBadge />}
          </CascadeRow>

          {/* 5 — terminal fallback: never a miss */}
          <CascadeRow
            index={5}
            name="Previous SLA settings (Legacy page)"
            linkLabel="Open Legacy SLA page"
            onLink={() => navigate('/manage/escalation-config')}
          >
            {legacyLevels && (
              <Badge variant="outline" className="font-mono text-[10px]">{legacyLevels}</Badge>
            )}
            <Badge variant="outline" className="text-muted-foreground">in use as final fallback</Badge>
          </CascadeRow>
        </ol>
      </CardContent>
    </Card>
  );
}

function plural(n: number, singular: string, pluralForm: string): string {
  return `${n} ${n === 1 ? singular : pluralForm}`;
}

function BlockedBadge() {
  return (
    <Badge variant="outline" className="bg-amber-50 border-amber-200 text-amber-900">
      ⚠ blocked — statuses not mapped
    </Badge>
  );
}

interface CascadeRowProps {
  /** 1-based source position; omitted for the gate row. */
  index?: number;
  /** Gate row gets the distinct (primary-tinted) treatment. */
  gate?: boolean;
  name: string;
  linkLabel?: string;
  onLink?: () => void;
  children?: React.ReactNode;
}

function CascadeRow({ index, gate, name, linkLabel, onLink, children }: CascadeRowProps) {
  return (
    <li
      data-testid="cascade-row"
      className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border px-3 py-2 ${
        gate ? 'border-primary/40 bg-primary/5' : 'border-border bg-background'
      }`}
    >
      <span
        className={`w-6 h-6 shrink-0 rounded-full text-[11px] font-semibold flex items-center justify-center ${
          gate ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
        }`}
      >
        {gate ? <Filter className="w-3 h-3" /> : index}
      </span>
      <span className="text-sm flex-1 min-w-[220px]">{name}</span>
      <div className="flex items-center gap-1.5 flex-wrap">
        {children}
        {linkLabel && onLink && (
          <Button variant="ghost" size="sm" className="h-6 px-2 text-xs text-muted-foreground" onClick={onLink}>
            <ExternalLink className="w-3 h-3 mr-1" />
            {linkLabel}
          </Button>
        )}
      </div>
    </li>
  );
}
