import { useGetList } from 'ra-core';
import { DigitCard } from '@/components/digit/DigitCard';
import { useNavigate } from 'react-router-dom';
import { getDedicatedResources, getResourceLabel } from '@/providers/bridge';
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
  'complaint-types': AlertTriangle,
  employees: Users,
  complaints: MessageSquare,
  boundaries: MapPin,
  localization: Globe,
  users: User,
  'access-roles': Shield,
};

function ResourceCard({ resource }: { resource: string }) {
  const { total, isPending } = useGetList(resource, {
    pagination: { page: 1, perPage: 1 },
    sort: { field: 'id', order: 'ASC' },
    filter: {},
  });

  const navigate = useNavigate();
  const label = getResourceLabel(resource);
  const Icon = ICONS[resource] ?? Briefcase;

  return (
    <button
      onClick={() => navigate(`/manage/${resource}`)}
      className="text-left w-full"
    >
      <DigitCard>
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center">
            <Icon className="w-6 h-6 text-primary" />
          </div>
          <div>
            <p className="text-2xl font-bold text-foreground">
              {isPending ? '...' : (total ?? 0)}
            </p>
            <p className="text-sm text-muted-foreground">{label}</p>
          </div>
        </div>
      </DigitCard>
    </button>
  );
}

export function DigitDashboard() {
  const dedicatedMap = getDedicatedResources();
  const resources = Object.keys(dedicatedMap).filter(
    (r) => ICONS[r] // only show resources that have icons
  );

  return (
    <div className="space-y-6">
      <h1 className="text-2xl sm:text-3xl font-bold font-condensed text-foreground">
        DIGIT Management Studio
      </h1>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {resources.map((resource) => (
          <ResourceCard key={resource} resource={resource} />
        ))}
      </div>
    </div>
  );
}
