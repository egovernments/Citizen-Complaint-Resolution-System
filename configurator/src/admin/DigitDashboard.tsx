import { useGetList, useTranslate } from 'ra-core';
import { DigitCard } from '@/components/digit/DigitCard';
import { useNavigate } from 'react-router-dom';
import { getDedicatedResources } from '@/providers/bridge';
import { useResourceLabel } from '@/providers/useResourceLabel';
import { useMastersCapability } from '@/hooks/useMastersCapability';
import { AVAILABLE_LOCALES } from '@/providers/i18nProvider';
import {
  Building2,
  MapPin,
  Users,
  Briefcase,
  Award,
  AlertTriangle,
  Globe,
  MessageSquare,
  User,
  Shield,
} from 'lucide-react';

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  tenants: Building2,
  departments: Briefcase,
  designations: Award,
  'complaint-hierarchy': AlertTriangle,
  employees: Users,
  complaints: MessageSquare,
  boundaries: MapPin,
  localization: Globe,
  users: User,
  'access-roles': Shield,
};

/**
 * Cards only render `total`, never `data.length`. Keep perPage at 1 so PGR
 * `_search` / other paged APIs do not pull a 500-row payload just to badge
 * a count — MDMS v2 still walks every page inside getList because it has
 * no total field.
 *
 * LocalizationList pins every AVAILABLE_LOCALES column, so the card must use
 * the same `locales` filter or it counts only en_IN and the list counts the
 * union across languages.
 */
const LOCALIZATION_LOCALES = AVAILABLE_LOCALES.map((l) => l.locale);

function ResourceCard({ resource }: { resource: string }) {
  const { total, isPending, error } = useGetList(resource, {
    pagination: { page: 1, perPage: 1 },
    sort: { field: 'id', order: 'ASC' },
    filter: resource === 'localization' ? { locales: LOCALIZATION_LOCALES } : {},
  });

  const navigate = useNavigate();
  const resourceLabel = useResourceLabel();
  const label = resourceLabel(resource);
  const Icon = ICONS[resource] ?? Briefcase;

  return (
    <button
      onClick={() => navigate(`/manage/${resource}`)}
      className="text-left w-full h-full focus:outline-none group"
    >
      <DigitCard className="h-full w-full mb-0 p-4 flex items-center min-h-[88px] transition-all duration-150 group-hover:shadow-md group-hover:border-primary/40 group-hover:bg-accent/5">
        <div className="flex items-center gap-3.5 w-full">
          <div className="w-11 h-11 bg-primary/10 rounded-lg flex items-center justify-center flex-shrink-0">
            <Icon className="w-5 h-5 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-2xl font-bold text-foreground leading-tight tracking-tight">
              {isPending ? '...' : error ? '—' : (total ?? 0)}
            </p>
            {error ? (
              <p className="text-xs text-destructive mt-0.5 truncate" title={error instanceof Error ? error.message : String(error)}>
                {error instanceof Error ? error.message : 'Error loading data'}
              </p>
            ) : null}
            <p className="text-sm font-medium text-muted-foreground truncate" title={label}>
              {label}
            </p>
          </div>
        </div>
      </DigitCard>
    </button>
  );
}

export function DigitDashboard() {
  const translate = useTranslate();
  const { canViewResource } = useMastersCapability();
  const dedicatedMap = getDedicatedResources();
  const resources = Object.keys(dedicatedMap).filter(
    (r) => ICONS[r] && canViewResource(r)
  );

  return (
    <div className="space-y-6">
      <h1 className="text-2xl sm:text-3xl font-bold font-condensed text-foreground">
        {translate('app.header.title')}
      </h1>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-4">
        {resources.map((resource) => (
          <ResourceCard key={resource} resource={resource} />
        ))}
      </div>
    </div>
  );
}
