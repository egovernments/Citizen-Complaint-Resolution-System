"""Offline checks for official.py's level check, parent links and choice.

    python3 -m unittest test_official      (needs the image's geo deps)

Geometry is built in degrees near the equator, where a 0.1-degree square is
~11 km across — far above the 100 m sliver cut.
"""
import json
import os
import tempfile
import unittest

import geopandas as gpd
import numpy as np
import pandas as pd
from shapely.geometry import box

import official


def level(n, cells, parents=None, codes=None, licence='CC BY'):
    """A Level of 0.1-degree squares at the given (col, row) cells."""
    geoms = [box(x * 0.1, y * 0.1, (x + 1) * 0.1, (y + 1) * 0.1) for x, y in cells]
    return official.Level(n, gpd.GeoDataFrame({
        'name': [f'L{n}-{i}' for i in range(len(cells))],
        'code': codes or [f'C{n}-{i}' for i in range(len(cells))],
        'parent_code': parents or [None] * len(cells),
    }, geometry=geoms, crs='EPSG:4326'), licence)


def square(n, x0, y0, size, code, parent=None):
    g = box(x0 * 0.1, y0 * 0.1, (x0 + size) * 0.1, (y0 + size) * 0.1)
    return official.Level(n, gpd.GeoDataFrame({'name': [code], 'code': [code], 'parent_code': [parent]},
                                              geometry=[g], crs='EPSG:4326'), 'CC BY')


def quad(n, x0, y0, size, prefix, parent=None):
    """Four equal children covering the square (x0, y0, size)."""
    h = size / 2
    cells = [(x0, y0), (x0 + h, y0), (x0, y0 + h), (x0 + h, y0 + h)]
    geoms = [box(x * 0.1, y * 0.1, (x + h) * 0.1, (y + h) * 0.1) for x, y in cells]
    return gpd.GeoDataFrame({'name': [f'{prefix}{i}' for i in range(4)], 'code': [f'{prefix}{i}' for i in range(4)],
                             'parent_code': [parent] * 4}, geometry=geoms, crs='EPSG:4326')


def concat(n, frames):
    return official.Level(n, gpd.GeoDataFrame(pd.concat(frames, ignore_index=True), crs='EPSG:4326'), 'CC BY')


def nested_country(source='geoboundaries'):
    """ADM0 = 4x4 square; ADM1 = its 4 quarters; ADM2 = 16 cells, 4 per quarter."""
    ds = official.Dataset(source, 'TST')
    ds.levels = [square(0, 0, 0, 4, 'TST')]
    adm1 = quad(1, 0, 0, 4, 'A', 'TST')
    ds.levels.append(official.Level(1, adm1, 'CC BY'))
    kids = [quad(2, x, y, 2, f'A{i}-', f'A{i}') for i, (x, y) in enumerate([(0, 0), (2, 0), (0, 2), (2, 2)])]
    ds.levels.append(concat(2, kids))
    return ds


class CheckLevels(unittest.TestCase):
    def test_keeps_a_fully_nested_chain_and_links_every_parent(self):
        ds = nested_country()
        report = official.check_levels(ds, 0.9, 0.02)
        self.assertEqual([lv.n for lv in ds.levels], [0, 1, 2])
        self.assertTrue(all(r['kept'] for r in report))
        self.assertEqual(report[2]['coverage'], 100.0)
        self.assertEqual(report[2]['orphans'], 0.0)
        # Each quarter holds exactly its four cells.
        self.assertEqual(sorted(np.bincount(ds.levels[2].gdf['parent'].values).tolist()), [4, 4, 4, 4])

    def test_drops_a_truncated_level_and_checks_the_next_against_the_last_kept(self):
        # Rwanda's COD ADM4 shape: the level exists but covers a fraction of its parent.
        ds = nested_country()
        adm2 = ds.levels[2]
        ds.levels[2] = official.Level(2, adm2.gdf.iloc[:4].reset_index(drop=True), 'CC BY')  # one quarter only
        adm3 = quad(3, 0, 0, 4, 'Z')  # a complete deeper level
        ds.levels.append(official.Level(3, adm3, 'CC BY'))
        report = official.check_levels(ds, 0.9, 0.02)
        self.assertEqual([r['kept'] for r in report], [True, True, False, True])
        json.dumps(report)  # stored as-is in official_datasets.levels — no numpy scalars
        self.assertEqual(report[2]['coverage'], 25.0)
        self.assertEqual(report[3]['parent'], 'ADM1')  # measured against the last level kept
        self.assertEqual([lv.n for lv in ds.levels], [0, 1, 3])

    def test_cod_links_by_parent_pcode(self):
        ds = nested_country('cod')
        # Swap two ADM2 codes' parents: geometry says A0, the P-code says A1.
        ds.levels[2].gdf.loc[0, 'parent_code'] = 'A1'
        official.check_levels(ds, 0.0, 1.0)
        adm1_codes = ds.levels[1].gdf['code'].tolist()
        self.assertEqual(adm1_codes[ds.levels[2].gdf['parent'].values[0]], 'A1')

    def test_orphans_fail_the_level(self):
        ds = nested_country()
        stray = square(2, 10, 10, 1, 'far')  # outside the country entirely
        ds.levels[2] = concat(2, [ds.levels[2].gdf, stray.gdf])
        report = official.check_levels(ds, 0.9, 0.02)
        self.assertFalse(report[2]['kept'])
        self.assertAlmostEqual(report[2]['orphans'], round(100 / 17, 1))

    def test_orphans_under_the_limit_are_dropped_and_counted(self):
        ds = nested_country()
        stray = square(2, 10, 10, 1, 'far')
        ds.levels[2] = concat(2, [ds.levels[2].gdf, stray.gdf])
        report = official.check_levels(ds, 0.9, 0.10)
        self.assertTrue(report[2]['kept'])
        self.assertEqual(report[2]['dropped_outside_parent'], 1)
        self.assertEqual((report[2]['areas'], report[2]['areas_kept']), (17, 16))
        self.assertEqual(len(ds.levels[2].gdf), 16)

    def test_no_country_outline_makes_the_set_unusable(self):
        ds = nested_country()
        ds.levels = ds.levels[1:]
        official.check_levels(ds, 0.9, 0.02)
        self.assertFalse(ds.usable)


class Choose(unittest.TestCase):
    def make(self, source, depth, finest, quality=''):
        ds = official.Dataset(source, 'TST', quality=quality)
        ds.levels = [official.Level(i, gpd.GeoDataFrame({'x': range(finest if i == depth - 1 else 1)}), '')
                     for i in range(depth)]
        return ds

    def test_deepest_wins(self):
        self.assertEqual(official.choose([self.make('cod', 3, 50), self.make('geoboundaries', 5, 10)]).source,
                         'geoboundaries')

    def test_tie_goes_to_more_areas_then_enhanced_cod(self):
        self.assertEqual(official.choose([self.make('cod', 3, 39), self.make('geoboundaries', 3, 40)]).source,
                         'geoboundaries')
        self.assertEqual(official.choose([self.make('cod', 3, 39, 'cod-enhanced'),
                                          self.make('geoboundaries', 3, 39)]).source, 'cod')
        # A full tie (South Africa: the same 4,392 wards in both) still picks COD.
        self.assertEqual(official.choose([self.make('geoboundaries', 5, 4392),
                                          self.make('cod', 5, 4392)]).source, 'cod')

    def test_unusable_or_country_only_sets_are_never_chosen(self):
        gadm = self.make('cod', 4, 20)
        gadm.usable = False
        self.assertIsNone(official.choose([gadm, self.make('geoboundaries', 1, 1)]))


class Agreement(unittest.TestCase):
    def checked(self, ds):
        report = official.check_levels(ds, 0.9, 0.02)
        return ds, report

    def test_identical_sources_match_everywhere(self):
        best, report = self.checked(nested_country('cod'))
        other, _ = self.checked(nested_country('geoboundaries'))
        official.add_agreement(best, [best, other], {'cod': report})
        self.assertEqual([(r['level'], r['other_areas'], r['matched']) for r in report[1:]],
                         [('ADM1', 4, 100.0), ('ADM2', 16, 100.0)])
        self.assertNotIn('matched', report[0])  # the country row is not compared

    def test_a_redrawn_area_is_unmatched_and_named(self):
        best, report = self.checked(nested_country('cod'))
        other = nested_country('geoboundaries')
        # The other source draws cell A0-0 shifted by half its width: overlap 1/3 of the combined area.
        cells = other.levels[2].gdf
        cells.loc[0, 'geometry'] = box(0.05, 0.0, 0.15, 0.1)
        other, _ = self.checked(other)
        official.add_agreement(best, [best, other], {'cod': report})
        adm2 = report[2]
        self.assertEqual(adm2['matched'], round(100 * 15 / 16, 1))
        self.assertEqual(adm2['unmatched'], ['A0-0'])
        self.assertEqual(report[1]['matched'], 100.0)

    def test_many_mismatches_are_counted_but_not_named(self):
        best, report = self.checked(nested_country('cod'))
        other = official.Dataset('geoboundaries', 'TST')
        # Same outline, but split into 4 vertical strips instead of 4 quarters.
        strips = [box(x * 0.1, 0, (x + 1) * 0.1, 0.4) for x in range(4)]
        other.levels = [square(0, 0, 0, 4, 'TST'), official.Level(1, gpd.GeoDataFrame(
            {'name': list('WXYZ'), 'code': list('WXYZ'), 'parent_code': ['TST'] * 4},
            geometry=strips, crs='EPSG:4326'), 'CC BY')]
        other, _ = self.checked(other)
        official.add_agreement(best, [best, other], {'cod': report})
        self.assertEqual(report[1]['matched'], 0.0)
        self.assertEqual(report[1]['unmatched'], [])  # 4 off > MAX_NAMED_MISMATCHES
        # The other source stops at ADM1: ADM2 has no second source.
        self.assertEqual((report[2]['other_areas'], report[2]['matched']), (0, None))

    def test_no_usable_second_source(self):
        best, report = self.checked(nested_country('cod'))
        gadm = official.Dataset('geoboundaries', 'TST', usable=False)
        official.add_agreement(best, [best, gadm], {'cod': report})
        self.assertEqual({(r['other_areas'], r['matched']) for r in report[1:]}, {(0, None)})


    def test_a_source_that_failed_to_load_is_not_measured_rather_than_absent(self):
        best, report = self.checked(nested_country('cod'))
        down = official.Dataset('geoboundaries', 'TST', usable=False, note='failed: URLError: timed out')
        official.add_agreement(best, [best, down], {'cod': report})
        self.assertEqual({(r['other_areas'], r['matched']) for r in report[1:]}, {(None, None)})

    def test_a_level_the_other_source_dropped_is_not_measured(self):
        best, report = self.checked(nested_country('cod'))
        other = nested_country('geoboundaries')
        other.levels[2] = official.Level(2, other.levels[2].gdf.iloc[:4].reset_index(drop=True), 'CC BY')  # truncated
        other, other_report = self.checked(other)
        self.assertFalse(other_report[2]['kept'])
        official.add_agreement(best, [best, other], {'cod': report, 'geoboundaries': other_report})
        self.assertEqual(report[1]['matched'], 100.0)
        self.assertEqual((report[2]['other_areas'], report[2]['matched']), (None, None))


class CodFiles(unittest.TestCase):
    def test_level_files_skip_lines_points_and_labels(self):
        with tempfile.TemporaryDirectory() as d:
            for f in ('ken_admin0.geojson', 'ken_admin1.geojson', 'ken_adminlines.geojson', 'ken_adminpoints.geojson',
                      'ken_admbnda_adm2_iebc_20191031.shp', 'ken_admbndl_admALL_iebc.shp', 'ken_admincapitals.geojson'):
                open(os.path.join(d, f), 'w').close()
            self.assertEqual([(n, os.path.basename(p)) for n, p, _ in official.cod_layer_files(d)],
                             [(0, 'ken_admin0.geojson'), (1, 'ken_admin1.geojson'),
                              (2, 'ken_admbnda_adm2_iebc_20191031.shp')])

    def test_old_and_new_cod_column_names(self):
        for cols in ({'ADM2_EN': ['x'], 'ADM2_PCODE': ['K1'], 'ADM1_PCODE': ['K']},
                     {'adm2_name': ['x'], 'adm2_pcode': ['K1'], 'adm1_pcode': ['K']}):
            f = official.cod_frame(gpd.GeoDataFrame(cols, geometry=[box(0, 0, 1, 1)], crs='EPSG:4326'), 2)
            self.assertEqual(f.iloc[0][['name', 'code', 'parent_code']].tolist(), ['x', 'K1', 'K'])

    def test_language_suffixed_name_columns(self):
        # Brazil's COD names areas in ADM2_PT only; ADM2_REF is not a language.
        cols = {'ADM2_PT': ['Acrelândia'], 'ADM2_REF': ['r'], 'ADM2_PCODE': ['BR1200013'], 'ADM1_PCODE': ['BR12']}
        f = official.cod_frame(gpd.GeoDataFrame(cols, geometry=[box(0, 0, 1, 1)], crs='EPSG:4326'), 2)
        self.assertEqual(f.iloc[0]['name'], 'Acrelândia')

    def test_a_latin_script_language_wins_over_alphabetical_order(self):
        cols = {'ADM1_AR': ['جيبوتي'], 'ADM1_FR': ['Djibouti'], 'ADM1_PCODE': ['DJ01'], 'ADM0_PCODE': ['DJ']}
        f = official.cod_frame(gpd.GeoDataFrame(cols, geometry=[box(0, 0, 1, 1)], crs='EPSG:4326'), 1)
        self.assertEqual(f.iloc[0]['name'], 'Djibouti')


class Download(unittest.TestCase):
    """A dropped connection must fail loudly, not leave a truncated file behind."""

    def serve(self, body, claimed_length):
        import http.server
        import threading

        class Handler(http.server.BaseHTTPRequestHandler):
            calls = 0

            def do_GET(self):
                Handler.calls += 1
                self.send_response(200)
                self.send_header('Content-Length', str(claimed_length))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *args):
                pass

        server = http.server.HTTPServer(('127.0.0.1', 0), Handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.shutdown)
        return f'http://127.0.0.1:{server.server_port}/f', Handler

    def setUp(self):
        self._sleep = official.time.sleep
        official.time.sleep = lambda s: None
        self.addCleanup(setattr, official.time, 'sleep', self._sleep)

    def test_short_body_is_retried_then_refused(self):
        url, handler = self.serve(b'{"type": "Feat', 500)
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaises(Exception):
                official.download(url, os.path.join(d, 'x.geojson'))
        self.assertEqual(handler.calls, 3)

    def test_complete_body_is_kept(self):
        body = b'{"type": "FeatureCollection", "features": []}'
        url, _ = self.serve(body, len(body))
        with tempfile.TemporaryDirectory() as d:
            dest = official.download(url, os.path.join(d, 'x.geojson'))
            self.assertEqual(open(dest, 'rb').read(), body)


class Polygonal(unittest.TestCase):
    def test_stray_lines_are_dropped_from_a_repaired_area(self):
        from shapely.geometry import GeometryCollection, LineString
        area = box(0, 0, 1, 1)
        out = official.polygonal([GeometryCollection([area, LineString([(2, 2), (3, 3)])]), area, None])
        self.assertEqual([g.geom_type if g is not None else None for g in out], ['Polygon', 'Polygon', None])
        self.assertTrue(out[0].equals(area))

    def test_several_polygon_parts_stay_together(self):
        from shapely.geometry import GeometryCollection, LineString
        out = official.polygonal([GeometryCollection([box(0, 0, 1, 1), box(5, 5, 6, 6), LineString([(2, 2), (3, 3)])])])
        self.assertEqual(out[0].geom_type, 'MultiPolygon')


class Rows(unittest.TestCase):
    def test_rows_link_to_parent_ids_and_carry_source_and_licence(self):
        ds = nested_country('cod')
        official.check_levels(ds, 0.9, 0.02)
        rows = official.rows_for(ds, 'TS', 0.0, True)
        by_id = {r[0]: r for r in rows}
        self.assertEqual(len(rows), 21)
        root = by_id['cod:TST:TST']
        self.assertEqual((root[2], root[6], root[9]), ('country', 0, None))
        cell = by_id['cod:TST:A2-3']
        self.assertEqual((cell[2], cell[6], cell[9], cell[10], cell[11], cell[13]),
                         ('ADM2', 2, 'cod:TST:A2', 'cod', 'CC BY', 1))
        self.assertEqual(set(json.loads(cell[7])), {'xmin', 'xmax', 'ymin', 'ymax'})

    def test_only_cod_rows_carry_a_pcode(self):
        ds = nested_country('geoboundaries')
        official.check_levels(ds, 0.9, 0.02)
        rows = official.rows_for(ds, 'TS', 0.0, True)
        self.assertEqual({r[12] for r in rows}, {None})
        self.assertEqual(rows[1][0], 'geoboundaries:TST:A0')  # the shapeID still makes the id

    def test_a_code_reused_across_levels_gets_distinct_ids(self):
        # COD: a city that is both ADM1 and ADM2 under one P-code.
        ds = nested_country('cod')
        ds.levels[2].gdf.loc[0, 'code'] = 'A0'  # same code as the ADM1 above it
        official.check_levels(ds, 0.9, 0.02)
        ids = [r[0] for r in official.rows_for(ds, 'TS', 0.0, True)]
        self.assertEqual(len(ids), len(set(ids)))

    def test_repeated_codes_get_distinct_ids(self):
        ds = nested_country()
        ds.levels[2].gdf['code'] = 'same'
        official.check_levels(ds, 0.9, 0.02)
        ids = [r[0] for r in official.rows_for(ds, 'TS', 0.0, False)]
        self.assertEqual(len(ids), len(set(ids)))


class VerifyDb(unittest.TestCase):
    """verify_db.py against a tiny DB: one weak country must not sink the rest."""

    def run_verify(self, chosen_by_country):
        import sqlite3
        import subprocess
        import sys
        d = tempfile.mkdtemp()
        db = os.path.join(d, 'b.sqlite')
        c = sqlite3.connect(db)
        c.execute('CREATE TABLE boundaries (id VARCHAR PRIMARY KEY, division_id VARCHAR, subtype VARCHAR, class VARCHAR, '
                  'country VARCHAR, name VARCHAR, admin_level INTEGER, bbox JSON, geometry JSON, parent_id VARCHAR, '
                  'source VARCHAR, licence VARCHAR, pcode VARCHAR, official INTEGER)')
        c.execute('CREATE TABLE official_datasets (country VARCHAR, source VARCHAR, chosen INTEGER, usable INTEGER, '
                  'licence VARCHAR, dataset_date VARCHAR, quality VARCHAR, url VARCHAR, levels JSON, note VARCHAR)')
        for cc, chosen in chosen_by_country.items():
            c.execute("INSERT INTO boundaries VALUES (?, ?, 'country', 'land', ?, 'X', 0, NULL, NULL, NULL, 'overture', NULL, NULL, 0)",
                      (f'ov-{cc}', f'ov-{cc}', cc))
            c.execute("INSERT INTO boundaries VALUES (?, ?, 'region', 'land', ?, 'R', 1, NULL, NULL, ?, 'overture', NULL, NULL, 0)",
                      (f'ov-{cc}-r', f'ov-{cc}-r', cc, f'ov-{cc}'))
            c.execute('INSERT INTO official_datasets VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?)',
                      (cc, 'cod', int(chosen), 'CC BY-IGO', '2026', '', '', '[]', '' if chosen else 'GADM'))
        c.commit()
        c.close()
        env = dict(os.environ, OVERTURE_DB_PATH=db, COUNTRIES=','.join(chosen_by_country))
        here = os.path.dirname(os.path.abspath(__file__))
        return subprocess.run([sys.executable, os.path.join(here, 'verify_db.py')], env=env, capture_output=True, text=True)

    def test_a_country_without_an_official_set_is_a_warning(self):
        r = self.run_verify({'KE': True, 'XX': False})
        self.assertEqual(r.returncode, 0, r.stdout)
        self.assertIn('WARNING: XX: no official set, Overture only', r.stdout)

    def test_unnamed_or_non_polygon_official_rows_are_warnings(self):
        import sqlite3
        import subprocess
        import sys
        # run_verify's DB has no official rows, so this one builds its own.
        d = tempfile.mkdtemp()
        path = os.path.join(d, 'b.sqlite')
        c = sqlite3.connect(path)
        c.execute('CREATE TABLE boundaries (id VARCHAR PRIMARY KEY, division_id VARCHAR, subtype VARCHAR, class VARCHAR, '
                  'country VARCHAR, name VARCHAR, admin_level INTEGER, bbox JSON, geometry JSON, parent_id VARCHAR, '
                  'source VARCHAR, licence VARCHAR, pcode VARCHAR, official INTEGER)')
        c.execute('CREATE TABLE official_datasets (country VARCHAR, source VARCHAR, chosen INTEGER, usable INTEGER, '
                  'licence VARCHAR, dataset_date VARCHAR, quality VARCHAR, url VARCHAR, levels JSON, note VARCHAR)')
        poly = '{"type":"Polygon","coordinates":[[[0,0],[1,0],[1,1],[0,0]]]}'
        rows = [('ov-BR', 'country', 'Brasil', 0, poly, None, 'overture', 0),
                ('ov-BR-r', 'region', 'Acre', 1, poly, 'ov-BR', 'overture', 0),
                ('cod:BRA:BR', 'country', 'Brasil', 0, poly, None, 'cod', 1),
                ('cod:BRA:BR12', 'ADM1', None, 1, poly, 'cod:BRA:BR', 'cod', 1),
                ('cod:BRA:BR13', 'ADM1', 'Amazonas', 1, '{"type":"GeometryCollection","geometries":[]}', 'cod:BRA:BR', 'cod', 1)]
        for i, sub, name, lvl, geom, parent, src, off in rows:
            c.execute("INSERT INTO boundaries VALUES (?, ?, ?, 'land', 'BR', ?, ?, NULL, ?, ?, ?, NULL, NULL, ?)",
                      (i, i, sub, name, lvl, geom, parent, src, off))
        c.execute("INSERT INTO official_datasets VALUES ('BR', 'cod', 1, 1, 'CC BY-IGO', '2020', '', '', '[]', '')")
        c.commit()
        c.close()
        env = dict(os.environ, OVERTURE_DB_PATH=path, COUNTRIES='BR')
        here = os.path.dirname(os.path.abspath(__file__))
        r = subprocess.run([sys.executable, os.path.join(here, 'verify_db.py')], env=env, capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stdout)
        self.assertIn('WARNING: BR: 1 cod row(s) have no name', r.stdout)
        self.assertIn('WARNING: BR: 1 cod row(s) are not polygons', r.stdout)

    def test_no_official_set_anywhere_fails(self):
        r = self.run_verify({'KE': False, 'XX': False})
        self.assertEqual(r.returncode, 1, r.stdout)
        self.assertIn('no requested country got an official set', r.stdout)


if __name__ == '__main__':
    unittest.main()
