import duckdb
import os
import json

os.makedirs('../overture-data', exist_ok=True)

print("Connecting to DuckDB...")
con = duckdb.connect()
con.execute("INSTALL spatial; LOAD spatial;")
con.execute("INSTALL httpfs; LOAD httpfs;")
con.execute("INSTALL sqlite; LOAD sqlite;")

RELEASE = '2026-06-17.0'
COUNTRIES = ['IN', 'KE', 'MZ']

db_path = '../overture-data/boundaries.sqlite'
if os.path.exists(db_path):
    os.remove(db_path)

con.execute(f"ATTACH '{db_path}' AS local_db (TYPE SQLITE);")

print("Creating local table...")
con.execute("""
    CREATE TABLE local_db.boundaries (
        id VARCHAR PRIMARY KEY,
        division_id VARCHAR,
        subtype VARCHAR,
        class VARCHAR,
        country VARCHAR,
        name VARCHAR,
        admin_level INTEGER,
        bbox JSON,
        geometry JSON
    );
""")

print("Querying Overture S3 Bucket. This may take a few minutes...")

query = f"""
    INSERT INTO local_db.boundaries
    SELECT 
        id,
        division_id,
        subtype,
        class,
        country,
        names.primary as name,
        admin_level,
        to_json(bbox) as bbox,
        ST_AsGeoJSON(geometry) as geometry
    FROM read_parquet('s3://overturemaps-us-west-2/release/{RELEASE}/theme=divisions/type=division_area/*', hive_partitioning=1)
    WHERE country IN ('IN', 'KE', 'MZ')
"""

try:
    con.execute(query)
    count = con.execute("SELECT COUNT(*) FROM local_db.boundaries").fetchone()[0]
    print(f"-> Successfully inserted {count} boundaries.")
    
    # Let's also print a breakdown
    breakdown = con.execute("SELECT country, count(*) FROM local_db.boundaries GROUP BY country").fetchall()
    for row in breakdown:
        print(f"   {row[0]}: {row[1]} boundaries")
        
except Exception as e:
    print(f"Error fetching data: {e}")

print("Scraping completed!")
con.close()
