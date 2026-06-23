/** @typedef {'created' | 'open' | 'resolved'} GeographyMapLayerId */

export const GEOGRAPHY_MAP_LAYERS = [
  {
    id: "created",
    label: "Created",
    description: "Complaints filed per ward",
  },
  {
    id: "open",
    label: "Open",
    description: "Complaints currently open per ward",
  },
  {
    id: "resolved",
    label: "Resolved",
    description: "Complaints resolved per ward",
  },
];

export const GEOGRAPHY_MAP_LAYER_IDS = new Set(
  GEOGRAPHY_MAP_LAYERS.map((layer) => layer.id)
);

export function isGeographyMapLayerId(value) {
  return GEOGRAPHY_MAP_LAYER_IDS.has(value);
}
