#!/usr/bin/env python3
"""
DIGIT Security Scanner (per-repo edition) - Claude-driven deep vulnerability scan.

This copy lives inside ONE repo and scans only that repo (REPO_FULL below). Flow:
pick a BRANCH (type to filter), then a MODULE (Ansible; Kubernetes = coming soon), then it
clones the branch, runs a deep security audit via the Claude CLI, scores findings
deterministically, and POSTs the result to an Apps Script that stores it on Drive AND
publishes it to this repo's gh-pages dashboard (PAGES_URL).

Why Claude instead of Checkov/KICS/Gemini/Strix: one coherent, deliberative pass with real
file verification - no rate-limit degradation, no test-tooling CVE noise, deterministic
severity/priority, no false triggers.

Requirements: claude CLI (logged in), git, python3, certifi, openpyxl. The upload token is
supplied at runtime via SECSCAN_TOKEN (never committed). See README.md.
"""
import os, sys, json, subprocess, tempfile, shutil, datetime, re, glob, html

HOME = os.path.expanduser("~")
TOOL_HOME = os.path.dirname(os.path.abspath(__file__))

# ============================ PER-REPO CONFIG =================================
# This copy of the tool lives inside ONE repo and scans only that repo. These are
# hard-coded per repo (the branch is chosen at runtime).
REPO_NAME = "CMS-MOZAMBIQUE"
REPO_FULL = "eGov-Global/CMS-MOZAMBIQUE"
REPO_URL  = "https://github.com/eGov-Global/CMS-MOZAMBIQUE"
PAGES_URL = "https://egov-global.github.io/CMS-MOZAMBIQUE/security_scan/"
DEFAULT_BRANCH = "master"

MODULES = [
    {"name": "Ansible", "detail": "Remote-server deployment (Option C)", "enabled": True},
    {"name": "Kubernetes", "detail": "Helm / k8s path", "enabled": False},  # coming soon
]

# Pinned model for reproducibility (override with SCAN_MODEL=... for a faster run).
SCAN_MODEL = os.environ.get("SCAN_MODEL") or "claude-opus-5"

# Upload endpoint (Apps Script). The URL is public and safe to commit - it does nothing
# without the token. The token is NEVER committed: it is supplied at runtime via the
# SECSCAN_TOKEN env var (see README.md). The Apps Script fans the upload out to Drive AND
# to this repo's gh-pages dashboard.
WEBAPP_URL = "https://script.google.com/macros/s/AKfycbzrhUmXklLwf-JrzD-yGuOpK774Vu3SdoMXZz_ccPsZvm8KjYYmPZupVjnndD9EtYWF7g/exec"
TOKEN = os.environ.get("SECSCAN_TOKEN", "")

import getpass
def _claude_user():
    """The display name of the Claude account this CLI is logged into (~/.claude.json)."""
    for p in (os.path.join(HOME, ".claude.json"), os.path.join(HOME, ".claude", "settings.json")):
        try:
            acc = (json.load(open(p)).get("oauthAccount") or {})
            name = acc.get("displayName") or acc.get("fullName")
            if name: return name
            if acc.get("emailAddress"): return acc["emailAddress"].split("@")[0]
        except Exception:
            pass
    return None

# Who ran the scan (for the run label). Priority: SCAN_USER -> Claude account -> OS login.
USERNAME = os.environ.get("SCAN_USER") or _claude_user() or getpass.getuser()

# ------------------------------------------------------------------ colours
class C:
    R = "\033[0m"; B = "\033[1m"; DIM = "\033[2m"; IT = "\033[3m"
    violet = "\033[38;5;99m"; vio_bg = "\033[48;5;54m\033[38;5;231m"
    grey = "\033[38;5;244m"; green = "\033[38;5;35m"; red = "\033[38;5;167m"
    amber = "\033[38;5;179m"; blue = "\033[38;5;39m"; cyan = "\033[38;5;44m"
    white = "\033[38;5;231m"
    sel = "\033[38;5;42m"                          # bright green (arrow/accent)
    sel_bg = "\033[48;5;151m\033[38;5;235m"         # light-green highlight, dark text
def _c(s, col): return f"{col}{s}{C.R}"

SHIELD = f"{C.violet}⬢{C.R}"  # hexagon-ish shield glyph


# ------------------------------------------------------------------ TUI core
def _getch():
    """Read a single keypress (handles arrow escape sequences)."""
    import termios, tty
    fd = sys.stdin.fileno()
    old = termios.tcgetattr(fd)
    try:
        tty.setraw(fd)
        ch = os.read(fd, 1).decode("utf-8", "ignore")
        if ch == "\x1b":  # escape sequence (arrows)
            ch += os.read(fd, 2).decode("utf-8", "ignore")
    finally:
        termios.tcsetattr(fd, termios.TCSADRAIN, old)
    return ch

def _hide_cursor(): sys.stdout.write("\033[?25l")
def _show_cursor(): sys.stdout.write("\033[?25h")


def menu(title, rows, subtitle=""):
    """Arrow-key single-select menu. rows = [(label, detail, enabled)]. Returns index or None.
    Disabled rows are shown dimmed with a 'Coming soon' tag and are skipped by the cursor."""
    if not sys.stdin.isatty():
        raise SystemExit("This tool needs an interactive terminal (arrow keys).")
    idx = next((i for i, r in enumerate(rows) if r[2]), 0)
    first = True
    _hide_cursor()
    try:
        while True:
            if not first:
                sys.stdout.write(f"\033[{len(rows) + 4}A")  # move cursor up to redraw
            first = False
            print(f"\n  {SHIELD}   {C.B}{title}{C.R}" + (f"     {C.grey}{subtitle}{C.R}" if subtitle else "") + "        ")
            print(f"  {C.grey}↑↓ move · enter select · q cancel{C.R}                    ")
            print("\033[K")  # spacer
            for i, (label, detail, enabled) in enumerate(rows):
                sel = i == idx
                if not enabled:
                    line = f"      {C.DIM}{label}{C.R}   {C.green}● SOON{C.R}   {C.DIM}{detail}{C.R}"
                elif sel:
                    line = f"   {C.sel}❱{C.R}  {C.sel_bg}  {label}  {C.R}    {C.grey}{detail}{C.R}"
                else:
                    line = f"      {C.white}{label}{C.R}    {C.grey}{detail}{C.R}"
                print(line + "\033[K")
            sys.stdout.flush()
            k = _getch()
            if k in ("\x1b[A", "k"):      # up
                idx = _prev_enabled(rows, idx)
            elif k in ("\x1b[B", "j"):    # down
                idx = _next_enabled(rows, idx)
            elif k in ("\r", "\n"):       # enter
                if rows[idx][2]:
                    return idx
            elif k in ("q", "\x03", "\x1b"):
                return None
    finally:
        _show_cursor()

def _next_enabled(rows, i):
    n = len(rows)
    for step in range(1, n + 1):
        j = (i + step) % n
        if rows[j][2]: return j
    return i
def _prev_enabled(rows, i):
    n = len(rows)
    for step in range(1, n + 1):
        j = (i - step) % n
        if rows[j][2]: return j
    return i


def filter_menu(title, items, subtitle=""):
    """Arrow-key single-select with live type-to-filter. Returns the selected string or None."""
    if not sys.stdin.isatty():
        raise SystemExit("This tool needs an interactive terminal.")
    query = ""; idx = 0; first = True; VIS = 10
    _hide_cursor()
    try:
        while True:
            filt = [it for it in items if query.lower() in it.lower()] or []
            idx = max(0, min(idx, len(filt) - 1))
            start = max(0, min(idx - VIS + 1, len(filt) - VIS)) if len(filt) > VIS else 0
            window = filt[start:start + VIS]
            if not first:
                sys.stdout.write(f"\033[{VIS + 4}A")
            first = False
            print(f"\n  {SHIELD}   {C.B}{title}{C.R}     {C.grey}{subtitle}{C.R}        ")
            print(f"  {C.grey}type to filter · ↑↓ move · enter select · esc cancel{C.R}   ")
            print(f"  {C.cyan}search:{C.R} {query}{C.sel}█{C.R}\033[K")
            for i in range(VIS):
                if i < len(window):
                    it = window[i]; sel = (start + i) == idx
                    if sel:
                        print(f"   {C.sel}❱{C.R}  {C.sel_bg}  {it}  {C.R}\033[K")
                    else:
                        print(f"      {C.white}{it}{C.R}\033[K")
                else:
                    print("\033[K")
            cnt = f"  {C.grey}{len(filt)} of {len(items)} branches{C.R}"
            sys.stdout.write("\r" + cnt + "\033[K\n"); sys.stdout.flush()
            sys.stdout.write("\033[1A")  # keep count line stable
            k = _getch()
            if k in ("\x1b[A",): idx = max(0, idx - 1)
            elif k in ("\x1b[B",): idx = min(len(filt) - 1, idx + 1) if filt else 0
            elif k in ("\r", "\n"):
                if filt: return filt[idx]
            elif k in ("\x7f", "\b"): query = query[:-1]; idx = 0
            elif k in ("\x1b", "\x03"): return None
            elif k.isprintable() and len(k) == 1: query += k; idx = 0
    finally:
        _show_cursor()


# ------------------------------------------------------------------ scope (mirrors .github/scripts/scope.py)
SCOPE_COMPOSE = {"docker-compose.egov-digit.yaml", "docker-compose.fast-path.yml", "docker-compose.bomet.yml",
                 "docker-compose.monitoring.yml", "docker-compose.migrations.yml", "docker-compose.matomo.yml"}
SCOPE_SUBDIRS = ("ansible/", "configs/", "db/", "gatus/", "jupyter/", "keycloak/", "kong/", "nginx/", "otel/", "seeds/", "tests/")
def in_scope(p):
    p = (p or "").replace("\\", "/").lstrip("./")
    if not p: return False
    q = p[len("local-setup/"):] if p.startswith("local-setup/") else p
    if "/" not in q: return q in SCOPE_COMPOSE
    return any(q.startswith(d) for d in SCOPE_SUBDIRS)


# ------------------------------------------------------------------ steps
def sh(cmd, **kw):
    return subprocess.run(cmd, capture_output=True, text=True, **kw)

def get_branches(full):
    # git-only (no gh needed): list remote heads. Works unauthenticated for public repos;
    # uses the user's git credentials for private ones.
    url = f"https://github.com/{full}.git"
    r = sh(["git", "ls-remote", "--heads", url])
    branches = [ln.split("refs/heads/", 1)[1] for ln in r.stdout.splitlines() if "refs/heads/" in ln]
    return branches or ["master", "main"]

def clone(full, branch, dest):
    url = f"https://github.com/{full}.git"
    r = sh(["git", "clone", "--depth", "1", "--branch", branch, url, dest])
    if r.returncode != 0:
        raise SystemExit(_c("clone failed: ", C.red) + r.stderr.strip()[:400])
    sha = sh(["git", "-C", dest, "rev-parse", "HEAD"]).stdout.strip()
    return sha

def inscope_files(root):
    ls = os.path.join(root, "local-setup")
    out = []
    for dp, _, fns in os.walk(ls):
        if "/.git" in dp or "/node_modules" in dp or "/__pycache__" in dp:
            continue
        for fn in fns:
            rel = os.path.relpath(os.path.join(dp, fn), root).replace(os.sep, "/")
            if in_scope(rel) and os.path.getsize(os.path.join(dp, fn)) < 600_000:
                out.append(rel)
    return sorted(out)


# Canonical audit checklist - evaluated on EVERY run so the finding SET is reproducible
# across users/machines (not open-ended discovery). Each = (check_id, what to verify).
CHECKLIST = [
    ("jupyter-root-published",     "Jupyter/Lab container published on 0.0.0.0, running as root, and/or with an empty/disabled token or password"),
    ("datastores-published-0000",  "Datastore ports (PostgreSQL, Redis, Kafka/Redpanda, MinIO, Mongo, ES) published on 0.0.0.0 / all host interfaces"),
    ("admin-ui-published-0000",    "Admin/observability UIs (Grafana, Prometheus, Kibana, Kafka-UI) published on 0.0.0.0"),
    ("kong-admin-published",       "Kong Admin API / Kong Manager bound 0.0.0.0 and/or published to the host"),
    ("mcp-unauth-admin",           "nginx /mcp (or similar) exposes unauthenticated admin tools; check the nginx_features.mcp / enable_mcp DEFAULT and whether the shipped host_vars template turns it on"),
    ("seeded-default-credentials", "Committed/seeded default application or admin credentials (e.g. eGov@123, System@123) used at deploy time"),
    ("otp-fixed-or-mocked",        "Citizen/user login OTP fixed to a constant or mocked by the gateway by default"),
    ("grafana-anonymous-admin",    "Grafana anonymous auth enabled and/or anonymous org role = Admin, login form disabled"),
    ("enc-or-jwt-dev-secret",      "Encryption master key / JWT / signing secret defaults to a committed dev value"),
    ("docker-socket-mount",        "/var/run/docker.sock mounted into a container (read-only or read-write)"),
    ("sensitive-host-mount",       "Writable sensitive host paths mounted into a container (not read-only monitoring mounts)"),
    ("host-firewall-absent",       "Playbook configures NO host firewall (ufw/firewalld/nftables) while publishing many ports"),
    ("nginx-security-headers",     "Public nginx vhost missing security response headers (HSTS, X-Content-Type-Options, CSP, server_tokens off)"),
    ("minio-anonymous-access",     "MinIO/object bucket set to anonymous/public download or served without auth"),
    ("ssh-hostkey-disabled",       "Deployment disables SSH host-key checking (StrictHostKeyChecking=no / host_key_checking=false)"),
    ("curl-pipe-bash-install",     "A remote install script fetched and piped straight into a shell (curl|bash) without integrity check"),
    ("insecure-http-registry",     "Docker daemon configured with an insecure (HTTP) registry, or unpinned/mutable image or git refs"),
    ("kong-auth-rbac-disabled",    "Kong gateway auth/RBAC not enforced, or a fail-open pre-function / permissive route"),
    ("kong-cors-wildcard-creds",   "Kong/nginx CORS allows any origin together with credentials:true"),
    ("keycloak-loose-redirect",    "Keycloak realm allows loose/localhost/wildcard redirect URIs or web origins"),
    ("openbao-vault-tls-disabled", "OpenBao/Vault listener runs with TLS disabled, or unseal keys / root token exposed"),
    ("monitoring-host-namespace",  "node-exporter/monitoring uses pid:host and read-only /proc,/sys mounts (benign-by-design - mark acceptable)"),
    ("capabilities-not-dropped",   "Containers do not drop Linux capabilities (missing cap_drop: [ALL])"),
    ("no-new-privileges-missing",  "Containers missing security_opt: no-new-privileges"),
    ("tls-cert-validation-toggle", "TLS/cert validation can be toggled off (validate_certs:false / insecure) on internal or external calls"),
    ("test-ci-dependency-cves",    "Dependency CVEs in test/CI tooling only (e.g. local-setup/tests/package-lock.json) - real but NOT the production runtime"),
    # promoted from recurring extra-* discoveries -> now always checked + consistently scored
    ("kubectl-api-arbitrary-sql",  "A kubectl/SQL/command HTTP helper (e.g. jupyter/dataloader) allows arbitrary queries or commands via a default or weak API key"),
    ("minio-init-hardcoded-creds", "MinIO (or other object store) init/bootstrap uses hardcoded root/admin credentials"),
    ("backend-services-published", "Backend microservice ports are published to the host, reachable bypassing the Kong/nginx gateway"),
    ("elasticsearch-security-off", "Elasticsearch/OpenSearch runs with security/authentication disabled"),
    ("gatus-public-health-board",  "Gatus (or a status page) exposes internal service topology/health publicly"),
    ("optin-stack-dev-secrets",    "An opt-in stack (Novu, Keycloak, mcp-postgres, etc.) ships dev-default secrets or API keys"),
    ("anonymous-user-search",      "A user/employee search or directory endpoint permits unauthenticated enumeration"),
    ("unverified-binary-download", "A Java agent / jar / binary is downloaded at deploy time without checksum or signature verification"),
    ("integration-tests-runner-root", "Integration-test systemd runner (or similar) executes as root and/or without process hardening"),
    ("committed-gmaps-api-key",    "A Google Maps (or other third-party) API key is committed in the repo or config"),
]

def build_prompt(full, branch, files):
    listing = "\n".join(f"  - {f}" for f in files)
    checklist = "\n".join(f"  {cid}: {desc}" for cid, desc in CHECKLIST)
    n = len(CHECKLIST)
    schema = '''{
  "executive_summary": "3-5 sentences for a public-sector delivery team: overall posture, systemic themes, what to fix first.",
  "priority_actions": ["ordered, concrete remediation steps tied to the findings", "..."],
  "findings": [
    {
      "check_id": "the canonical checklist id above, OR extra-<kebab-slug> for a genuine finding not on the list",
      "present": true,
      "title": "one-line issue (for a conditional/opt-in issue that is default-off, say so: '... (only when <feature> enabled, default off)')",
      "category": "Container Isolation & Escape|Host & Service Hardening|File Permissions|Access Control|Supply Chain & Integrity|Web & Edge Hardening|Network Exposure|Transport Security (TLS)|Secrets Management|Resource & Availability Controls|Data Sharing|General Hardening",
      "area": "docker-compose|ansible|nginx|kong|otel|jupyter|seeds|keycloak|tests",
      "impact": "rce|auth_bypass|cred_exposure|data_exposure|container_escape|priv_esc|mitm|dos|hardening",
      "exposure": "public|internal|local",
      "runtime": "prod|test_ci",
      "default_active": true,
      "benign": false,
      "confidence": 0.0,
      "cwe": "CWE-####",
      "reason": "<=25 words, evidence you actually found (cite what you read)",
      "why": "1-2 sentences: the concrete risk in THIS deployment (what an attacker gains)",
      "fix": "the exact change - name the file/service and give the precise directive/snippet",
      "reference": "authoritative URL (OWASP/CIS/CWE) or empty",
      "locations": [ {"path": "local-setup/....", "line": 123 } ]
    }
  ]
}'''
    return f"""You are a principal application-security engineer performing a DEEP, definitive, and
REPRODUCIBLE security audit of the **Ansible remote-server deployment** of a DIGIT/CMS
public-sector complaint-management platform. Repository: {full}  Branch: {branch}. Repo is PUBLIC.

DEPLOYMENT REALITY (judge real-world abusability here, not a generic rule):
- Setup path C (local-setup/README.md -> "Option C - Ansible remote server"): `./deploy.sh <tenant>`
  from local-setup/ansible, onto a SINGLE internet-facing host.
- nginx terminates TLS on 443 and is the intended public entry point. Externally only 22/80/443
  are reachable; the cloud security group is the SOLE control in front of everything else.
- There is NO host firewall (ufw inactive) and ~33 ports - incl. datastores (PostgreSQL, Redis,
  Kafka, MinIO) and admin UIs (Grafana, Prometheus, Jupyter, Kong admin) - bind 0.0.0.0.
- Data is citizen grievance data (confidential).

SCOPE - audit ONLY these in-scope deployment files (ignore k8s/Helm, Tilt, the base/registry/
deploy/db-migrations compose variants, and app source under backend/ or turbopass/):
{listing}

METHOD: Read the deployment docs first (local-setup/README.md, local-setup/ansible/README.md),
then use Read/Grep/Glob to VERIFY every claim against the actual code. You have a high token
budget - be exhaustive and precise; never guess.

MANDATORY CHECKLIST - evaluate EVERY item below on this repo. You MUST return EXACTLY ONE entry
per check_id listed below, each carrying a boolean "present":
  - present:true  -> the issue actually holds in the code: include locations + all facts.
  - present:false -> it does not apply here OR the control is already in place: no locations needed.
Do NOT skip any checklist id, and do NOT rename a checklist issue to an extra-* id - use the EXACT
check_id from the list. After all {n} checklist entries, add any genuinely NEW issues (not on the
list) as separate entries with check_id "extra-<kebab-slug>" and present:true.
{checklist}

STRICT RULES:
1. NO FALSE POSITIVES - only flag conditions that ACTUALLY HOLD in code you read. Never claim a
   mitigation exists "elsewhere" unless you found it and can cite file:line.
2. VERIFY LOCATIONS - every location.path is a real in-scope file; line points at the offending line.
3. Report OBJECTIVE FACTS, not a severity word. Do NOT output severity or priority - the tool computes
   them deterministically from your facts. Set them honestly:
   - impact: the worst realistic outcome (rce, auth_bypass, cred_exposure, data_exposure,
     container_escape, priv_esc, mitm, dos, hardening).
   - exposure: public (reachable from the internet edge), internal (container-to-container), local (host-only).
   - runtime: "test_ci" if the code runs ONLY under tests/ or CI-only flags (e.g. run_ci_tests); else "prod".
   - default_active: true if the risky condition is active in the DEFAULT/shipped config; false if it is
     opt-in/conditional (e.g. a feature that defaults off). CHECK the actual defaults AND shipped host_vars.
   - benign: true ONLY for reliability-only or benign-by-design controls (missing healthcheck, cpu/memory
     limits, shared named volumes, a privileged port remapped to a high host port, read-only monitoring
     host mounts). Docker-socket and writable sensitive mounts are NOT benign.
4. Group each distinct issue into ONE finding with all its locations. Deduplicate. Use the SAME check_id
   for the same issue every run.

OUTPUT: Write your result as a SINGLE JSON object (matching the schema below) to a file named
`findings.json` in the current working directory, using the Write tool. Do NOT print the JSON in
the chat - write it to the file. After the file is written, reply with only the word: DONE

Schema for findings.json:
{schema}
"""


def run_claude(prompt, workdir):
    cmd = ["claude", "-p", "--output-format", "json",
           "--allowedTools", "Read", "Grep", "Glob", "Write",
           "Bash(cat:*)", "Bash(sed:*)", "Bash(grep:*)", "Bash(rg:*)",
           "Bash(find:*)", "Bash(ls:*)", "Bash(head:*)", "Bash(tail:*)",
           "Bash(git log:*)", "Bash(git show:*)", "Bash(awk:*)"]
    if SCAN_MODEL:
        cmd += ["--model", SCAN_MODEL]
    findings_path = os.path.join(workdir, "findings.json")
    if os.path.exists(findings_path):
        os.remove(findings_path)
    print(f"\n  {C.violet}▶{C.R} Running Claude deep scan {C.grey}(reads & verifies every in-scope file; this can take several minutes)…{C.R}")
    p = subprocess.run(cmd, input=prompt, capture_output=True, text=True, cwd=workdir, timeout=2400)
    if p.returncode != 0:
        raise SystemExit(_c("claude failed: ", C.red) + (p.stderr or p.stdout)[:600])
    try:
        env = json.loads(p.stdout)
    except Exception:
        raise SystemExit(_c("could not parse claude envelope", C.red) + "\n" + p.stdout[:600])
    if env.get("is_error"):
        raise SystemExit(_c("claude reported an error: ", C.red) + str(env.get("result"))[:400])
    usage = env.get("total_cost_usd")
    model = ",".join((env.get("modelUsage") or {}).keys())
    # Prefer the file Claude wrote (robust: no chat-message truncation, prose, or fences);
    # fall back to parsing the result text if the file is missing.
    data = None
    if os.path.isfile(findings_path):
        try: data = json.load(open(findings_path))
        except Exception: data = _extract_json(open(findings_path, errors="ignore").read())
    if not data:
        data = _extract_json(env.get("result", ""))
    if not data or "findings" not in data:
        raise SystemExit(_c("claude did not return findings JSON (no findings.json written and result unparseable):\n", C.red)
                         + str(env.get("result", ""))[:800])
    return data, {"model": model, "cost": usage, "turns": env.get("num_turns")}

def _extract_json(text):
    """Best-effort extraction: fenced ```json block, else the outermost {...}; tolerate trailing commas."""
    text = (text or "").strip()
    m = re.search(r"```(?:json)?\s*(\{.*\})\s*```", text, re.S)
    if m:
        text = m.group(1)
    else:
        i, j = text.find("{"), text.rfind("}")
        if 0 <= i < j:
            text = text[i:j + 1]
    for candidate in (text, re.sub(r",(\s*[}\]])", r"\1", text)):
        try: return json.loads(candidate)
        except Exception: pass
    return None


# ------------------------------------------------------------------ dashboard assembly
SEV_ORDER = ["CRITICAL", "HIGH", "MEDIUM", "LOW"]
def norm_sev(s):
    s = (s or "").upper()
    return s if s in SEV_ORDER else ("LOW" if s in ("INFO", "INFORMATIONAL") else "MEDIUM")

def blob(full, sha, path, line):
    u = f"https://github.com/{full}/blob/{sha}/{path}"
    return u + (f"#L{line}" if line else "")

# ---- DETERMINISTIC SCORING ----------------------------------------------
# Severity/priority/status are a pure function of the objective facts Claude reports
# (impact, exposure, runtime, default_active, benign, category) - NOT of an LLM severity
# word. Same facts -> same label, on every machine and every run. This is what makes a
# shared scan reproducible.
_PRI = ["P0", "P1", "P2", "P3"]
def _down(p): return _PRI[min(_PRI.index(p) + 1, 3)] if p in _PRI else p
RELIABILITY_CATS = {"Resource & Availability Controls"}
IMPACT_BASE = {
    "rce":             ("CRITICAL", "P0"),
    "auth_bypass":     ("CRITICAL", "P0"),
    "cred_exposure":   ("HIGH", "P0"),
    "data_exposure":   ("HIGH", "P1"),
    "container_escape":("HIGH", "P2"),
    "priv_esc":        ("HIGH", "P2"),
    "mitm":            ("MEDIUM", "P2"),
    "dos":             ("MEDIUM", "P3"),
    "hardening":       ("MEDIUM", "P3"),
}
def score(f):
    """Return (severity, priority, status) deterministically from a finding's facts."""
    impact   = (f.get("impact") or "hardening").lower()
    exposure = (f.get("exposure") or "internal").lower()
    runtime  = (f.get("runtime") or "prod").lower()
    d = f.get("default_active", True); default = True if d is None else bool(d)
    benign   = bool(f.get("benign"))
    cat      = f.get("category", "")
    # test/CI-only code: real, but not the production runtime
    if runtime in ("test_ci", "test", "ci"):
        return "LOW", "P3", "action_required"
    # reliability-only / benign-by-design -> acceptable (documented, not tracked)
    if benign or cat in RELIABILITY_CATS:
        return "LOW", "", "acceptable"
    sev, pri = IMPACT_BASE.get(impact, ("MEDIUM", "P3"))
    # a high-impact surface reachable from the public edge, active by default = crown-jewel P0
    if impact in ("rce", "auth_bypass", "cred_exposure", "data_exposure") and exposure == "public" and default:
        pri = "P0"
        sev = "CRITICAL" if impact in ("rce", "auth_bypass") else "HIGH"
    # modifiers: not internet-reachable, or not active by default -> less urgent
    if exposure != "public":
        pri = _down(pri)
    if not default:
        pri = _down(pri)
        if sev == "CRITICAL": sev = "HIGH"
    return sev, pri, "action_required"


# CANONICAL score per checklist finding -> severity/priority are 100% consistent across runs
# and machines (they never depend on the LLM's wording). The LLM only decides present/absent
# + locations for these. Only open-ended `extra-*` findings fall back to fact-based score().
CHECK_SCORE = {
    "jupyter-root-published":       ("CRITICAL", "P0", "action_required"),
    "kong-admin-published":         ("CRITICAL", "P0", "action_required"),
    "mcp-unauth-admin":             ("CRITICAL", "P0", "action_required"),
    "seeded-default-credentials":   ("CRITICAL", "P0", "action_required"),
    "otp-fixed-or-mocked":          ("CRITICAL", "P0", "action_required"),
    "grafana-anonymous-admin":      ("CRITICAL", "P0", "action_required"),
    "kong-auth-rbac-disabled":      ("CRITICAL", "P0", "action_required"),
    "kong-cors-wildcard-creds":     ("CRITICAL", "P0", "action_required"),
    "curl-pipe-bash-install":       ("CRITICAL", "P0", "action_required"),
    "insecure-http-registry":       ("CRITICAL", "P1", "action_required"),
    "datastores-published-0000":    ("HIGH", "P0", "action_required"),
    "admin-ui-published-0000":      ("HIGH", "P0", "action_required"),
    "host-firewall-absent":         ("HIGH", "P0", "action_required"),
    "minio-anonymous-access":       ("HIGH", "P0", "action_required"),
    "enc-or-jwt-dev-secret":        ("HIGH", "P1", "action_required"),
    "keycloak-loose-redirect":      ("HIGH", "P1", "action_required"),
    "openbao-vault-tls-disabled":   ("HIGH", "P1", "action_required"),
    "sensitive-host-mount":         ("HIGH", "P2", "action_required"),
    "docker-socket-mount":          ("HIGH", "P3", "action_required"),
    "capabilities-not-dropped":     ("HIGH", "P3", "action_required"),
    "no-new-privileges-missing":    ("HIGH", "P3", "action_required"),
    "ssh-hostkey-disabled":         ("MEDIUM", "P2", "action_required"),
    "tls-cert-validation-toggle":   ("MEDIUM", "P2", "action_required"),
    "nginx-security-headers":       ("MEDIUM", "P3", "action_required"),
    "test-ci-dependency-cves":      ("LOW", "P3", "action_required"),
    "monitoring-host-namespace":    ("LOW", "", "acceptable"),
    # promoted extras
    "minio-init-hardcoded-creds":   ("HIGH", "P0", "action_required"),
    "backend-services-published":   ("HIGH", "P0", "action_required"),
    "kubectl-api-arbitrary-sql":    ("HIGH", "P1", "action_required"),
    "elasticsearch-security-off":   ("HIGH", "P1", "action_required"),
    "optin-stack-dev-secrets":      ("HIGH", "P1", "action_required"),
    "anonymous-user-search":        ("HIGH", "P1", "action_required"),
    "unverified-binary-download":   ("CRITICAL", "P1", "action_required"),
    "gatus-public-health-board":    ("MEDIUM", "P2", "action_required"),
    "integration-tests-runner-root":("MEDIUM", "P3", "action_required"),
    "committed-gmaps-api-key":      ("MEDIUM", "P2", "action_required"),
}

def build_run(data, full, branch, sha, runid, model):
    raw = []
    for f in data.get("findings", []):
        if f.get("present") is False:      # explicit "checked, not present" verdict -> not a finding
            continue
        cid = f.get("check_id") or f.get("id") or "finding"
        sev, pri, status = CHECK_SCORE.get(cid) or score(f)   # checklist=fixed, extra-*=fact-based
        locs = []
        for l in (f.get("locations") or []):
            path = (l.get("path") or "").lstrip("./")
            if not in_scope(path):   # final guard: never emit an out-of-scope location
                continue
            locs.append({"path": path, "line": l.get("line"), "url": blob(full, sha, path, l.get("line"))})
        raw.append({
            "severity": sev, "source": "Claude", "area": f.get("area", "ansible"),
            "id": cid, "title": f.get("title", ""),
            "category": f.get("category", "General Hardening"),
            "guide": f.get("reference", ""), "cvss": f.get("cvss"), "cwe": f.get("cwe", ""),
            "count": max(1, len(locs)), "locations": locs,
            "why": f.get("why", ""), "fix": f.get("fix", ""), "curated": True, "enriched": True,
            "triage": {"status": status, "priority": pri, "exposure": f.get("exposure", "unknown"),
                       "confidence": f.get("confidence"), "reason": f.get("reason", "")},
        })
    # dedup by canonical check_id -> stable grouping regardless of how locations were split
    merged = {}
    for f in raw:
        g = merged.get(f["id"])
        if not g:
            merged[f["id"]] = f; continue
        seen = {(l["path"], l["line"]) for l in g["locations"]}
        for l in f["locations"]:
            if (l["path"], l["line"]) not in seen:
                g["locations"].append(l); seen.add((l["path"], l["line"]))
        g["count"] = max(1, len(g["locations"]))
    findings = list(merged.values())
    order = {s: i for i, s in enumerate(SEV_ORDER)}
    prio = {"P0": 0, "P1": 1, "P2": 2, "P3": 3, "": 9}
    findings.sort(key=lambda g: (prio.get((g["triage"] or {}).get("priority"), 9), order.get(g["severity"], 9), -g["count"]))
    import collections
    types_by = collections.Counter(f["severity"] for f in findings)
    occ_by = collections.Counter()
    for f in findings: occ_by[f["severity"]] += f["count"]
    now = datetime.datetime.now(datetime.timezone.utc)
    run = {
        "meta": {"repo": full, "branch": branch, "sha": sha, "shaShort": sha[:7],
                 "runId": runid, "runUrl": f"https://github.com/{full}/tree/{sha}",
                 "pr": None, "scope": "Ansible Deployment — Remote Server",
                 "scanners": [f"Claude deep scan ({model})"],
                 "engine": f"Claude ({model})",
                 "executive_summary": data.get("executive_summary", ""),
                 "priority_actions": data.get("priority_actions", []) if isinstance(data.get("priority_actions"), list) else [],
                 "enriched": True,
                 "date": now.strftime("%Y-%m-%d %H:%M UTC"), "ts": now.isoformat()},
        "summary": {"types": len(findings), "occurrences": sum(f["count"] for f in findings),
                    "typesBySeverity": {s: types_by.get(s, 0) for s in SEV_ORDER},
                    "occBySeverity": {s: occ_by.get(s, 0) for s in SEV_ORDER}},
        "findings": findings,
    }
    return run

def prepare_artifacts(run, runid, clone_dir):
    """Write run.json to a temp dir and build the Excel via the cloned repo's builder.
    Returns (runfile_path, xlsx_path_or_None)."""
    outdir = tempfile.mkdtemp(prefix="secscan-out-")
    runfile = os.path.join(outdir, f"{runid}.json")
    json.dump(run, open(runfile, "w"), indent=1)
    xlsx = os.path.join(outdir, f"{runid}.xlsx")
    builder = os.path.join(TOOL_HOME, "scripts", "build_audit_xlsx.py")   # bundled under scripts/
    if os.path.isfile(builder):
        r = sh(["python3", builder], env=dict(os.environ, RUN_JSON=runfile, OUT_XLSX=xlsx))
        if r.returncode != 0 or not os.path.isfile(xlsx):
            xlsx = None
    else:
        xlsx = None
    return runfile, xlsx


# ---------------------------- upload (Apps Script -> Drive + gh-pages) --------------------
def _ordinal(n):
    return f"{n}{'th' if 11 <= n % 100 <= 13 else {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th')}"

def run_label(username):
    """e.g. 'Shivam - 7th Sep 2026, 12:45 IST' (local time, 24h, local tz abbreviation)."""
    now = datetime.datetime.now().astimezone()
    tz = now.strftime("%Z")
    return f"{username} - {_ordinal(now.day)} {now.strftime('%b %Y, %H:%M')}" + (f" {tz}" if tz else "")

def _ssl_ctx():
    """python.org macOS builds ship no system CA bundle; prefer certifi, else the default."""
    import ssl
    try:
        import certifi
        return ssl.create_default_context(cafile=certifi.where())
    except Exception:
        try: return ssl.create_default_context()
        except Exception: return None
_SSL = _ssl_ctx()

def _post(payload):
    import urllib.request
    req = urllib.request.Request(WEBAPP_URL, data=json.dumps(payload).encode(),
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=300, context=_SSL) as r:
        return json.loads(r.read().decode())

def upload_run(runfile, xlsx_path, branch):
    """ONE POST to the Apps Script: it stores the run + Excel on Drive AND publishes the run to
    this repo's gh-pages dashboard. The token comes from SECSCAN_TOKEN and is never committed."""
    if not TOKEN:
        print(f"  {C.amber}SECSCAN_TOKEN not set - skipping upload (dashboard not updated).{C.R}")
        print(f"  {C.grey}set it and re-run:  export SECSCAN_TOKEN='...'{C.R}")
        return None
    import base64
    base = run_label(USERNAME)
    payload = {
        "token": TOKEN, "repo": REPO_FULL, "branch": branch, "base": base,
        "folders": ["CMS-Security-Scan"] + [x for x in REPO_FULL.split("/") if x],
        "runJsonBase64": base64.b64encode(open(runfile, "rb").read()).decode(),
        "xlsxBase64": (base64.b64encode(open(xlsx_path, "rb").read()).decode()
                       if xlsx_path and os.path.isfile(xlsx_path) else ""),
    }
    print(f"  {C.grey}uploading '{base}' to Drive + gh-pages...{C.R}")
    try:
        resp = _post(payload)
    except Exception as e:
        print(f"  {C.red}upload failed:{C.R} {C.grey}{e}{C.R}"); return None
    if not resp.get("ok"):
        print(f"  {C.red}upload rejected:{C.R} {C.grey}{resp.get('error')}{C.R}"); return None
    tail = (f" {C.grey}+ published to gh-pages{C.R}" if resp.get("pagesOk")
            else f" {C.amber}(gh-pages: {resp.get('pagesError', 'not published')}){C.R}")
    print(f"  {C.green}✓ uploaded to Drive{C.R}" + tail)
    return resp


# ------------------------------------------------------------------ main
def banner():
    print(f"""
  {C.sel}{C.B}⬢  DIGIT Security Scanner{C.R}  {C.grey}· Claude-powered deep audit{C.R}
  {C.DIM}deterministic severity/priority · real file verification · results to gh-pages{C.R}""")

def summarize(run, meta):
    s = run["summary"]; t = s["typesBySeverity"]
    action = [f for f in run["findings"] if (f["triage"] or {}).get("status") == "action_required"]
    acc = [f for f in run["findings"] if (f["triage"] or {}).get("status") == "acceptable"]
    p0 = sum(1 for f in action if (f["triage"] or {}).get("priority") == "P0")
    print(f"\n  {C.B}Scan complete{C.R}  {C.grey}model={meta.get('model')} · turns={meta.get('turns')}"
          + (f" · ~${meta.get('cost'):.2f}" if meta.get('cost') else "") + f"{C.R}")
    print(f"  {C.red}CRITICAL {t['CRITICAL']}{C.R}  {C.amber}HIGH {t['HIGH']}{C.R}  "
          f"{C.green}MEDIUM {t['MEDIUM']}{C.R}  {C.blue}LOW {t['LOW']}{C.R}   "
          f"{C.grey}({s['types']} issue types · {s['occurrences']} occurrences){C.R}")
    print(f"  {C.B}Action-required: {len(action)}{C.R} {C.grey}(P0: {p0}){C.R}  ·  Acceptable: {len(acc)}")
    print(f"\n  {C.B}Top action-required:{C.R}")
    for f in action[:6]:
        pr = (f["triage"] or {}).get("priority", "--")
        print(f"   {C.sel}{pr:>2}{C.R}/{f['severity']:<8} {f['title'][:66]}")


def main():
    for tool in ("claude", "git"):
        if not shutil.which(tool):
            raise SystemExit(_c(f"missing required tool: {tool}", C.red))
    banner()
    # fixed repo (per-repo config) - print it up front
    print(f"\n  {C.B}Repository:{C.R}  {C.blue}{REPO_FULL}{C.R}")
    print(f"  {C.grey}{REPO_URL}{C.R}")
    print(f"  {C.grey}dashboard:  {PAGES_URL}{C.R}")
    if not TOKEN:
        print(f"  {C.amber}note: SECSCAN_TOKEN not set - the scan runs but results will NOT upload.{C.R}")
    # 1) BRANCH first
    print(f"\n  {C.grey}fetching branches for {REPO_FULL}...{C.R}")
    branches = get_branches(REPO_FULL)
    if DEFAULT_BRANCH in branches:
        branches = [DEFAULT_BRANCH] + [b for b in branches if b != DEFAULT_BRANCH]
    branch = filter_menu("Select a branch", branches, subtitle=REPO_NAME)
    if branch is None: return
    # 2) MODULE second
    mi = menu("Select a scan module", [(m["name"], m["detail"], m["enabled"]) for m in MODULES],
              subtitle=f"{REPO_NAME} · {branch}")
    if mi is None: return

    print(f"\n  {SHIELD}  {C.B}{REPO_NAME}{C.R} {C.grey}·{C.R} {C.B}{branch}{C.R} {C.grey}·{C.R} {C.B}{MODULES[mi]['name']}{C.R}")
    tmp = tempfile.mkdtemp(prefix="secscan-")
    try:
        clone_dir = os.path.join(tmp, "repo")
        print(f"  {C.grey}cloning {branch}...{C.R}")
        sha = clone(REPO_FULL, branch, clone_dir)
        files = inscope_files(clone_dir)
        print(f"  {C.grey}in-scope files: {len(files)}{C.R}")
        prompt = build_prompt(REPO_FULL, branch, files)
        data, meta = run_claude(prompt, clone_dir)
        runid = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
        run = build_run(data, REPO_FULL, branch, sha, runid, meta.get("model", "claude"))
        summarize(run, meta)
        runfile, xlsx = prepare_artifacts(run, runid, clone_dir)
        resp = upload_run(runfile, xlsx, branch)
        if resp and resp.get("pagesOk"):
            print(f"\n  {C.green}✓ published:{C.R} {C.blue}{PAGES_URL}{C.R}")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        _show_cursor(); print("\n  cancelled.")
