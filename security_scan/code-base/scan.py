#!/usr/bin/env python3
"""
Source-code dependency vulnerability scanner for CCRS.

Reads security_scan/code-base/code-scan-config.yaml, scans each listed project with OSV-Scanner
(Maven / npm / Go, no build), aggregates per-project + global severity counts, resolves
a file:line reference for every finding, and publishes one run to Google Drive + the
gh-pages dashboard via the same Apps Script the deployment scanner uses (kind="source-code").

Designed to run in GitHub Actions (see .github/workflows/code-scan.yml) but is also
runnable locally:  python security_scan/code-base/scan.py --local   (writes run.json, no upload)

Env:
  SECSCAN_TOKEN   upload token (never committed); without it the scan runs but does not upload
  GITHUB_REPOSITORY / GITHUB_REF_NAME / GITHUB_SHA   provided by Actions (fallbacks below)
"""
import os, sys, json, subprocess, datetime, base64, collections, re, argparse, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(os.path.dirname(HERE))

# ---- fixed endpoint (public + token-gated; same Apps Script as the deployment scanner) ----
WEBAPP_URL = "https://script.google.com/macros/s/AKfycbzrhUmXklLwf-JrzD-yGuOpK774Vu3SdoMXZz_ccPsZvm8KjYYmPZupVjnndD9EtYWF7g/exec"
TOKEN = os.environ.get("SECSCAN_TOKEN", "")
DRIVE_ROOT = "CMS-Security-Scan"

SEV_ORDER = ["CRITICAL", "HIGH", "MEDIUM", "LOW"]
SEVMAP = {"CRITICAL": "CRITICAL", "HIGH": "HIGH", "MODERATE": "MEDIUM",
          "MEDIUM": "MEDIUM", "LOW": "LOW"}

# ----------------------------------------------------------------- config
def load_config():
    path = os.path.join(HERE, "code-scan-config.yaml")
    try:
        import yaml
    except ImportError:
        sys.exit("PyYAML is required: pip install pyyaml")
    with open(path) as f:
        return yaml.safe_load(f)

# ----------------------------------------------------------------- scan
def osv_scan(path):
    """Run OSV-Scanner on one project dir; return parsed JSON (or empty on no-findings)."""
    target = os.path.join(REPO_ROOT, path)
    if not os.path.isdir(target):
        print(f"    ! path not found, skipping: {path}")
        return None
    cmd = ["osv-scanner", "scan", "source", "--recursive", "--format", "json", target]
    p = subprocess.run(cmd, capture_output=True, text=True)
    # osv-scanner exits 1 when vulns are found; JSON is still on stdout
    if not p.stdout.strip():
        return {"results": []}
    try:
        return json.loads(p.stdout)
    except json.JSONDecodeError:
        print(f"    ! could not parse OSV output for {path}: {p.stderr.strip()[:160]}")
        return {"results": []}

def sev_of(v):
    ds = (v.get("database_specific") or {}).get("severity")
    return SEVMAP.get((ds or "UNKNOWN").upper(), "UNKNOWN")

def summary_of(v):
    s = v.get("summary") or (v.get("details") or "")[:120]
    return s.strip().replace("\n", " ")[:160]

# resolve the line where a package is declared/pinned in its manifest (best-effort)
_line_cache = {}
def line_in_manifest(pkg_name, rel_path):
    key = (pkg_name, rel_path)
    if key in _line_cache:
        return _line_cache[key]
    token = pkg_name.split(":")[-1]          # maven groupId:artifactId -> artifactId
    full = os.path.join(REPO_ROOT, rel_path)
    line = None
    if os.path.isfile(full):
        try:
            out = subprocess.run(["grep", "-n", "-m", "1", token, full],
                                 capture_output=True, text=True, timeout=8)
            if out.stdout:
                line = int(out.stdout.split(":", 1)[0])
        except Exception:
            pass
    _line_cache[key] = line
    return line

# ----------------------------------------------------------------- aggregate
def build_run(config, meta):
    projects_out, findings_by_id = [], {}
    for proj in config.get("projects", []):
        name, path, eco = proj["name"], proj["path"], proj.get("ecosystem", "auto")
        print(f"  scanning {name}  ({path})")
        data = osv_scan(path)
        if data is None:
            continue
        p_sev = collections.Counter(); p_cves = set()
        for res in data.get("results", []):
            src = res.get("source", {}).get("path", "")
            rel = src.split("cms-mozambique/", 1)[-1] if "cms-mozambique/" in src else \
                  os.path.relpath(src, REPO_ROOT) if src else path
            for pkg in res.get("packages", []):
                pk = pkg.get("package", {})
                pname, pver, pecosystem = pk.get("name"), pk.get("version"), pk.get("ecosystem")
                for v in pkg.get("vulnerabilities", []):
                    vid = v.get("id"); sv = sev_of(v)
                    if vid not in p_cves:
                        p_cves.add(vid); p_sev[sv] += 1
                    f = findings_by_id.setdefault(vid, {
                        "id": vid, "severity": sv, "summary": summary_of(v),
                        "ecosystem": pecosystem, "packages": set(), "locations": {}})
                    if f["severity"] == "UNKNOWN" and sv != "UNKNOWN":
                        f["severity"] = sv
                    f["packages"].add(f"{pname}@{pver}")
                    ln = line_in_manifest(pname, rel)
                    f["locations"][rel] = ln          # dedup by path
        projects_out.append({
            "name": name, "path": path, "ecosystem": eco,
            "cve": len(p_cves),
            "bySeverity": {s: p_sev.get(s, 0) for s in SEV_ORDER}})

    # finalise findings
    findings = []
    for f in findings_by_id.values():
        locs = [{"path": p, "line": ln,
                 "url": f"https://github.com/{meta['repo']}/blob/{meta['sha']}/{p}"
                        + (f"#L{ln}" if ln else "")}
                for p, ln in sorted(f["locations"].items())]
        findings.append({
            "id": f["id"], "severity": f["severity"], "summary": f["summary"],
            "ecosystem": f["ecosystem"], "package": sorted(f["packages"])[0],
            "packageCount": len(f["packages"]), "count": len(locs), "locations": locs})
    order = {s: i for i, s in enumerate(SEV_ORDER + ["UNKNOWN"])}
    findings.sort(key=lambda f: (order.get(f["severity"], 9), -f["count"]))

    by_sev = collections.Counter(f["severity"] for f in findings)
    by_eco = collections.defaultdict(lambda: collections.Counter())
    for f in findings:
        by_eco[f["ecosystem"] or "unknown"][f["severity"]] += 1
    now = datetime.datetime.now(datetime.timezone.utc)
    return {
        "meta": {**meta, "kind": "source-code",
                 "scope": "Source Code — Dependency Vulnerabilities",
                 "scanners": ["OSV-Scanner"], "engine": "OSV-Scanner",
                 "runUrl": f"https://github.com/{meta['repo']}/tree/{meta['sha']}",
                 "date": now.strftime("%Y-%m-%d %H:%M UTC"), "ts": now.isoformat()},
        "summary": {
            "cve": len([f for f in findings if f["severity"] != "UNKNOWN"]),
            "cveAll": len(findings), "projects": len(projects_out),
            "bySeverity": {s: by_sev.get(s, 0) for s in SEV_ORDER},
            "byEcosystem": {e: dict(c) for e, c in by_eco.items()}},
        "projects": sorted(projects_out, key=lambda p: -p["bySeverity"]["CRITICAL"]),
        "findings": findings,
    }

# ----------------------------------------------------------------- upload
def _ssl_ctx():
    import ssl
    try:
        import certifi
        return ssl.create_default_context(cafile=certifi.where())
    except Exception:
        try: return ssl.create_default_context()
        except Exception: return None

def _ordinal(n):
    return f"{n}{'th' if 11 <= n % 100 <= 13 else {1:'st',2:'nd',3:'rd'}.get(n % 10,'th')}"

def run_label(user):
    now = datetime.datetime.now().astimezone(); tz = now.strftime("%Z")
    return f"{user} - {_ordinal(now.day)} {now.strftime('%b %Y, %H:%M')}" + (f" {tz}" if tz else "")

def upload(run, runfile):
    if not TOKEN:
        print("  SECSCAN_TOKEN not set - skipping upload (report saved locally).")
        return None
    import urllib.request
    user = os.environ.get("SCAN_USER") or os.environ.get("GITHUB_ACTOR") or "code-scan"
    base = run_label(user)
    owner_repo = [x for x in run["meta"]["repo"].split("/") if x]
    with open(runfile, "rb") as f:
        run_json_b64 = base64.b64encode(f.read()).decode()
    payload = {
        "token": TOKEN, "repo": run["meta"]["repo"], "branch": run["meta"]["branch"],
        "base": base, "kind": "source-code",
        "folders": [DRIVE_ROOT] + owner_repo + ["source-code"],
        "runJsonBase64": run_json_b64,
        "xlsxBase64": "",
    }
    print(f"  uploading '{base}' (kind=source-code) to Drive + gh-pages...")
    req = urllib.request.Request(WEBAPP_URL, data=json.dumps(payload).encode(),
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=300, context=_ssl_ctx()) as r:
            resp = json.loads(r.read().decode())
    except Exception as e:
        print(f"  upload failed: {e}"); return None
    if not resp.get("ok"):
        print(f"  upload rejected: {resp.get('error')}"); return None
    print("  ✓ uploaded to Drive" + (" + published to gh-pages" if resp.get("pagesOk")
          else f" (gh-pages: {resp.get('pagesError','not published')})"))
    return resp

# ----------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--local", action="store_true", help="write run.json only, do not upload")
    ap.add_argument("--out", default=None, help="path to write run.json")
    args = ap.parse_args()

    if not subprocess.run(["which", "osv-scanner"], capture_output=True).returncode == 0:
        sys.exit("osv-scanner not found on PATH (install: https://github.com/google/osv-scanner)")

    config = load_config()
    meta = {
        "repo": os.environ.get("GITHUB_REPOSITORY", "egovernments/Citizen-Complaint-Resolution-System"),
        "branch": os.environ.get("GITHUB_REF_NAME", "master"),
        "sha": os.environ.get("GITHUB_SHA", "HEAD"),
        "shaShort": os.environ.get("GITHUB_SHA", "HEAD")[:7],
        "runId": datetime.datetime.now().strftime("%Y%m%d-%H%M%S"),
        "pr": None,
    }
    print(f"Source-code scan  ·  {meta['repo']}@{meta['shaShort']}  ·  {len(config.get('projects', []))} projects")
    run = build_run(config, meta)
    s = run["summary"]; bs = s["bySeverity"]
    print(f"\nDone: {s['cve']} CVEs across {s['projects']} projects  "
          f"[C {bs['CRITICAL']} · H {bs['HIGH']} · M {bs['MEDIUM']} · L {bs['LOW']}]")

    outfile = args.out or os.path.join(tempfile.mkdtemp(prefix="codescan-"), f"{meta['runId']}.json")
    with open(outfile, "w") as f:
        json.dump(run, f, indent=1)
    print(f"run.json -> {outfile}")

    if not args.local:
        upload(run, outfile)

if __name__ == "__main__":
    main()
