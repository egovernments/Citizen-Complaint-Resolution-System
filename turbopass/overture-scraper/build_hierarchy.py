import sqlite3
import pandas as pd
import geopandas as gpd
from shapely.geometry import shape
import json

db_path = '../overture-data/boundaries.sqlite'
print("Loading data from SQLite...")
conn = sqlite3.connect(db_path)
df = pd.read_sql("SELECT id, country, admin_level, geometry FROM boundaries", conn)

print("Parsing geometries...")
# Convert JSON string to shapely geometries
df['geometry'] = df['geometry'].apply(lambda x: shape(json.loads(x)))
gdf = gpd.GeoDataFrame(df, geometry='geometry')

print("Computing centroids...")
centroids = gdf.copy()
centroids['geometry'] = centroids.geometry.centroid

print("Spatial join (finding parents)...")
# We want to find for each centroid (child), which polygon (parent) contains it.
# We also want parent.admin_level < child.admin_level and same country.
# sjoin will return all intersections.
joined = gpd.sjoin(centroids, gdf[['id', 'country', 'admin_level', 'geometry']], how='left', predicate='within')

# Filter to valid parents
valid_parents = joined[
    (joined['country_left'] == joined['country_right']) &
    (joined['admin_level_right'] < joined['admin_level_left'])
]

# For each child, find the immediate parent (max admin_level_right)
# Sort by admin_level_right desc, then group by child id and take first
sorted_parents = valid_parents.sort_values('admin_level_right', ascending=False)
immediate_parents = sorted_parents.drop_duplicates(subset='id_left')

# Map child -> parent
parent_map = immediate_parents.set_index('id_left')['id_right'].to_dict()

print(f"Updating SQLite with {len(parent_map)} relationships...")
cursor = conn.cursor()
try:
    cursor.execute("ALTER TABLE boundaries ADD COLUMN parent_id VARCHAR;")
except:
    pass

updates = [(v, k) for k, v in parent_map.items()]
cursor.executemany("UPDATE boundaries SET parent_id = ? WHERE id = ?", updates)
conn.commit()
conn.close()

print("Hierarchy built successfully!")
