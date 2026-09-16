"""Assign synthetic admin_levels to Overture subtypes that ship without a
numeric admin_level, so build_hierarchy.py's parent<child spatial-join logic
can place neighborhoods/localities under their containing divisions.

Runs against ../overture-data/boundaries.sqlite using the stdlib sqlite3 module
(no sqlite3 CLI required, so this works identically on a host and in the
minimal python docker image).
"""
import os
import sqlite3

db_path = os.environ.get(
    "OVERTURE_DB_PATH",
    os.path.join(os.path.dirname(__file__), "..", "overture-data", "boundaries.sqlite"),
)

# subtype -> synthetic admin_level (only applied where admin_level IS NULL)
SYNTHETIC_LEVELS = {
    "locality": 3,
    "macrohood": 4,
    "neighborhood": 5,
    "microhood": 6,
}

print(f"Applying synthetic admin levels to {db_path} ...")
conn = sqlite3.connect(db_path)
cur = conn.cursor()
for subtype, level in SYNTHETIC_LEVELS.items():
    cur.execute(
        "UPDATE boundaries SET admin_level = ? WHERE subtype = ? AND admin_level IS NULL",
        (level, subtype),
    )
    print(f"  {subtype:12s} -> admin_level {level}: {cur.rowcount} rows")
conn.commit()
conn.close()
print("Synthetic admin levels applied.")
