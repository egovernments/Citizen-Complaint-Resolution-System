import { HttpException } from '@nestjs/common';
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
    expect(svc.sources()).toEqual({ overture: true, geoapify: true });
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
