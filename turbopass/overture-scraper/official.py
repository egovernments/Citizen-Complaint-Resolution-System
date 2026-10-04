"""Step 4 of bootstrap.sh: add the official boundary sets next to Overture.

For every requested country this loads two government-derived sources into the
same `boundaries` table, then marks the better one as the country's
"official" set (#1994):

  cod            OCHA COD-AB from HDX (package cod-ab-<iso3>) — national
                 statistics / mapping offices, curated by OCHA. CC BY-IGO.
  geoboundaries  geoBoundaries gbOpen, one file per ADM level. Licence varies
                 by level (public domain, CC BY, ODbL) and is kept per row.

Every level must pass the same nesting check the 12-country evaluation used
before it is kept: its areas cover >= MIN_LEVEL_COVERAGE of the level above
(equal-area, ignoring slivers narrower than 100 m) and at most
MAX_LEVEL_ORPHANS of them sit outside it. A level that fails is dropped and
the next one is checked against the last level kept — that is what drops
Rwanda's COD ADM4 (cut off at exactly 1,000 rows) while keeping its villages
from geoBoundaries. The country's official source is then the one whose kept
levels go deepest (ties: more areas at the finest level, then an "enhanced"
COD, then COD).

Parents: every ADM1 area hangs off the country row; below that, COD links by
its parent P-code when the parent level was kept, and anything else by the
parent polygon holding the area's interior point (the configurator's rule).
The few areas that end up with no parent are dropped, and counted.

Rows are written with source = cod | geoboundaries, id = <source>:<ISO3>:<code>,
subtype = country | ADM<n>, admin_level = n, and official = 1 on the chosen
source's rows. What was kept, skipped and why lands in `official_datasets`.

Environment:
  COUNTRIES              ISO 3166-1 alpha-2 codes, as for scrape.py
  OFFICIAL_SOURCES       comma list of cod,geoboundaries (default both);
                         "none" skips this step
  MIN_LEVEL_COVERAGE     default 0.90
  MAX_LEVEL_ORPHANS      default 0.02
  MAX_LEVEL_FEATURES     skip a geoBoundaries level with more areas than this
                         without downloading it (default 100000; India's ADM5
                         alone is 649,771 areas / 1 GB)
  ALLOW_GADM_DERIVED     1 to keep COD sets built from GADM, whose licence
                         forbids commercial use (default 0: skipped)
  SIMPLIFY_TOLERANCE     as for build_hierarchy.py
  OVERTURE_DB_PATH       the DB to add to
"""
import glob
import http.client
import json
import os
import re
import sqlite3
import sys
import tempfile
import time
import urllib.error
import urllib.request
import zipfile
from dataclasses import dataclass, field
from datetime import datetime, timezone

import geopandas as gpd
import numpy as np
import pandas as pd
import pycountry
import pyogrio
import pyogrio.errors
import shapely

EQUAL_AREA = 'EPSG:6933'
SLIVER_M = 50.0  # half the width of a gap ignored as a sliver
MAX_ADM = 5
SOURCES = ('cod', 'geoboundaries')
HDX_PACKAGE = 'https://data.humdata.org/api/3/action/package_show?id=cod-ab-{iso3}'
GB_LEVEL = 'https://www.geoboundaries.org/api/current/gbOpen/{iso3}/ADM{n}/'
# COD bundles ship lines, points and label layers next to the polygons.
COD_NOT_POLYGONS = re.compile(r'line|point|capital|label|_em\b|_em_|centroid')
COD_LEVEL = re.compile(r'(?:admin|_adm)(\d)(?:[_.]|$)')


# ---------------------------------------------------------------- fetching

def _open(url, timeout=300):
    # urllib's own User-Agent on purpose: HDX answers unfamiliar agents with an
    # empty 202 bot challenge instead of the API response.
    return urllib.request.urlopen(url, timeout=timeout)


def get_json(url):
    """Parsed JSON, or None on 404 (no such dataset / level). Retries anything else."""
    problem = ''
    for attempt in range(3):
        try:
            with _open(url, timeout=120) as resp:
                body = resp.read()
                try:
                    return json.loads(body)
                except ValueError:
                    problem = f'HTTP {resp.status} with a non-JSON body ({len(body)} bytes) — a bot challenge or outage'
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            problem = f'HTTP {e.code}'
        except (urllib.error.URLError, TimeoutError) as e:
            problem = str(e)
        if attempt < 2:
            time.sleep(5 * (attempt + 1))
    raise RuntimeError(f'{url}: {problem}')


def download(url, dest):
    """Fetch url to dest, refusing a body shorter than its Content-Length (a dropped connection)."""
    for attempt in range(3):
        try:
            with _open(url) as resp, open(dest, 'wb') as out:
                expected = int(resp.headers.get('Content-Length') or 0)
                got = 0
                while chunk := resp.read(1 << 20):
                    out.write(chunk)
                    got += len(chunk)
            if expected and got != expected:
                raise IOError(f'{url}: got {got} of {expected} bytes')
            return dest
        except (urllib.error.URLError, http.client.HTTPException, TimeoutError, IOError):
            if attempt == 2:
                raise
            time.sleep(5 * (attempt + 1))


def read_downloaded(url, dest, **kwargs):
    """Download and read a vector file; one fresh download if it doesn't parse (a truncated
    transfer without Content-Length reads as 'Unterminated object')."""
    for attempt in range(2):
        download(url, dest)
        try:
            return pyogrio.read_dataframe(dest, **kwargs)
        except pyogrio.errors.DataSourceError:
            if attempt == 1:
                raise
            time.sleep(5)


# ---------------------------------------------------------------- loading

@dataclass
class Level:
    n: int
    gdf: gpd.GeoDataFrame  # name, code, parent_code, geometry (EPSG:4326)
    licence: str


@dataclass
class Dataset:
    source: str
    iso3: str
    levels: list = field(default_factory=list)
    licence: str = ''
    date: str = ''
    quality: str = ''  # COD: cod-enhanced / cod-standard
    url: str = ''
    usable: bool = True
    note: str = ''


def _first(cols, *candidates):
    return next((c for c in candidates if c in cols), None)


def cod_frame(gdf, n):
    """A COD layer → name / code / parent_code. COD column names changed over the years."""
    gdf = gdf.rename(columns=str.lower)
    cols = set(gdf.columns)
    name = _first(cols, f'adm{n}_name', f'adm{n}_en', f'admin{n}name_en', f'adm{n}_name1', f'admin{n}name')
    code = _first(cols, f'adm{n}_pcode', f'admin{n}pcode')
    parent = _first(cols, f'adm{n - 1}_pcode', f'admin{n - 1}pcode') if n > 0 else None
    return gpd.GeoDataFrame({
        'name': gdf[name].astype('string') if name else pd.Series([None] * len(gdf), dtype='string'),
        'code': gdf[code].astype('string') if code else pd.Series([None] * len(gdf), dtype='string'),
        'parent_code': gdf[parent].astype('string') if parent else pd.Series([None] * len(gdf), dtype='string'),
    }, geometry=gdf.geometry.values, crs=gdf.crs)


def cod_layer_files(root):
    """(level, path, layer) for every polygon layer in an extracted COD bundle."""
    found = {}
    candidates = []
    for p in sorted(glob.glob(os.path.join(root, '**', '*'), recursive=True)):
        low = p.lower()
        if low.endswith('.gdb') and os.path.isdir(p):
            candidates += [(p, lyr) for lyr, _ in pyogrio.list_layers(p)]
        elif low.endswith(('.shp', '.geojson', '.json')):
            candidates.append((p, None))
    for path, layer in candidates:
        label = (layer or os.path.basename(path)).lower()
        m = COD_LEVEL.search(label)
        if not m or COD_NOT_POLYGONS.search(label):
            continue
        found.setdefault(int(m.group(1)), (path, layer))
    return [(n, path, layer) for n, (path, layer) in sorted(found.items())]


def load_cod(iso3, workdir, allow_gadm):
    ds = Dataset('cod', iso3)
    pkg = get_json(HDX_PACKAGE.format(iso3=iso3.lower()))
    if not pkg or not pkg.get('success'):
        ds.usable, ds.note = False, 'no COD-AB dataset on HDX'
        return ds
    r = pkg['result']
    ds.licence = r.get('license_title') or ''
    ds.quality = r.get('cod_level') or ''
    ds.date = (r.get('dataset_date') or '').strip('[').split(' ')[0][:10]
    ds.url = f"https://data.humdata.org/dataset/{r.get('name', f'cod-ab-{iso3.lower()}')}"
    if 'gadm' in (r.get('dataset_source') or '').lower() or any('gadm' in (x.get('name') or '').lower() for x in r['resources']):
        ds.note = 'geometry is GADM (licence forbids commercial use)'
        if not allow_gadm:
            ds.usable = False
            return ds
    order = {'geojson': 0, 'shp': 1, 'geodatabase': 2}
    zips = [x for x in r['resources'] if (x.get('format') or '').lower() in order and (x.get('url') or '').lower().endswith('.zip')]
    if not zips:
        ds.usable, ds.note = False, 'no GeoJSON/SHP/GDB download'
        return ds
    res = min(zips, key=lambda x: order[x['format'].lower()])
    dest = os.path.join(workdir, 'cod.zip')
    download(res['url'], dest)
    root = os.path.join(workdir, 'cod')
    with zipfile.ZipFile(dest) as z:
        z.extractall(root)
    for n, path, layer in cod_layer_files(root):
        g = pyogrio.read_dataframe(path, layer=layer) if layer else pyogrio.read_dataframe(path)
        if g.crs is None:  # Brazil's COD ships without a .prj
            g = g.set_crs('EPSG:4326')
        ds.levels.append(Level(n, cod_frame(g.to_crs('EPSG:4326'), n), ds.licence))
    if not ds.levels:
        ds.usable, ds.note = False, 'no admin polygon layers in the download'
    return ds


def load_geoboundaries(iso3, workdir, max_features):
    ds = Dataset('geoboundaries', iso3, url=f'https://www.geoboundaries.org/countryDownloads.html#{iso3}')
    years, skipped = [], []
    for n in range(MAX_ADM + 1):
        meta = get_json(GB_LEVEL.format(iso3=iso3, n=n))
        if not meta:
            break
        count = int(meta.get('admUnitCount') or 0)
        if max_features and count > max_features:
            skipped.append(f'ADM{n} not downloaded ({count:,} areas > MAX_LEVEL_FEATURES)')
            break
        g = read_downloaded(meta['gjDownloadURL'], os.path.join(workdir, f'gb-adm{n}.geojson'))
        if g.crs is None:
            g = g.set_crs('EPSG:4326')
        g = g.to_crs('EPSG:4326')
        frame = gpd.GeoDataFrame({
            'name': g['shapeName'].astype('string') if 'shapeName' in g else pd.Series([None] * len(g), dtype='string'),
            'code': g['shapeID'].astype('string') if 'shapeID' in g else pd.Series([None] * len(g), dtype='string'),
            'parent_code': pd.Series([None] * len(g), dtype='string'),
        }, geometry=g.geometry.values, crs='EPSG:4326')
        ds.levels.append(Level(n, frame, meta.get('boundaryLicense') or ''))
        years.append(str(meta.get('boundaryYearRepresented') or ''))
    ds.licence = '; '.join(sorted({lv.licence for lv in ds.levels if lv.licence}))
    ds.date = '/'.join(sorted({y for y in years if y}))
    ds.note = '; '.join(skipped)
    if not ds.levels:
        ds.usable, ds.note = False, 'no geoBoundaries release for this country'
    return ds


# ---------------------------------------------------------------- checking

def _fix(geoms):
    g = shapely.set_precision(np.asarray(geoms, dtype=object), 1.0, mode='pointwise')
    return shapely.make_valid(shapely.buffer(g, 0))


def prepare(level):
    """Valid, non-empty areas with equal-area geometry, area and interior point."""
    g = level.gdf.copy()
    g['geometry'] = shapely.make_valid(g.geometry.values)
    g = g[~g.geometry.is_empty & g.geometry.notna()].reset_index(drop=True)
    ea = g.to_crs(EQUAL_AREA)
    g['ea'] = ea.geometry.values
    g['area'] = shapely.area(g['ea'].values)
    g['rep'] = shapely.point_on_surface(g['ea'].values)
    level.gdf = g
    return level


def spatial_parents(child, parent):
    """Index of the smallest parent polygon holding each child's interior point, or -1."""
    tree = shapely.STRtree(parent['ea'].values)
    ci, pi = tree.query(child['rep'].values, predicate='within')
    out = np.full(len(child), -1)
    if len(ci):
        pairs = pd.DataFrame({'c': ci, 'p': pi, 'a': parent['area'].values[pi]}).sort_values('a')
        first = pairs.drop_duplicates('c')
        out[first['c'].values] = first['p'].values
    return out


def code_parents(child, parent):
    """Parent by COD P-code; -1 where the code is missing or unknown."""
    index = {c: i for i, c in enumerate(parent['code'].tolist()) if isinstance(c, str) and c}
    return np.array([index.get(c, -1) if isinstance(c, str) else -1 for c in child['parent_code'].tolist()])


def opened(g):
    """Drop parts narrower than 2 x SLIVER_M (border mismatches, river channels)."""
    return shapely.buffer(shapely.buffer(g, -SLIVER_M), SLIVER_M)


def nesting(child, parent, p_of):
    """(coverage, orphan share) of `child` under `parent` for the given links."""
    gap = total = 0.0
    for p in range(len(parent)):
        pg = parent['ea'].values[p]
        pa = parent['area'].values[p]
        total += pa
        kids = child['ea'].values[p_of == p]
        if len(kids) == 0:
            gap += pa
            continue
        try:
            rest = shapely.difference(pg, shapely.union_all(kids))
        except shapely.errors.GEOSException:
            rest = shapely.difference(_fix([pg])[0], shapely.union_all(_fix(kids)))
        gap += shapely.area(opened(rest))
    coverage = 1 - gap / total if total else 0.0
    return coverage, float(np.mean(p_of < 0)) if len(p_of) else 1.0


def check_levels(ds, min_cov, max_orphans):
    """Keep the levels that nest; set each kept level's `parent` column. Returns the report."""
    report = []
    levels = [prepare(lv) for lv in sorted(ds.levels, key=lambda lv: lv.n)]
    levels = [lv for lv in levels if len(lv.gdf)]
    if not levels or levels[0].n != 0:
        ds.usable, ds.note = False, 'no country outline (ADM0)'
        return report
    root = levels[0]
    if len(root.gdf) > 1:  # one row per country: the fetch starts from it
        merged = root.gdf.iloc[[0]].copy()
        merged['geometry'] = [shapely.union_all(root.gdf.geometry.values)]
        root.gdf = prepare(Level(0, merged[['name', 'code', 'parent_code', 'geometry']], root.licence)).gdf
    root.gdf['parent'] = -1
    kept = [root]
    report.append({'level': 'ADM0', 'areas': 1, 'areas_kept': 1, 'kept': True})
    for lv in levels[1:]:
        par = kept[-1]
        if par.n == 0:
            p_of = np.zeros(len(lv.gdf), dtype=int)  # the country holds everything in it
        else:
            p_of = code_parents(lv.gdf, par.gdf) if ds.source == 'cod' and par.n == lv.n - 1 else np.full(len(lv.gdf), -1)
            missing = p_of < 0
            if missing.any():
                p_of[missing] = spatial_parents(lv.gdf[missing].reset_index(drop=True), par.gdf)
        coverage, orphans = nesting(lv.gdf, par.gdf, p_of)
        ok = bool(coverage >= min_cov and orphans <= max_orphans)
        report.append({'level': f'ADM{lv.n}', 'areas': len(lv.gdf), 'parent': f'ADM{par.n}',
                       'coverage': round(100 * float(coverage), 1), 'orphans': round(100 * float(orphans), 1), 'kept': ok})
        if ok:
            lv.gdf['parent'] = p_of
            dropped = int((p_of < 0).sum())
            if dropped:
                lv.gdf = lv.gdf[p_of >= 0].reset_index(drop=True)
                report[-1]['dropped_outside_parent'] = dropped
            report[-1]['areas_kept'] = len(lv.gdf)
            kept.append(lv)
    ds.levels = kept
    return report


def choose(datasets):
    """The usable dataset whose kept levels go deepest; None when none has a level below ADM0."""
    usable = [d for d in datasets if d.usable and len(d.levels) > 1]
    if not usable:
        return None
    return max(usable, key=lambda d: (len(d.levels), len(d.levels[-1].gdf), d.quality == 'cod-enhanced', d.source == 'cod'))


# ---------------------------------------------------------------- writing

def rows_for(ds, alpha2, tolerance, chosen):
    prefix = f'{ds.source}:{ds.iso3}'
    ids_by_level = {}
    # One id space for the whole dataset: a code reused at two levels (a city that
    # is both ADM1 and ADM2 under one P-code) must not collide on boundaries.id.
    seen = {}
    out = []
    for i, lv in enumerate(ds.levels):
        g = lv.gdf
        codes = [c if isinstance(c, str) and c else f'ADM{lv.n}-{k}' for k, c in enumerate(g['code'].tolist())]
        ids = []
        for c in codes:  # a repeated code must not collapse two areas into one row
            seen[c] = seen.get(c, 0) + 1
            ids.append(f'{prefix}:{c}' if seen[c] == 1 else f'{prefix}:{c}#{seen[c]}')
        ids_by_level[i] = ids
        # Only COD codes are P-codes; a geoBoundaries shapeID is an internal id.
        pcodes = [c if ds.source == 'cod' and not c.startswith('ADM') else None for c in codes]
        geoms = g.geometry.values
        if tolerance > 0:
            geoms = shapely.simplify(geoms, tolerance, preserve_topology=True)
        geoms = shapely.transform(np.asarray(geoms), lambda xy: np.round(xy, 6))
        bounds = shapely.bounds(g.geometry.values)
        parent_ids = ids_by_level[i - 1] if i > 0 else []
        for k in range(len(g)):
            p = int(g['parent'].values[k])
            name = g['name'].values[k]
            out.append((
                ids[k], ids[k], 'country' if lv.n == 0 else f'ADM{lv.n}', 'land', alpha2,
                None if pd.isna(name) else str(name), lv.n,
                json.dumps({'xmin': bounds[k][0], 'xmax': bounds[k][2], 'ymin': bounds[k][1], 'ymax': bounds[k][3]}),
                shapely.to_geojson(geoms[k]), parent_ids[p] if i > 0 and p >= 0 else None,
                ds.source, lv.licence, pcodes[k], 1 if chosen else 0,
            ))
    return out


def ensure_schema(cur):
    have = {r[1] for r in cur.execute('PRAGMA table_info(boundaries)')}
    for col, typ in (('parent_id', 'VARCHAR'), ('source', 'VARCHAR'), ('licence', 'VARCHAR'),
                     ('pcode', 'VARCHAR'), ('official', 'INTEGER')):
        if col not in have:
            cur.execute(f'ALTER TABLE boundaries ADD COLUMN {col} {typ}')
    cur.execute("UPDATE boundaries SET source = 'overture' WHERE source IS NULL")
    cur.execute('UPDATE boundaries SET official = 0 WHERE official IS NULL')
    cur.execute('CREATE INDEX IF NOT EXISTS idx_boundaries_source ON boundaries(source)')
    cur.execute('CREATE INDEX IF NOT EXISTS idx_boundaries_parent ON boundaries(parent_id)')
    cur.execute("""CREATE TABLE IF NOT EXISTS official_datasets (
        country VARCHAR, source VARCHAR, chosen INTEGER, usable INTEGER, licence VARCHAR,
        dataset_date VARCHAR, quality VARCHAR, url VARCHAR, levels JSON, note VARCHAR,
        PRIMARY KEY (country, source))""")
    cur.execute('CREATE TABLE IF NOT EXISTS meta (key VARCHAR PRIMARY KEY, value VARCHAR)')


def requested_sources():
    raw = os.environ.get('OFFICIAL_SOURCES', ','.join(SOURCES)).strip().lower()
    if raw in ('', 'none', 'off', '0'):
        return []
    sources = [s.strip() for s in raw.split(',') if s.strip()]
    bad = [s for s in sources if s not in SOURCES]
    if bad:
        sys.exit(f'ERROR: OFFICIAL_SOURCES accepts {", ".join(SOURCES)} or none, got {raw!r}')
    return sources


def main():
    sources = requested_sources()
    if not sources:
        print('OFFICIAL_SOURCES=none — skipping official boundary sets.')
        return
    db_path = os.environ.get('OVERTURE_DB_PATH', '../overture-data/boundaries.sqlite')
    countries = [c.strip().upper() for c in os.environ.get('COUNTRIES', 'IN,KE,MZ').split(',') if c.strip()]
    min_cov = float(os.environ.get('MIN_LEVEL_COVERAGE', '0.90'))
    max_orphans = float(os.environ.get('MAX_LEVEL_ORPHANS', '0.02'))
    max_features = int(os.environ.get('MAX_LEVEL_FEATURES', '100000'))
    allow_gadm = os.environ.get('ALLOW_GADM_DERIVED', '0') == '1'
    tolerance = float(os.environ.get('SIMPLIFY_TOLERANCE', '0.0001'))

    conn = sqlite3.connect(db_path)
    cur = conn.cursor()
    ensure_schema(cur)
    conn.commit()
    placeholders = ', '.join('?' * len(sources))
    for alpha2 in countries:
        country = pycountry.countries.get(alpha_2=alpha2)
        if not country:
            print(f'  {alpha2}: unknown ISO 3166-1 code — skipped')
            continue
        iso3 = country.alpha_3
        datasets, reports = [], {}
        for src in sources:
            with tempfile.TemporaryDirectory() as tmp:
                try:
                    ds = load_cod(iso3, tmp, allow_gadm) if src == 'cod' else load_geoboundaries(iso3, tmp, max_features)
                    if ds.usable:
                        reports[src] = check_levels(ds, min_cov, max_orphans)
                except Exception as e:  # one broken source must not hide the other
                    ds = Dataset(src, iso3, usable=False, note=f'failed: {type(e).__name__}: {e}'[:500])
            datasets.append(ds)
        best = choose(datasets)
        cur.execute(f'DELETE FROM boundaries WHERE country = ? AND source IN ({placeholders})', (alpha2, *sources))
        cur.execute(f'DELETE FROM official_datasets WHERE country = ? AND source IN ({placeholders})', (alpha2, *sources))
        for ds in datasets:
            chosen = ds is best
            if ds.usable and len(ds.levels) > 0:
                cur.executemany(
                    'INSERT INTO boundaries (id, division_id, subtype, class, country, name, admin_level, bbox, geometry, '
                    'parent_id, source, licence, pcode, official) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                    rows_for(ds, alpha2, tolerance, chosen),
                )
            cur.execute('INSERT INTO official_datasets VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', (
                alpha2, ds.source, int(chosen), int(ds.usable), ds.licence, ds.date, ds.quality, ds.url,
                json.dumps(reports.get(ds.source, [])), ds.note))
            kept = ' → '.join(f"{lv.n}:{len(lv.gdf):,}" for lv in ds.levels) if ds.usable else '-'
            print(f"  {alpha2} {ds.source:13} {'CHOSEN ' if chosen else '       '}levels {kept}"
                  f"{'  (' + ds.note + ')' if ds.note else ''}")
            for r in reports.get(ds.source, []):
                if not r['kept']:
                    print(f"      dropped {r['level']}: {r['coverage']}% coverage of {r['parent']}, {r['orphans']}% outside it")
        conn.commit()
    cur.execute("INSERT OR REPLACE INTO meta VALUES ('official_sources', ?)", (','.join(sources),))
    cur.execute("INSERT OR REPLACE INTO meta VALUES ('official_built_at', ?)",
                (datetime.now(timezone.utc).isoformat(timespec='seconds'),))
    conn.commit()
    cur.execute('VACUUM')
    conn.close()
    print('Official boundary sets added.')


if __name__ == '__main__':
    main()
