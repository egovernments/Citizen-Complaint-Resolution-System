#!/usr/bin/env python3
"""
Merge Checkov + KICS into a structured run.json consumed by the public
security dashboard (.github/security-dashboard/index.html), plus a GitHub
step-summary card.

Findings are grouped by rule (distinct issue types with occurrence counts).
Each occurrence carries a root-relative path and a deep link to that exact line
on the scanned commit. Each rule carries a curated "why / how to fix".

Inputs (env): CHECKOV_JSON, KICS_JSON, OUT_JSON, REPO, REF, SHA, RUN_ID,
RUN_URL, PR_NUMBER, PR_TITLE, SCAN_SCOPE
"""
import json, os, datetime, collections

SEV_ORDER = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"]
CHECKOV_SEV = {"secrets": "HIGH", "dockerfile": "MEDIUM", "ansible": "MEDIUM"}

# Curated "why it matters / how to fix" keyed by a lowercase substring of the
# rule title (KICS) or the Checkov id prefix. First match wins; fallback uses
# the scanner's own description.
REMEDIATION = [
    ("docker socket mounted", (
        "Mounting /var/run/docker.sock gives the container full control of the Docker daemon on the host - equivalent to root on the machine, so a compromised container can escape and take over the server.",
        "Remove the docker.sock bind mount. If a container genuinely needs Docker access, use a scoped socket proxy (e.g. tecnativa/docker-socket-proxy) exposing only the required API endpoints, read-only.")),
    ("sensitive host directory", (
        "Bind-mounting a sensitive host path (like /, /etc, /var/run) lets the container read or modify host files, breaking isolation.",
        "Mount only the specific sub-directory the service needs, read-only (`:ro`) where possible. Avoid mounting host system directories.")),
    ("privileged", (
        "A privileged container disables most isolation (all capabilities, device access) - a container escape becomes trivial.",
        "Remove `privileged: true`. Grant only the specific Linux capabilities the workload needs via `cap_add`, and drop the rest with `cap_drop: [ALL]`.")),
    ("host network", (
        "Sharing the host network namespace removes network isolation and exposes all host interfaces/ports to the container.",
        "Remove `network_mode: host`. Use a user-defined bridge network and publish only the ports you need.")),
    ("not bound to host interface", (
        "Publishing a port on 0.0.0.0 exposes the service on every network interface of the host, including public ones.",
        "Bind the published port to the loopback or a specific private interface, e.g. `127.0.0.1:PORT:PORT`, and expose it externally only through the reverse proxy.")),
    ("no new privileges", (
        "Without no-new-privileges, a process inside the container can gain additional privileges via setuid binaries.",
        "Add `security_opt: [\"no-new-privileges:true\"]` to the service.")),
    ("read-only", (
        "A writable root filesystem lets an attacker drop tools or tamper with binaries inside the container.",
        "Set `read_only: true` and mount explicit writable volumes only where the app must write.")),
    ("healthcheck", (
        "Without a healthcheck the orchestrator cannot tell if the container is actually serving, so failed containers keep receiving traffic.",
        "Add a `healthcheck:` block (or a HEALTHCHECK in the Dockerfile) that probes a real readiness endpoint.")),
    ("memory", (
        "Without a memory limit a single container can exhaust host RAM and take down every other service (DoS).",
        "Set a `mem_limit` (compose) / resources limit for the service.")),
    ("cpu", (
        "Without a CPU limit one container can starve the rest of the host.",
        "Set `cpus` / CPU limits for the service.")),
    ("ckv_secret", (
        "A credential (password, token, key) appears to be committed to the repository. Anyone with read access - and this repo is public - can use it.",
        "Remove the secret from the file, rotate/revoke it immediately, and inject it at runtime via an environment variable or secret store. Enable GitHub secret scanning + push protection.")),
    ("passwords and secrets", (
        "A value matching a credential pattern was found in infrastructure code. If real, it is exposed to everyone with repo access.",
        "Confirm whether it is a real secret; if so rotate it and move it to a runtime secret/env var. If it is a non-secret default, ignore or suppress the rule.")),
    ("ckv_docker", (
        "The Dockerfile diverges from a hardening best practice (e.g. missing HEALTHCHECK, running as root).",
        "Apply the specific Dockerfile fix (add HEALTHCHECK, add a non-root USER, pin base image digests).")),
    ("ckv_ansible", (
        "The Ansible task weakens security (e.g. TLS validation disabled, permissive file mode).",
        "Re-enable `validate_certs: true`, tighten file `mode`, and avoid `become` where not required.")),
]


def load(p):
    if p and os.path.exists(p):
        try:
            return json.load(open(p))
        except Exception:
            return None
    return None


def norm_sev(s):
    s = (s or "").upper()
    return "INFO" if s == "TRACE" else (s if s in SEV_ORDER else "MEDIUM")


def remediate(rule_id, title, desc):
    """Returns (why, fix, curated). curated=True means it came from the vetted map
    and must NOT be overwritten by LLM enrichment."""
    key = (title or "").lower() + " " + (rule_id or "").lower()
    for needle, (why, fix) in REMEDIATION:
        if needle in key:
            return why, fix, True
    return (desc or "This configuration diverges from a security best practice."), \
           "See the linked guide for remediation steps.", False


def category(title):
    """Normalized category used only for cross-scanner de-duplication. Returns
    None for rules we never collapse across scanners."""
    t = (title or "").lower()
    if any(w in t for w in ("password", "secret", "token", "encryption key",
                            "private key", "access key", "basic auth",
                            "high entropy", "credential")):
        return "secret"
    return None


def from_checkov(data):
    out = []
    for r in (data if isinstance(data, list) else [data]) if data else []:
        ct = r.get("check_type", "checkov")
        for c in ((r.get("results") or {}).get("failed_checks") or []):
            out.append({"source": "Checkov", "area": ct, "severity": CHECKOV_SEV.get(ct, "MEDIUM"),
                        "id": c.get("check_id", ""), "title": c.get("check_name", ""),
                        "file": (c.get("file_path") or "").lstrip("/"),
                        "line": (c.get("file_line_range") or [None])[0],
                        "desc": "", "guide": c.get("guideline") or ""})
    return out


def from_kics(data):
    out = []
    for q in ((data or {}).get("queries") or []):
        for f in (q.get("files") or []):
            out.append({"source": "KICS", "area": "docker-compose", "severity": norm_sev(q.get("severity")),
                        "id": q.get("query_id", "") or q.get("query_name", ""), "title": q.get("query_name", ""),
                        "file": (f.get("file_name") or "").lstrip("/"), "line": f.get("line"),
                        "desc": q.get("description", ""), "guide": q.get("query_url") or ""})
    return out


def blob(repo, sha, path, line):
    u = f"https://github.com/{repo}/blob/{sha}/{path}"
    return u + (f"#L{line}" if line else "")


def main():
    meta_repo = os.environ.get("REPO", "org/repo")
    sha = os.environ.get("SHA", "")
    findings = from_checkov(load(os.environ.get("CHECKOV_JSON"))) + from_kics(load(os.environ.get("KICS_JSON")))

    # Deterministic cross-scanner de-dupe: if two DIFFERENT scanners flag the same
    # (file, line) for the same category (e.g. a secret), keep one - highest severity,
    # Checkov preferred for secrets (its dedicated scanner). Within one scanner, keep all.
    buckets = {}
    for f in findings:
        cat = category(f["title"])
        if cat is None:
            continue
        buckets.setdefault((f["file"], f["line"], cat), []).append(f)
    drop = set()
    for items in buckets.values():
        if len({i["source"] for i in items}) > 1:
            keep_first = sorted(items, key=lambda i: (SEV_ORDER.index(i["severity"]),
                                                      0 if i["source"] == "Checkov" else 1))
            for i in keep_first[1:]:
                drop.add(id(i))
    findings = [f for f in findings if id(f) not in drop]

    groups = {}
    for f in findings:
        k = (f["severity"], f["source"], f["id"], f["title"])
        g = groups.setdefault(k, {"severity": f["severity"], "source": f["source"], "area": f["area"],
                                  "id": f["id"], "title": f["title"], "guide": f["guide"],
                                  "locations": [], "_desc": f.get("desc", "")})
        if f["file"]:
            g["locations"].append({"path": f["file"], "line": f["line"],
                                   "url": blob(meta_repo, sha, f["file"], f["line"])})
    grouped = []
    for g in groups.values():
        why, fix, curated = remediate(g["id"], g["title"], g.pop("_desc", ""))
        g["why"], g["fix"], g["curated"], g["count"] = why, fix, curated, len(g["locations"])
        grouped.append(g)
    order = {s: i for i, s in enumerate(SEV_ORDER)}
    grouped.sort(key=lambda g: (order.get(g["severity"], 9), -g["count"]))

    types_by = collections.Counter(g["severity"] for g in grouped)
    occ_by = collections.Counter(f["severity"] for f in findings)
    pr = None
    if os.environ.get("PR_NUMBER"):
        n = os.environ["PR_NUMBER"]
        pr = {"number": int(n), "title": os.environ.get("PR_TITLE", ""),
              "url": f"https://github.com/{meta_repo}/pull/{n}"}

    run = {
        "meta": {
            "repo": meta_repo, "branch": os.environ.get("REF", ""), "sha": sha, "shaShort": sha[:7],
            "runId": os.environ.get("RUN_ID", ""), "runUrl": os.environ.get("RUN_URL", "#"),
            "pr": pr, "scope": os.environ.get("SCAN_SCOPE", "Ansible Deployment - Remote Server"),
            "scanners": ["Checkov", "KICS"],
            "date": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
            "ts": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        },
        "summary": {"types": len(grouped), "occurrences": len(findings),
                    "typesBySeverity": {s: types_by.get(s, 0) for s in SEV_ORDER},
                    "occBySeverity": {s: occ_by.get(s, 0) for s in SEV_ORDER}},
        "findings": grouped,
    }
    json.dump(run, open(os.environ.get("OUT_JSON", "run.json"), "w"), indent=1)

    # step summary
    prio = [g for g in grouped if g["severity"] in ("CRITICAL", "HIGH")]
    print("## 🛡️ Security Scan — Ansible Remote Server Deployment\n")
    if not findings:
        print("**✅ No findings in scope.**")
    else:
        chips = "  ".join(f"**{s.title()}** {types_by[s]}" for s in SEV_ORDER if types_by.get(s))
        print(f"**{len(grouped)} issue types** across {len(findings)} occurrences  ·  {chips}\n")
        if prio:
            print("### Priority (High & Critical)\n| Severity | Issue | Count |\n|---|---|--:|")
            for g in prio[:15]:
                print(f"| {g['severity'].title()} | `{g['id']}` {g['title'][:56]} | {g['count']} |")
        print("\n📊 **Public dashboard:** see the workflow-run link in the PR, or the Pages URL. "
              "Per-location triage: **Security → Code scanning**.")


if __name__ == "__main__":
    main()
