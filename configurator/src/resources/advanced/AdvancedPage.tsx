import { getGenericMdmsResources, getResourceLabel, getResourceConfig } from '@/providers/bridge';
import { DigitCard } from '@/components/digit/DigitCard';
import { useNavigate } from 'react-router-dom';
import { Database } from 'lucide-react';
import { useApp } from '../../App';
import { ADVANCED_LINKS, groupAdvanced } from './advancedGroups';

/**
 * ours (cfgreview F21, #1567): about 40 masters in one flat list, each captioned with its schema code. They are now
 * grouped by area, each with one line on what it changes; the Platform group (installation-wide settings and legacy
 * masters) is shown at the state only.
 */
export function AdvancedPage() {
  const { state } = useApp();
  const groups = groupAdvanced(Object.keys(getGenericMdmsResources()), !state.tenant.includes('.'));
  const navigate = useNavigate();

  return (
    <div className="space-y-6">
      <h1 className="text-2xl sm:text-3xl font-bold font-condensed text-foreground">
        Advanced Entities
      </h1>
      <p className="text-muted-foreground">
        Lists that the guided screens do not cover, grouped by area. Change them only if you know what they control.
      </p>
      {groups.map((g) => (
        <section key={g.id} aria-labelledby={`advanced-${g.id}`} data-testid={`advanced-group-${g.id}`} className="space-y-3">
          <div>
            <h2 id={`advanced-${g.id}`} className="text-lg font-semibold">{g.title}</h2>
            <p className="text-sm text-muted-foreground">{g.blurb}</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {g.items.map((it) => (
              <button
                key={it.name}
                onClick={() => navigate(ADVANCED_LINKS[it.name]?.path ?? `/manage/${it.name}`)}
                className="text-left w-full"
                title={getResourceConfig(it.name)?.schema}
              >
                <DigitCard className="h-full">
                  <div className="flex items-start gap-3">
                    <Database className="mt-0.5 w-5 h-5 text-primary flex-shrink-0" aria-hidden="true" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{ADVANCED_LINKS[it.name]?.label ?? getResourceLabel(it.name)}</p>
                      <p className="text-xs text-muted-foreground">{it.description}</p>
                    </div>
                  </div>
                </DigitCard>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
