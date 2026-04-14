import { getGenericMdmsResources, getResourceLabel, getResourceConfig } from '@/providers/bridge';
import { DigitCard } from '@/components/digit/DigitCard';
import { useNavigate } from 'react-router-dom';
import { Database } from 'lucide-react';

export function AdvancedPage() {
  const resourceMap = getGenericMdmsResources();
  const resources = Object.keys(resourceMap);
  const navigate = useNavigate();

  return (
    <div className="space-y-6">
      <h1 className="text-2xl sm:text-3xl font-bold font-condensed text-foreground">
        Advanced Entities
      </h1>
      <p className="text-muted-foreground">
        Browse and manage all MDMS schema data.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {resources.map((name) => {
          const config = getResourceConfig(name);
          return (
            <button
              key={name}
              onClick={() => navigate(`/manage/${name}`)}
              className="text-left w-full"
            >
              <DigitCard>
                <div className="flex items-center gap-3">
                  <Database className="w-5 h-5 text-primary flex-shrink-0" />
                  <div>
                    <p className="text-sm font-medium">{getResourceLabel(name)}</p>
                    <p className="text-xs text-muted-foreground">{config?.schema}</p>
                  </div>
                </div>
              </DigitCard>
            </button>
          );
        })}
      </div>
    </div>
  );
}
