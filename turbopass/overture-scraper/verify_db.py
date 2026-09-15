"""Step 4 of bootstrap.sh: refuse to call the DB ready unless it is.

Exits 1 when a requested country has no rows or no country-level root, when
too few rows got a parent (MIN_PARENT_LINKED, default 0.9), or when a division
still has more than one area. Prints a summary either way.
"""
import os
import sqlite3
import sys

db_path = os.environ.get('OVERTURE_DB_PATH', '../overture-data/boundaries.sqlite')
countries = [c.strip().upper() for c in os.environ.get('COUNTRIES', 'IN,KE,MZ').split(',') if c.strip()]
min_linked = float(os.environ.get('MIN_PARENT_LINKED', '0.9'))

conn = sqlite3.connect(f'file:{db_path}?mode=ro', uri=True)
has_meta = conn.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'meta'").fetchone()
meta = dict(conn.execute('SELECT key, value FROM meta').fetchall()) if has_meta else {}
print(f"Overture release {meta.get('release', 'unknown')}, built {meta.get('built_at', 'unknown')}")

problems = []
for c in countries:
    total, roots, linked = conn.execute(
        "SELECT COUNT(*), COALESCE(SUM(subtype = 'country'), 0), COALESCE(SUM(parent_id IS NOT NULL), 0) "
        'FROM boundaries WHERE country = ?',
        (c,),
    ).fetchone()
    non_root = total - roots
    share = linked / non_root if non_root else 1.0
    print(f'  {c}: {total} areas, {roots} country root(s), {share:.1%} of the rest have a parent')
    if not total:
        problems.append(f'{c}: no rows')
    elif not roots:
        problems.append(f'{c}: no country-level row')
    elif share < min_linked:
        problems.append(f'{c}: only {share:.0%} of rows have a parent (need {min_linked:.0%})')

dups = conn.execute(
    'SELECT COUNT(*) FROM (SELECT division_id FROM boundaries GROUP BY division_id HAVING COUNT(*) > 1)'
).fetchone()[0]
if dups:
    problems.append(f'{dups} division(s) still have more than one area')
conn.close()
print(f'DB size {os.path.getsize(db_path) / 1e6:.0f} MB')

if problems:
    print('NOT READY:')
    for p in problems:
        print(f'  - {p}')
    sys.exit(1)
print('DB verified.')
