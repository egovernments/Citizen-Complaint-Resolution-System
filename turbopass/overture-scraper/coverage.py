"""How much of each country Overture Maps' divisions cover — without
downloading any geometry. Counts land division areas per country and subtype,
answering "can we onboard country X from Overture, and how deep does it go?".

Environment:
  OVERTURE_RELEASE  release to read (default: newest in the bucket)
  COVERAGE_OUT      CSV path (default ./coverage-<release>.csv)

Reads only the country/subtype/class columns, so it takes minutes, not the
bootstrap's download of full polygons.
"""
import csv
import os

import duckdb

from scrape import BUCKET, resolve_release

# Overture's division subtypes, broadest first; anything unlisted sorts last.
ORDER = [
    'country', 'dependency', 'macroregion', 'region', 'macrocounty', 'county',
    'localadmin', 'locality', 'borough', 'macrohood', 'neighborhood', 'microhood',
]

release = resolve_release()
out = os.environ.get('COVERAGE_OUT', f'coverage-{release}.csv')
con = duckdb.connect()
con.execute('INSTALL httpfs; LOAD httpfs;')
rows = con.execute(f"""
    SELECT country, subtype, COUNT(*)
    FROM read_parquet('s3://{BUCKET}/release/{release}/theme=divisions/type=division_area/*',
                      hive_partitioning=1)
    WHERE class = 'land' AND country IS NOT NULL
    GROUP BY country, subtype
""").fetchall()

counts = {}
for country, subtype, n in rows:
    counts.setdefault(country, {})[subtype] = n
subtypes = sorted({s for per in counts.values() for s in per}, key=lambda s: (ORDER.index(s) if s in ORDER else 99, s))

with open(out, 'w', newline='') as fh:
    w = csv.writer(fh)
    # Key column is iso2, not 'country' — Overture has a `country` subtype column too.
    w.writerow(['iso2', 'total', 'levels', 'deepest', *subtypes])
    for country in sorted(counts):
        per = counts[country]
        present = [s for s in subtypes if per.get(s)]
        w.writerow([country, sum(per.values()), len(present), present[-1] if present else '', *[per.get(s, 0) for s in subtypes]])

print(f'Overture {release}: {len(counts)} countries -> {out}')
by_levels = {}
for country, per in counts.items():
    by_levels.setdefault(sum(1 for v in per.values() if v), []).append(country)
for n in sorted(by_levels):
    print(f'  {n} subtype level(s): {len(by_levels[n])} countries')
