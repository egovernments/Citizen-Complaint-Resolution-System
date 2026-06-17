import { useState } from 'react';
import { DigitList, DigitDatagrid } from '@/admin';
import type { DigitColumn } from '@/admin';
import { BoundaryOverviewMap } from './BoundaryOverviewMap';

const columns: DigitColumn[] = [
  { source: 'code', label: 'app.fields.code' },
  { source: 'boundaryType', label: 'app.fields.boundary_type' },
  { source: 'tenantId', label: 'app.fields.tenant' },
];

export function BoundaryList() {
  // Default the map open — boundaries are inherently spatial and the map is
  // the most useful view; the toggle lets users collapse it for the raw list.
  const [showMap, setShowMap] = useState(true);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setShowMap((v) => !v)}
          className="border rounded px-3 py-1.5 text-sm font-medium hover:bg-gray-50"
        >
          {showMap ? 'Hide map' : 'Show map'}
        </button>
      </div>

      {showMap && (
        <div className="border rounded-lg p-4 bg-white">
          <BoundaryOverviewMap />
        </div>
      )}

      <DigitList title="app.resources.boundaries" hasCreate sort={{ field: 'code', order: 'ASC' }}>
        <DigitDatagrid columns={columns} rowClick="show" />
      </DigitList>
    </div>
  );
}
