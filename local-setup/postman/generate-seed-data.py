#!/usr/bin/env python3
"""Generate the newman data file for the v2.12-beta -> v2.12 seed load.

Emits exactly the eg_mdms_data rows that full-dump.sql gained between the two
tags (matched on schemacode + tenantid + uniqueIdentifier), rewriting any
tenantId embedded INSIDE a record to the target tenant — several masters carry
their own tenantId in the payload, and loading 'pg' records into another tenant
verbatim writes rows that claim to belong to pg.

  python3 generate-seed-data.py --tenant ap [--from v2.12-beta] [--to v2.12]

Output: ga-upgrade-seed-load.data.<tenant>.json
"""
import argparse, collections, json, pathlib, re, subprocess, sys

DUMP = 'local-setup/db/full-dump.sql'

def dump_text(ref):
    return subprocess.run(['git', 'show', f'{ref}:{DUMP}'],
                          capture_output=True, text=True, check=True).stdout

def unescape(s):
    """postgres COPY text format -> raw string"""
    if s == r'\N':
        return None
    rep = {'b': '\b', 'f': '\f', 'n': '\n', 'r': '\r', 't': '\t', 'v': '\v', '\\': '\\'}
    out, i = [], 0
    while i < len(s):
        if s[i] == '\\' and i + 1 < len(s) and s[i + 1] in rep:
            out.append(rep[s[i + 1]]); i += 2; continue
        out.append(s[i]); i += 1
    return ''.join(out)

def mdms_rows(text):
    rows, cols, inblk = [], None, False
    for line in text.split('\n'):
        m = re.match(r'COPY\s+public\.eg_mdms_data\s*\(([^)]*)\)', line)
        if m:
            cols = [c.strip() for c in m.group(1).split(',')]; inblk = True; continue
        if inblk:
            if line == r'\.':
                inblk = False; continue
            f = line.split('\t')
            if len(f) == len(cols):
                rows.append(dict(zip(cols, f)))
    return rows

def retenant(obj, src, dst):
    """rewrite any tenant-ish value equal to src (or prefixed src.) to dst"""
    if isinstance(obj, dict):
        return {k: (dst if (('tenant' in k.lower()) and v == src) else retenant(v, src, dst))
                for k, v in obj.items()}
    if isinstance(obj, list):
        return [retenant(v, src, dst) for v in obj]
    if isinstance(obj, str) and obj == src:
        return dst
    return obj

def label(schema, d):
    if schema.endswith('roleactions'):
        return f"grant {d.get('rolecode')} -> action {d.get('actionid')}"
    if schema.endswith('actions-test'):
        return f"action {d.get('id')} {str(d.get('url'))[:44]}"
    if schema.endswith('roles'):
        return f"role {d.get('code')}"
    return f"{schema.split('.')[-1]} {str(d.get('code') or d.get('name') or '')[:32]}"

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--tenant', required=True, help='target state-root tenant, e.g. ap')
    ap.add_argument('--from', dest='frm', default='v2.12-beta')
    ap.add_argument('--to', dest='to', default='v2.12')
    ap.add_argument('--source-tenant', default='pg', help='tenant the dump seeds (default pg)')
    a = ap.parse_args()

    old, new = mdms_rows(dump_text(a.frm)), mdms_rows(dump_text(a.to))
    key = lambda r: (r['schemacode'], r['tenantid'], r['uniqueidentifier'])
    seen = {key(r) for r in old}
    delta = [r for r in new if key(r) not in seen]

    out, bad = [], 0
    for r in delta:
        raw = unescape(r.get('data', ''))
        if raw is None:
            continue
        try:
            obj = json.loads(raw)
        except Exception:
            bad += 1; continue
        obj = retenant(obj, a.source_tenant, a.tenant)
        out.append({"schemaCode": r['schemacode'], "tenantId": a.tenant,
                    "label": label(r['schemacode'], obj if isinstance(obj, dict) else {}),
                    "recordJson": json.dumps(obj, separators=(',', ':'))})

    # actions must exist before roles/grants reference them
    prio = {'ACCESSCONTROL-ACTIONS-TEST.actions-test': 0,
            'ACCESSCONTROL-ROLES.roles': 1,
            'ACCESSCONTROL-ROLEACTIONS.roleactions': 2}
    out.sort(key=lambda x: (prio.get(x['schemaCode'], 3), x['schemaCode'], x['label']))

    dest = pathlib.Path(f'local-setup/postman/ga-upgrade-seed-load.data.{a.tenant}.json')
    dest.write_text(json.dumps(out, indent=1))
    print(f"{a.frm} -> {a.to}, tenant '{a.tenant}': {len(out)} records"
          + (f" ({bad} unparseable skipped)" if bad else ""))
    for k, v in collections.Counter(x['schemaCode'] for x in out).most_common():
        print(f"  {k:44} {v}")
    print(f"wrote {dest}")

if __name__ == '__main__':
    sys.exit(main())
