"""Step 5 of bootstrap.sh: refuse to call the DB ready unless it is.

Overture rows: exits 1 when a requested country has no rows or no
country-level root, when too few rows got a parent (MIN_PARENT_LINKED, default
0.9), or when a division still has more than one area.

Official sets (skipped when OFFICIAL_SOURCES=none): a country with no usable
official set is a WARNING and stays Overture-only; exits 1 when no requested
country got one (an outage, not one weak dataset) or when an official row below
the country points at a parent that isn't there. Prints a summary either way.
"""
import json
import os
import sqlite3
import sys

db_path = os.environ.get('OVERTURE_DB_PATH', '../overture-data/boundaries.sqlite')
countries = [c.strip().upper() for c in os.environ.get('COUNTRIES', 'IN,KE,MZ').split(',') if c.strip()]
min_linked = float(os.environ.get('MIN_PARENT_LINKED', '0.9'))
official_wanted = os.environ.get('OFFICIAL_SOURCES', 'cod,geoboundaries').strip().lower() not in ('', 'none', 'off', '0')

conn = sqlite3.connect(f'file:{db_path}?mode=ro', uri=True)
tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
columns = {r[1] for r in conn.execute('PRAGMA table_info(boundaries)')}
meta = dict(conn.execute('SELECT key, value FROM meta').fetchall()) if 'meta' in tables else {}
print(f"Overture release {meta.get('release', 'unknown')}, built {meta.get('built_at', 'unknown')}")
overture = "(source = 'overture' OR source IS NULL)" if 'source' in columns else '1'

problems = []
warnings = []
with_official = 0
for c in countries:
    total, roots, linked = conn.execute(
        "SELECT COUNT(*), COALESCE(SUM(subtype = 'country'), 0), COALESCE(SUM(parent_id IS NOT NULL), 0) "
        f'FROM boundaries WHERE country = ? AND {overture}',
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
    f'SELECT COUNT(*) FROM (SELECT division_id FROM boundaries WHERE {overture} GROUP BY division_id HAVING COUNT(*) > 1)'
).fetchone()[0]
if dups:
    problems.append(f'{dups} division(s) still have more than one area')

if official_wanted:
    if 'official_datasets' not in tables:
        problems.append('official sets requested but official.py never ran')
    else:
        print('Official boundary sets:')
        for c in countries:
            rows = conn.execute(
                'SELECT source, chosen, usable, licence, dataset_date, levels, note FROM official_datasets WHERE country = ?',
                (c,),
            ).fetchall()
            chosen = [r for r in rows if r[1]]
            if not chosen:
                # One weak country must not throw away every other country's data:
                # it stays Overture-only, and the run says so.
                notes = '; '.join(f'{r[0]}: {r[6] or "no level below the country nests"}' for r in rows) or 'nothing loaded'
                warnings.append(f'{c}: no official set, Overture only ({notes})')
                continue
            with_official += 1
            src, _, _, licence, date, levels, _ = chosen[0]
            kept = [lv for lv in json.loads(levels or '[]') if lv.get('kept')]
            print(f"  {c}: {src} ({date or 'undated'}; {licence}) — "
                  + ' → '.join(f"{lv['level']} {lv.get('areas_kept', lv['areas']):,}" for lv in kept))
            broken = conn.execute(
                'SELECT COUNT(*) FROM boundaries b WHERE b.country = ? AND b.source = ? AND b.admin_level > 0 '
                'AND NOT EXISTS (SELECT 1 FROM boundaries p WHERE p.id = b.parent_id)',
                (c, src),
            ).fetchone()[0]
            if broken:
                problems.append(f'{c}: {broken} {src} row(s) point at a missing parent')
        if not with_official:
            # Nothing at all: an outage (HDX / geoBoundaries unreachable), not one weak dataset.
            problems.append('no requested country got an official set')
conn.close()
print(f'DB size {os.path.getsize(db_path) / 1e6:.0f} MB')
for w in warnings:
    print(f'WARNING: {w}')

if problems:
    print('NOT READY:')
    for p in problems:
        print(f'  - {p}')
    sys.exit(1)
print('DB verified.')
