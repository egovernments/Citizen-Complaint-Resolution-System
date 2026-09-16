"""Step 3 of bootstrap.sh: tidy the scraped divisions, compute parent_id, and
index the table for /boundary/fetch.

  1. Drop maritime duplicates. Overture ships some divisions twice under one
     division_id — a land area and a maritime (territorial-sea) area: every
     country and a few coastal regions. Two rows for one place split its
     subtree in half and list it twice; the land area is the civic boundary.
  2. parent_id = the containing polygon at the nearest shallower admin level,
     same country, found by a spatial join on centroids (smallest polygon wins
     a tie, matching the configurator). Computed on full-resolution geometry.
  3. Simplify the stored geometry (SIMPLIFY_TOLERANCE degrees; default 0.0001,
     about 11 m; 0 disables) and round coordinates to 6 decimals (~0.1 m).
     Unsimplified, one country-level fetch was 267 MB.
  4. Index parent_id / division_id / country, then VACUUM.
"""
import json
import os
import sqlite3

import geopandas as gpd
import numpy as np
import pandas as pd
import shapely
from shapely.geometry import shape

db_path = os.environ.get('OVERTURE_DB_PATH', '../overture-data/boundaries.sqlite')
tolerance = float(os.environ.get('SIMPLIFY_TOLERANCE', '0.0001'))

conn = sqlite3.connect(db_path)
cur = conn.cursor()

dropped = cur.execute(
    "DELETE FROM boundaries WHERE class = 'maritime' "
    "AND division_id IN (SELECT division_id FROM boundaries WHERE class = 'land')"
).rowcount
conn.commit()
print(f'Dropped {dropped} maritime duplicate(s) of land divisions.')

print('Loading geometries...')
df = pd.read_sql('SELECT id, country, admin_level, geometry FROM boundaries', conn)
df['geometry'] = df['geometry'].apply(lambda g: shape(json.loads(g)))
gdf = gpd.GeoDataFrame(df, geometry='geometry')

print('Spatial join (finding parents)...')
centroids = gdf.copy()
centroids['geometry'] = centroids.geometry.centroid
joined = gpd.sjoin(centroids, gdf[['id', 'country', 'admin_level', 'geometry']], how='left', predicate='within')
valid = joined[
    (joined['country_left'] == joined['country_right'])
    & (joined['admin_level_right'] < joined['admin_level_left'])
].copy()
valid['parent_area'] = gdf.geometry.area.reindex(valid['index_right']).values
parents = valid.sort_values(['admin_level_right', 'parent_area'], ascending=[False, True])
parent_map = parents.drop_duplicates(subset='id_left').set_index('id_left')['id_right'].to_dict()

columns = {row[1] for row in cur.execute('PRAGMA table_info(boundaries)')}
if 'parent_id' not in columns:
    cur.execute('ALTER TABLE boundaries ADD COLUMN parent_id VARCHAR')
cur.execute('UPDATE boundaries SET parent_id = NULL')
cur.executemany('UPDATE boundaries SET parent_id = ? WHERE id = ?', [(p, c) for c, p in parent_map.items()])
print(f'Linked {len(parent_map)} of {len(gdf)} boundaries to a parent.')

geoms = gdf.geometry.simplify(tolerance, preserve_topology=True) if tolerance > 0 else gdf.geometry
geoms = shapely.transform(np.asarray(geoms.values), lambda coords: np.round(coords, 6))
cur.executemany(
    'UPDATE boundaries SET geometry = ? WHERE id = ?',
    list(zip(shapely.to_geojson(geoms).tolist(), gdf['id'].tolist())),
)
print(f'Stored geometry simplified at tolerance {tolerance} and rounded to 6 decimals.')

for sql in (
    'CREATE INDEX IF NOT EXISTS idx_boundaries_parent ON boundaries(parent_id)',
    'CREATE INDEX IF NOT EXISTS idx_boundaries_division ON boundaries(division_id)',
    'CREATE INDEX IF NOT EXISTS idx_boundaries_country ON boundaries(country)',
):
    cur.execute(sql)
if cur.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'meta'").fetchone():
    cur.execute("INSERT OR REPLACE INTO meta VALUES ('simplify_tolerance', ?)", (str(tolerance),))
conn.commit()
cur.execute('VACUUM')
conn.close()
print('Hierarchy built.')
