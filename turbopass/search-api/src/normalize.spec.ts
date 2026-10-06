import {
  GEOAPIFY_LICENCE,
  geoapifyFetchFeatures,
  geoapifySearchFeatures,
  withDepths,
} from './normalize';

const feature = (admin_level: unknown) => ({ properties: { admin_level } });

describe('withDepths', () => {
  it('renumbers the levels present from 0, closing gaps', () => {
    // Nairobi from OpenStreetMap: 4, 6, 8, 10.
    const depths = withDepths([
      feature(8),
      feature(4),
      feature(10),
      feature(6),
      feature(8),
    ]).map((f) => f.properties.depth);
    expect(depths).toEqual([2, 0, 3, 1, 2]);
  });

  it('leaves a feature without a level undepthed', () => {
    expect(
      withDepths([feature(undefined), feature(2)]).map(
        (f) => f.properties.depth,
      ),
    ).toEqual([null, 0]);
  });
});

describe('Geoapify translation', () => {
  it('turns a geocoding result into a search hit without geometry', () => {
    const [hit] = geoapifySearchFeatures({
      features: [
        {
          properties: {
            place_id: 'p1',
            name: 'Nairobi',
            formatted: 'Nairobi, Kenya',
            country_code: 'ke',
            result_type: 'city',
          },
          bbox: [1, 2, 3, 4],
          geometry: { type: 'Point', coordinates: [0, 0] },
        },
      ],
    });
    expect(hit).toMatchObject({
      properties: {
        place_id: 'p1',
        name: 'Nairobi',
        country_code: 'KE',
        subtype: 'city',
        source: 'geoapify',
        licence: GEOAPIFY_LICENCE,
      },
      bbox: [1, 2, 3, 4],
      geometry: null,
    });
  });

  it('reads the admin level from either place and adds depths', () => {
    const out = geoapifyFetchFeatures([
      {
        properties: { place_id: 'a', name: 'Nairobi', admin_level: 4 },
        geometry: { type: 'Polygon', coordinates: [] },
      },
      {
        properties: {
          place_id: 'b',
          name: 'Westlands',
          datasource: { raw: { admin_level: '6' } },
        },
        geometry: null,
      },
    ]);
    expect(
      out.map((f) => [
        f.properties.name,
        f.properties.admin_level,
        f.properties.depth,
      ]),
    ).toEqual([
      ['Nairobi', 4, 0],
      ['Westlands', 6, 1],
    ]);
  });
});
