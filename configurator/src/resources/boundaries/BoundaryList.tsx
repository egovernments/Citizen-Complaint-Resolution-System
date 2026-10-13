import { useState } from 'react';
import { DigitList } from '@/admin';
import { BoundaryOverviewMap } from './BoundaryOverviewMap';
import { BoundaryTreeTable } from './BoundaryTreeTable';

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

      {/* ours (cfgreview F19, #1565): a tree of named boundaries (was a flat list of codes); every row on one page */}
      <DigitList title="app.resources.boundaries" hasCreate sort={{ field: 'code', order: 'ASC' }} perPage={1000}>
        <BoundaryTreeTable />
      </DigitList>
    </div>
  );
}
