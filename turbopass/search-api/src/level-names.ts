// What each country calls its administrative levels, for the official sets
// (#1994). No source carries these names — COD-AB and geoBoundaries only say
// ADM1, ADM2, … — so they are curated here for the priority countries and
// offered to operators as defaults (Phase 2 pre-fills the hierarchy's level
// names; the operator can still edit them).
//
// Keyed by country AND source: two sets for one country can follow different
// structures. geoBoundaries' Burundi is the pre-2025 map (18 provinces, 119
// communes, then collines), COD's is the 2025 one (5 provinces, 42 communes,
// zones, collines). Overture and Geoapify get no names: their levels don't
// follow the national structure consistently (Overture skips South Africa's
// local municipalities, for one), so a name there could be wrong.
//
// names[0] is ADM1. A source/level missing here simply has no name.

interface LevelNames {
  sources: string[];
  names: string[];
}

const BOTH = ['cod', 'geoboundaries'];

export const LEVEL_NAMES: Record<string, LevelNames[]> = {
  DJ: [{ sources: BOTH, names: ['Region', 'District'] }],
  GW: [{ sources: BOTH, names: ['Region', 'Sector'] }],
  BI: [
    { sources: ['cod'], names: ['Province', 'Commune', 'Zone', 'Colline'] },
    { sources: ['geoboundaries'], names: ['Province', 'Commune', 'Colline'] },
  ],
  LR: [{ sources: BOTH, names: ['County', 'District'] }],
  BJ: [{ sources: BOTH, names: ['Department', 'Commune', 'Arrondissement'] }],
  MZ: [
    {
      sources: BOTH,
      names: ['Province', 'District', 'Administrative Post', 'Locality'],
    },
  ],
  ET: [{ sources: BOTH, names: ['Region', 'Zone', 'Woreda'] }],
  RW: [
    {
      sources: BOTH,
      names: ['Province', 'District', 'Sector', 'Cell', 'Village'],
    },
  ],
  KE: [{ sources: BOTH, names: ['County', 'Sub-county', 'Ward'] }],
  ZA: [
    {
      sources: BOTH,
      names: ['Province', 'District', 'Local Municipality', 'Ward'],
    },
  ],
  BR: [{ sources: BOTH, names: ['State', 'Municipality'] }],
  IN: [
    {
      sources: ['geoboundaries'],
      names: ['State', 'District', 'Sub-district'],
    },
  ],
};

export interface LevelKey {
  country: string | null;
  source?: string | null;
  admin_level: number | null;
}

/** The local name of an official set's level ("Ward"), or null when unknown. */
export function levelNameFor(row: LevelKey): string | null {
  if (!row.country || !row.source || row.admin_level == null) return null;
  if (row.admin_level < 1) return null; // the country itself
  const sets = LEVEL_NAMES[row.country];
  const set = sets?.find((s) => s.sources.includes(row.source as string));
  return set?.names[row.admin_level - 1] ?? null;
}
