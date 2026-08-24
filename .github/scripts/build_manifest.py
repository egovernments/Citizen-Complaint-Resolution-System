#!/usr/bin/env python3
"""
Build manifest.json for the security dashboard from a directory of per-run
JSON files. Prints the manifest to stdout.

Usage: build_manifest.py <data_dir>
"""
import json, os, sys

SEV = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"]


def main():
    data_dir = sys.argv[1] if len(sys.argv) > 1 else "data"
    runs = []
    for name in os.listdir(data_dir):
        if not name.endswith(".json"):
            continue
        try:
            d = json.load(open(os.path.join(data_dir, name)))
        except Exception:
            continue
        m, s = d.get("meta", {}), d.get("summary", {})
        runs.append({
            "file": f"data/{name}",
            "runId": m.get("runId", name[:-5]),
            "date": m.get("date", ""),
            "ts": m.get("ts", ""),
            "branch": m.get("branch", ""),
            "shaShort": m.get("shaShort", ""),
            "pr": m.get("pr"),
            "occurrences": s.get("occurrences", 0),
            "types": s.get("types", 0),
            "occBySeverity": {k: s.get("occBySeverity", {}).get(k, 0) for k in SEV},
        })
    runs.sort(key=lambda r: r.get("ts", ""), reverse=True)
    json.dump({"runs": runs}, sys.stdout, indent=1)


if __name__ == "__main__":
    main()
