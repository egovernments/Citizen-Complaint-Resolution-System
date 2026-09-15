"""Step 1 of bootstrap.sh: download Overture Maps division areas for the
requested countries into a local SQLite DB.

Environment:
  COUNTRIES         comma-separated ISO 3166-1 alpha-2 codes (default IN,KE,MZ)
  OVERTURE_RELEASE  release to read, e.g. 2026-08-19.0. Unset → the newest one
                    in the bucket. Overture keeps only its last few releases, so
                    a pinned value eventually disappears — that is a hard error
                    here, never an empty DB.
  OVERTURE_DB_PATH  output file (default ../overture-data/boundaries.sqlite)
"""
import os
import re
import sys
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone

import duckdb

BUCKET = 'overturemaps-us-west-2'
LIST_URL = f'https://{BUCKET}.s3.us-west-2.amazonaws.com/?list-type=2&delimiter=/&prefix=release/'


def available_releases():
    with urllib.request.urlopen(LIST_URL, timeout=60) as resp:
        root = ET.fromstring(resp.read())
    # S3 listings are XML-namespaced; match on the local tag name.
    prefixes = [el.text or '' for el in root.iter() if el.tag.split('}')[-1] == 'Prefix']
    return sorted({p.split('/')[1] for p in prefixes if p.startswith('release/') and p.count('/') == 2})


def resolve_release():
    releases = available_releases()
    if not releases:
        sys.exit(f'ERROR: no releases listed under s3://{BUCKET}/release/')
    wanted = os.environ.get('OVERTURE_RELEASE', '').strip()
    if not wanted:
        return releases[-1]
    if wanted not in releases:
        sys.exit(
            f'ERROR: OVERTURE_RELEASE={wanted} is not in the bucket '
            f'(available: {", ".join(releases)}). Overture keeps only recent '
            'releases — unset OVERTURE_RELEASE to use the newest.'
        )
    return wanted


def requested_countries():
    raw = os.environ.get('COUNTRIES', 'IN,KE,MZ')
    codes = [c.strip().upper() for c in raw.split(',') if c.strip()]
    bad = [c for c in codes if not re.fullmatch(r'[A-Z]{2}', c)]
    if not codes or bad:
        sys.exit(f'ERROR: COUNTRIES must be ISO 3166-1 alpha-2 codes, got {raw!r}')
    return codes


def main():
    db_path = os.environ.get('OVERTURE_DB_PATH', '../overture-data/boundaries.sqlite')
    os.makedirs(os.path.dirname(db_path) or '.', exist_ok=True)
    release = resolve_release()
    countries = requested_countries()
    print(f'Overture release {release}; countries {",".join(countries)}')

    con = duckdb.connect()
    for ext in ('spatial', 'httpfs', 'sqlite'):
        con.execute(f'INSTALL {ext}; LOAD {ext};')

    if os.path.exists(db_path):
        os.remove(db_path)
    con.execute(f"ATTACH '{db_path.replace(chr(39), chr(39) * 2)}' AS local_db (TYPE SQLITE);")
    con.execute("""
        CREATE TABLE local_db.boundaries (
            id VARCHAR PRIMARY KEY, division_id VARCHAR, subtype VARCHAR,
            class VARCHAR, country VARCHAR, name VARCHAR, admin_level INTEGER,
            bbox JSON, geometry JSON
        );
    """)
    con.execute('CREATE TABLE local_db.meta (key VARCHAR PRIMARY KEY, value VARCHAR);')

    print('Querying Overture on S3 — India alone is several GB of row groups, expect minutes...')
    country_list = ', '.join(f"'{c}'" for c in countries)  # validated [A-Z]{2}
    con.execute(f"""
        INSERT INTO local_db.boundaries
        SELECT id, division_id, subtype, class, country, names.primary, admin_level,
               to_json(bbox), ST_AsGeoJSON(geometry)
        FROM read_parquet('s3://{BUCKET}/release/{release}/theme=divisions/type=division_area/*',
                          hive_partitioning=1)
        WHERE country IN ({country_list})
    """)

    counts = dict(con.execute('SELECT country, COUNT(*) FROM local_db.boundaries GROUP BY country').fetchall())
    for c in countries:
        print(f'  {c}: {counts.get(c, 0)} boundaries')
    missing = [c for c in countries if not counts.get(c)]
    if missing:
        sys.exit(f'ERROR: Overture {release} has no division areas for: {", ".join(missing)}')

    built_at = datetime.now(timezone.utc).isoformat(timespec='seconds')
    for key, value in (('release', release), ('countries', ','.join(countries)), ('built_at', built_at)):
        con.execute('INSERT INTO local_db.meta VALUES (?, ?)', [key, value])
    con.close()


if __name__ == '__main__':
    main()
