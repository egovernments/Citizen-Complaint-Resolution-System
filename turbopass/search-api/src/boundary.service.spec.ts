import { HttpException } from '@nestjs/common';
import { of } from 'rxjs';
import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { BoundaryService } from './boundary.service';

// Builds a boundaries.sqlite shaped like the bootstrap pipeline's output.
// "Delhi Govt Flats" is inserted FIRST, so an unordered query (the old
// `LIKE ... LIMIT 10`) would return it ahead of the Delhi region.
function makeDb(file: string, withParentId: boolean): void {
  const db = new Database(file);
  db.exec(`CREATE TABLE boundaries (
    id VARCHAR PRIMARY KEY, division_id VARCHAR, subtype VARCHAR, class VARCHAR,
    country VARCHAR, name VARCHAR, admin_level INTEGER, bbox JSON, geometry JSON
    ${withParentId ? ', parent_id VARCHAR' : ''})`);
  const square = JSON.stringify({
    type: 'Polygon',
    coordinates: [
      [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 0],
      ],
    ],
  });
  const bbox = JSON.stringify({ xmin: 0, xmax: 1, ymin: 0, ymax: 1 });
  const rows = [
    [
      'flats',
      'div-fl',
      'locality',
      'land',
      'IN',
      'Delhi Govt Flats',
      3,
      bbox,
      square,
      'dl',
    ],
    ['dl', 'div-dl', 'region', 'land', 'IN', 'Delhi', 1, bbox, square, 'in'],
    ['in', 'div-in', 'country', 'land', 'IN', 'India', 0, bbox, square, null],
  ];
  const insert = db.prepare(
    `INSERT INTO boundaries VALUES (${new Array(withParentId ? 10 : 9).fill('?').join(', ')})`,
  );
  for (const r of rows) insert.run(...(withParentId ? r : r.slice(0, 9)));
  db.close();
}

async function statusOf(p: Promise<unknown>): Promise<number> {
  try {
    await p;
  } catch (e) {
    if (e instanceof HttpException) return e.getStatus();
    throw e;
  }
  throw new Error('expected the call to fail');
}

describe('BoundaryService overture search', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'turbopass-spec-'));
  const savedPath = process.env.OVERTURE_DB_PATH;
  const serviceOn = (file: string) => {
    process.env.OVERTURE_DB_PATH = file;
    return new BoundaryService({} as any, {} as any);
  };

  afterAll(() => {
    process.env.OVERTURE_DB_PATH = savedPath;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('returns ranked, disambiguated features without geometry', async () => {
    const file = path.join(dir, 'full.sqlite');
    makeDb(file, true);
    const res = await serviceOn(file).search('Delhi', 'overture');
    expect(res.features.map((f: any) => f.properties.name)).toEqual([
      'Delhi',
      'Delhi Govt Flats',
    ]);
    expect(res.features[0].properties).toMatchObject({
      place_id: 'dl',
      subtype: 'region',
      admin_level: 1,
      match_type: 'exact',
      parent_name: 'India',
      formatted: 'Delhi — region, India',
    });
    // Polygons come from /boundary/fetch; search ships properties + bbox only.
    expect(res.features.every((f: any) => f.geometry === null)).toBe(true);
    expect(res.features[0].bbox).toEqual([0, 0, 1, 1]); // [west, south, east, north]
  });

  it('passes match and limit through', async () => {
    const file = path.join(dir, 'modes.sqlite');
    makeDb(file, true);
    const svc = serviceOn(file);
    expect(
      (await svc.search('Delhi', 'overture', 'exact')).features,
    ).toHaveLength(1);
    expect(
      (await svc.search('Delhi', 'overture', 'substring', 1)).features,
    ).toHaveLength(1);
    expect(
      (await svc.search('Dehli', 'overture', 'fuzzy')).features[0].properties
        .name,
    ).toBe('Delhi');
  });

  it('still works on a DB built before the hierarchy step (no parent_id column)', async () => {
    const file = path.join(dir, 'no-parent.sqlite');
    makeDb(file, false);
    const res = await serviceOn(file).search('Delhi', 'overture');
    expect(res.features[0].properties).toMatchObject({
      name: 'Delhi',
      parent_name: null,
      formatted: 'Delhi — region, India',
    });
  });

  it('fetch still returns the picked place and its descendants with geometry', async () => {
    const file = path.join(dir, 'fetch.sqlite');
    makeDb(file, true);
    const res = await serviceOn(file).fetchBoundaries('dl', 'overture');
    expect(res.features.map((f: any) => f.properties.place_id).sort()).toEqual([
      'dl',
      'flats',
    ]);
    expect(res.features.every((f: any) => f.geometry.type === 'Polygon')).toBe(
      true,
    );
  });

  it('filters by min_descendants', async () => {
    const file = path.join(dir, 'min-desc.sqlite');
    makeDb(file, true);
    const svc = serviceOn(file);
    const names = async (min: number) =>
      (
        await svc.search('Delhi', 'overture', 'substring', 10, min)
      ).features.map((f: any) => f.properties.name);
    expect(await names(0)).toEqual(['Delhi', 'Delhi Govt Flats']);
    expect(await names(1)).toEqual(['Delhi']);
  });

  it('refuses a fetch over FETCH_MAX_FEATURES with 413, and serves one within it', async () => {
    const file = path.join(dir, 'cap.sqlite');
    makeDb(file, true);
    process.env.FETCH_MAX_FEATURES = '2';
    try {
      const svc = serviceOn(file);
      expect(await statusOf(svc.fetchBoundaries('in', 'overture'))).toBe(413); // India + Delhi + Flats = 3
      const dl = await svc.fetchBoundaries('dl', 'overture');
      expect(dl.features.map((f: any) => f.properties.subtype).sort()).toEqual([
        'locality',
        'region',
      ]);
    } finally {
      delete process.env.FETCH_MAX_FEATURES;
    }
  });

  it('reports which sources are live and what the DB holds', () => {
    const file = path.join(dir, 'meta.sqlite');
    makeDb(file, true);
    const db = new Database(file);
    db.exec(
      "CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT); INSERT INTO meta VALUES ('release', '2026-08-19.0');",
    );
    db.close();
    process.env.OVERTURE_DB_PATH = file;
    const config = {
      get: (k: string) => (k === 'GEOAPIFY_API_KEY' ? 'key' : undefined),
    };
    const svc = new BoundaryService({} as any, config as any);
    expect(svc.sources()).toEqual({
      overture: true,
      official: false,
      cod: false,
      geoboundaries: false,
      geoapify: true,
    });
    expect(svc.officialInfo()).toBeNull();
    expect(svc.overtureInfo()).toMatchObject({
      places: 3,
      release: '2026-08-19.0',
    });
  });

  it('answers 503 when the DB is missing', async () => {
    const svc = serviceOn(path.join(dir, 'does-not-exist.sqlite'));
    expect(await statusOf(svc.search('Delhi', 'overture'))).toBe(503);
  });
});

// A DB after official.py: the Overture rows plus a COD set for Kenya that won
// the country (official = 1) and a geoBoundaries set that didn't.
function makeOfficialDb(file: string): void {
  makeDb(file, true);
  const db = new Database(file);
  db.exec(`
    ALTER TABLE boundaries ADD COLUMN source VARCHAR;
    ALTER TABLE boundaries ADD COLUMN licence VARCHAR;
    ALTER TABLE boundaries ADD COLUMN pcode VARCHAR;
    ALTER TABLE boundaries ADD COLUMN official INTEGER;
    UPDATE boundaries SET source = 'overture', official = 0;
    CREATE TABLE official_datasets (country VARCHAR, source VARCHAR, chosen INTEGER, usable INTEGER,
      licence VARCHAR, dataset_date VARCHAR, quality VARCHAR, url VARCHAR, levels JSON, note VARCHAR);
  `);
  const square = JSON.stringify({
    type: 'Polygon',
    coordinates: [
      [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 0],
      ],
    ],
  });
  const insert = db.prepare(
    `INSERT INTO boundaries (id, division_id, subtype, class, country, name, admin_level, bbox, geometry,
       parent_id, source, licence, pcode, official) VALUES (?, ?, ?, 'land', 'KE', ?, ?, NULL, ?, ?, ?, ?, ?, ?)`,
  );
  const cod = 'CC BY-IGO';
  for (const [id, subtype, name, level, parent, pcode] of [
    ['cod:KEN:KE', 'country', 'Kenya', 0, null, 'KE'],
    ['cod:KEN:KE047', 'ADM1', 'Nairobi', 1, 'cod:KEN:KE', 'KE047'],
    ['cod:KEN:KE047001', 'ADM2', 'Westlands', 2, 'cod:KEN:KE047', 'KE047001'],
  ] as const) {
    insert.run(
      id,
      id,
      subtype,
      name,
      level,
      square,
      parent,
      'cod',
      cod,
      pcode,
      1,
    );
  }
  insert.run(
    'geoboundaries:KEN:X1',
    'geoboundaries:KEN:X1',
    'country',
    'Kenya',
    0,
    square,
    null,
    'geoboundaries',
    'Public Domain',
    null,
    0,
  );
  insert.run(
    'geoboundaries:KEN:X2',
    'geoboundaries:KEN:X2',
    'ADM1',
    'Nairobi',
    1,
    square,
    'geoboundaries:KEN:X1',
    'geoboundaries',
    'Public Domain',
    null,
    0,
  );
  const levels = JSON.stringify([
    { level: 'ADM0', areas: 1, kept: true },
    { level: 'ADM1', areas: 47, kept: true },
    { level: 'ADM2', areas: 291, areas_kept: 290, kept: true },
    { level: 'ADM3', areas: 1000, kept: false, coverage: 37.3 },
  ]);
  db.prepare(
    'INSERT INTO official_datasets VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(
    'KE',
    'cod',
    1,
    1,
    cod,
    '2019-10-31',
    'cod-enhanced',
    'https://data.humdata.org/dataset/cod-ab-ken',
    levels,
    '',
  );
  db.prepare(
    'INSERT INTO official_datasets VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run('KE', 'geoboundaries', 0, 1, 'Public Domain', '2020', '', '', '[]', '');
  db.close();
}

describe('BoundaryService official sources', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'turbopass-official-'));
  const savedPath = process.env.OVERTURE_DB_PATH;
  const file = path.join(dir, 'official.sqlite');
  makeOfficialDb(file);
  process.env.OVERTURE_DB_PATH = file;
  const svc = new BoundaryService({} as any, { get: () => undefined } as any);

  afterAll(() => {
    process.env.OVERTURE_DB_PATH = savedPath;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('keeps each source to its own rows', async () => {
    const names = async (source: string) =>
      (await svc.search('Nairobi', source)).features.map(
        (f: any) => f.properties.place_id,
      );
    expect(await names('official')).toEqual(['cod:KEN:KE047']);
    expect(await names('cod')).toEqual(['cod:KEN:KE047']);
    expect(await names('geoboundaries')).toEqual(['geoboundaries:KEN:X2']);
    expect(await names('overture')).toEqual([]);
    expect(
      (await svc.search('Delhi', 'overture')).features[0].properties.name,
    ).toBe('Delhi');
  });

  it('labels official hits with their ADM1 and carries source + licence', async () => {
    const res = await svc.search('Westlands', 'official');
    expect(res.features[0].properties).toMatchObject({
      place_id: 'cod:KEN:KE047001',
      subtype: 'ADM2',
      admin_level: 2,
      region_name: 'Nairobi',
      formatted: 'Westlands — Sub-county, Nairobi, Kenya',
      level_name: 'Sub-county',
      source: 'cod',
      licence: 'CC BY-IGO',
    });
    const overture = await svc.search('Delhi', 'overture');
    expect(overture.features[0].properties).toMatchObject({
      source: 'overture',
      licence: null,
    });
  });

  it('fetches an official subtree with licence and P-codes', async () => {
    const res = await svc.fetchBoundaries('cod:KEN:KE047', 'official');
    expect(
      res.features.map((f: any) => [
        f.properties.place_id,
        f.properties.admin_level,
        f.properties.pcode,
        f.properties.licence,
      ]),
    ).toEqual([
      ['cod:KEN:KE047', 1, 'KE047', 'CC BY-IGO'],
      ['cod:KEN:KE047001', 2, 'KE047001', 'CC BY-IGO'],
    ]);
    // Levels renumbered from the fetched place, with their local names.
    expect(
      res.features.map((f: any) => [
        f.properties.depth,
        f.properties.level_name,
      ]),
    ).toEqual([
      [0, 'County'],
      [1, 'Sub-county'],
    ]);
  });

  it("answers 404 for a place that isn't in the requested source", async () => {
    expect(await statusOf(svc.fetchBoundaries('dl', 'official'))).toBe(404);
    expect(
      await statusOf(svc.fetchBoundaries('cod:KEN:KE047', 'overture')),
    ).toBe(404);
  });

  it('reports the official sets per country', () => {
    expect(svc.sources()).toMatchObject({
      overture: true,
      official: true,
      cod: true,
      geoboundaries: true,
    });
    expect(svc.officialInfo()).toEqual({
      KE: {
        source: 'cod',
        licence: 'CC BY-IGO',
        dataset_date: '2019-10-31',
        quality: 'cod-enhanced',
        url: 'https://data.humdata.org/dataset/cod-ab-ken',
        levels: [
          { level: 'ADM0', areas: 1 },
          { level: 'ADM1', areas: 47 },
          { level: 'ADM2', areas: 290 },
        ],
        skipped: [{ source: 'geoboundaries', note: '' }],
      },
    });
  });

  it('answers 503 for official on a DB built without official sets', async () => {
    const plain = path.join(dir, 'plain.sqlite');
    makeDb(plain, true);
    process.env.OVERTURE_DB_PATH = plain;
    const old = new BoundaryService({} as any, { get: () => undefined } as any);
    expect(await statusOf(old.search('Nairobi', 'official'))).toBe(503);
    expect(await statusOf(old.search('Nairobi', 'nowhere'))).toBe(400);
  });
});

describe('BoundaryService geoapify quota', () => {
  const saved = process.env.GEOAPIFY_RATE_LIMIT;
  afterEach(() => {
    if (saved === undefined) delete process.env.GEOAPIFY_RATE_LIMIT;
    else process.env.GEOAPIFY_RATE_LIMIT = saved;
  });

  const serviceWith = (limit: number) => {
    process.env.GEOAPIFY_RATE_LIMIT = String(limit);
    const calls: string[] = [];
    const http = {
      get: (url: string) => {
        calls.push(url);
        return of({ data: { features: [] } });
      },
    };
    const config = {
      get: (k: string) => (k === 'GEOAPIFY_API_KEY' ? 'key' : undefined),
    };
    return { svc: new BoundaryService(http as any, config as any), calls };
  };

  it('reports a cap below one fetch as a config error, not a retry', async () => {
    const { svc, calls } = serviceWith(5); // a fetch needs 6 calls: never possible
    expect(await statusOf(svc.fetchBoundaries('place', 'geoapify'))).toBe(503);
    expect(calls).toHaveLength(0);
  });

  it('refuses a fetch once the quota is spent, before spending any of it', async () => {
    const { svc, calls } = serviceWith(6);
    await svc.fetchBoundaries('place', 'geoapify');
    const used = calls.length;
    expect(await statusOf(svc.fetchBoundaries('place', 'geoapify'))).toBe(429);
    expect(calls).toHaveLength(used);
  });

  it('runs a fetch that fits the quota', async () => {
    const { svc, calls } = serviceWith(6);
    await svc.fetchBoundaries('place', 'geoapify');
    expect(calls.length).toBeGreaterThan(0);
  });
});
