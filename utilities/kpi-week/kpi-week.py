#!/usr/bin/env python3
"""Weekly M&E figures for a CCRS/DIGIT deployment, in the order of the tracking workbook.

Columns the platform cannot produce yet print as "-".

usage: kpi-week.py <week-start YYYY-MM-DD> <week-end YYYY-MM-DD> [authToken] [baseUrl] [tenantId]

Flags: --csv [file]  also write a CSV (default kpi-<start>_<end>.csv); --raw, --matomo-pages

Config resolution order (env wins, then a `kpi.env` file beside this script):
    AUTH_TOKEN     PGR service authToken (may also be passed as arg 3)
    PGR_USERNAME   service account used to mint a token when AUTH_TOKEN is unset (cron)
    PGR_PASSWORD   its password (keep in kpi.env, chmod 600)
    BASE_URL       PGR base URL           (required)
    TENANT_ID      PGR tenant             (required)
    TZ_NAME        IANA zone for day boundaries (default UTC)
    WEEK1_START    week 1 of the tracking sheet; unset -> ISO week numbers
    MATOMO_URL     Matomo …/index.php     (web-analytics columns; skipped if unset)
    MATOMO_TOKEN   Matomo auth token
    MATOMO_SITE_ID Matomo site id         (default 1)

Put the secrets in kpi.env (chmod 600, never committed) so a run is just:
    python3 kpi-week.py 2026-09-07 2026-09-13
"""
import base64, csv, datetime, glob, gzip, json, os, subprocess, sys, urllib.parse, urllib.request, zoneinfo

NA = "-"


def load_env_file():
    """KEY=value lines from kpi.env beside the script; never overrides real env vars."""
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "kpi.env")
    if not os.path.exists(path):
        return
    with open(path) as fh:
        lines = fh.readlines()
    for raw in lines:
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


load_env_file()

# Deployment-specific, so both come from config. TZ_NAME decides which local day a
# timestamp falls in. WEEK1_START is only needed where weeks are numbered against a
# programme sheet; unset, the ISO week number is used.
ZONE = zoneinfo.ZoneInfo(os.environ.get("TZ_NAME", "UTC"))
_week1 = os.environ.get("WEEK1_START")
W1_START = datetime.date.fromisoformat(_week1) if _week1 else None

def positional_args(argv):
    """positional args only: drop flags and the optional filename after --csv."""
    pos, i = [], 0
    while i < len(argv):
        a = argv[i]
        if a == "--csv" and i + 1 < len(argv) and not argv[i + 1].startswith("-"):
            i += 2                                   # skip --csv and its filename
            continue
        if not a.startswith("-"):
            pos.append(a)
        i += 1
    return pos


pos = positional_args(sys.argv[1:])
if len(pos) < 2 or "--help" in sys.argv or "-h" in sys.argv:
    sys.exit(__doc__.strip())

start, end = pos[0], pos[1]
for label, value in (("week-start", start), ("week-end", end)):
    try:
        datetime.date.fromisoformat(value)
    except ValueError:
        sys.exit(f"{label} must be YYYY-MM-DD, got {value!r}")
if datetime.date.fromisoformat(start) > datetime.date.fromisoformat(end):
    sys.exit(f"week-start {start} is after week-end {end}")
token = pos[2] if len(pos) > 2 else os.environ.get("AUTH_TOKEN")
base = pos[3] if len(pos) > 3 else os.environ.get("BASE_URL")
tenant = pos[4] if len(pos) > 4 else os.environ.get("TENANT_ID")
if not base or not tenant:
    sys.exit("set BASE_URL and TENANT_ID (in kpi.env or the environment), or pass them as args 4 and 5")
# Air-gapped host: point BASE_URL/MATOMO_URL at kong or a container, and set
# HTTP_HOST_HEADER so kong still matches the public route (the deployment's domain).
HOST_HEADER = os.environ.get("HTTP_HOST_HEADER")

# Unattended runs (cron): mint a token from service-account credentials instead of
# pasting a short-lived AUTH_TOKEN. An explicit AUTH_TOKEN still wins if supplied.
PGR_USERNAME = os.environ.get("PGR_USERNAME")
PGR_PASSWORD = os.environ.get("PGR_PASSWORD")
PGR_USER_TYPE = os.environ.get("PGR_USER_TYPE", "EMPLOYEE")
OAUTH_CLIENT_ID = os.environ.get("OAUTH_CLIENT_ID", "egov-user-client")
OAUTH_CLIENT_SECRET = os.environ.get("OAUTH_CLIENT_SECRET", "")


def mint_token():
    """Fetch a fresh authToken with the service-account credentials."""
    data = urllib.parse.urlencode({"username": PGR_USERNAME, "password": PGR_PASSWORD,
                                   "grant_type": "password", "scope": "read",
                                   "tenantId": tenant, "userType": PGR_USER_TYPE}).encode()
    basic = base64.b64encode(f"{OAUTH_CLIENT_ID}:{OAUTH_CLIENT_SECRET}".encode()).decode()
    req = urllib.request.Request(f"{base}/user/oauth/token", data=data,
                                 headers={"Authorization": f"Basic {basic}",
                                          "Content-Type": "application/x-www-form-urlencoded"})
    if HOST_HEADER:
        req.add_header("Host", HOST_HEADER)
    return json.loads(urllib.request.urlopen(req, timeout=60).read())["access_token"]


if not token:
    if not (PGR_USERNAME and PGR_PASSWORD):
        sys.exit("no PGR authToken: set AUTH_TOKEN, or PGR_USERNAME/PGR_PASSWORD to mint one")
    try:
        token = mint_token()
    except Exception as exc:                            # never echo the password
        sys.exit(f"could not mint an authToken from PGR_USERNAME/PGR_PASSWORD: {exc}")

d_start = datetime.date.fromisoformat(start)
d_end = datetime.date.fromisoformat(end)
FROM = int(datetime.datetime.combine(d_start, datetime.time()).replace(tzinfo=ZONE).timestamp() * 1000)
TO = int(datetime.datetime.combine(d_end + datetime.timedelta(days=1), datetime.time()).replace(tzinfo=ZONE).timestamp() * 1000)
week_no = (f"W{(d_start - W1_START).days // 7 + 1}" if W1_START
           else f"W{d_start.isocalendar()[1]}")

filed = {"created_at": {"gte": FROM, "lt": TO}}
resolved = {"resolved_at": {"gte": FROM, "lt": TO}, "is_resolved": True}

QUERIES = {
    "filed_by_source":  {"grain": "facts", "dimensions": ["source"],
                         "measures": [{"name": "n", "agg": "count"}], "filters": filed},
    "solved":           {"grain": "facts", "measures": [{"name": "n", "agg": "count"}], "filters": resolved},
    # event-dated: the transition happened inside the week (facts has no rejection timestamp)
    "rejected_in_week": {"grain": "events", "measures": [{"name": "n", "agg": "count_distinct",
                                                          "column": "service_request_id"}],
                         "filters": {"entered_at": {"gte": FROM, "lt": TO}, "action": "REJECT"}},
    # backlog at week end, reconstructed from facts: created before TO, minus those already closed
    "backlog":          {"grain": "facts",
                         "measures": [{"name": "created_before", "agg": "count",
                                       "filter": {"created_at": {"lt": TO}}},
                                      {"name": "resolved_before", "agg": "count",
                                       "filter": {"resolved_at": {"lt": TO}}}]},
    "rejected_before":  {"grain": "events", "measures": [{"name": "n", "agg": "count_distinct",
                                                          "column": "service_request_id"}],
                         "filters": {"entered_at": {"lt": TO}, "action": "REJECT"}},
    "open_now":         {"grain": "facts", "measures": [{"name": "n", "agg": "count"}], "filters": {"is_open": True}},
    "filed_still_open": {"grain": "facts", "measures": [{"name": "n", "agg": "count"}],
                         "filters": {**filed, "is_open": True}},
    "filed_total":      {"grain": "facts", "measures": [{"name": "n", "agg": "count"}], "filters": filed},
    "filed_assigned":   {"grain": "facts", "measures": [{"name": "n", "agg": "count"}],
                         "filters": {**filed, "assignment_count": {"gte": 1}}},
    # As of the week END, from the daily snapshot. On facts, is_open and
    # sla_breached describe the complaint NOW, so re-running an old week gives a
    # different answer once those complaints close.
    "beyond_sla":       {"grain": "daily", "measures": [{"name": "n", "agg": "count"}],
                         "filters": {"snapshot_date": end, "is_open": True, "sla_breached": True}},
    # Did a snapshot exist for that day at all? Without this, a week predating
    # the snapshot table reports 0 breached rather than "not measured".
    "snapshot_taken":   {"grain": "daily", "measures": [{"name": "n", "agg": "count"}],
                         "filters": {"snapshot_date": end}},
    # The snapshot IS the end-of-day active set. Preferred over reconstructing
    # it from cumulative totals, which double-subtracts a complaint that was
    # rejected and then reopened.
    "open_at_end":      {"grain": "daily", "measures": [{"name": "n", "agg": "count"}],
                         "filters": {"snapshot_date": end, "is_open": True}},
    "sla":              {"grain": "facts",
                         "measures": [{"name": "on_time", "agg": "count", "filter": {"sla_breached": False}}],
                         "filters": resolved},
    "avg_resolution":   {"grain": "facts", "measures": [{"name": "ms", "agg": "avg", "column": "resolution_ms"}],
                         "filters": resolved},
    # facts.time_to_assign_ms is the FIRST assignment, one value per complaint.
    # Averaging events.complaint_age_at_event_ms instead would fold in every
    # reassignment and overstate the time to first action. Scoped by created_at
    # because first_assigned_at is not filterable on this grain, so this reads
    # "complaints filed this week, and how long until someone picked them up".
    "first_action":     {"grain": "facts",
                         "measures": [{"name": "n", "agg": "count"},
                                      {"name": "ms", "agg": "avg", "column": "time_to_assign_ms"}],
                         "filters": {**filed, "assignment_count": {"gte": 1}}},
    "reopened_in_week": {"grain": "events", "measures": [{"name": "n", "agg": "count_distinct",
                                                          "column": "service_request_id"}],
                         "filters": {"entered_at": {"gte": FROM, "lt": TO}, "is_reopen": True}},
    "csat":             {"grain": "facts",
                         "measures": [{"name": "avg_rating", "agg": "avg", "column": "rating"},
                                      {"name": "responses", "agg": "count"}],
                         "filters": {**resolved, "has_rating": True}},
}

# ---------------------------------------------------------------- Matomo (optional)
# Set MATOMO_URL + MATOMO_TOKEN to fill the web-analytics columns. Site defaults to 1.
# Matomo 5 refuses token_auth on GET, so every call is a POST.
MAT_URL, MAT_TOKEN = os.environ.get("MATOMO_URL"), os.environ.get("MATOMO_TOKEN")
MAT_SITE = os.environ.get("MATOMO_SITE_ID", "1")
matomo = {}


def mat(method, **extra):
    # period=range with both dates: period=week would report whichever week
    # contains `date` and ignore `end`, so an unaligned window would measure a
    # different interval from the PGR, Postgres and nginx figures.
    params = {"module": "API", "method": method, "idSite": MAT_SITE, "period": "range",
              "date": f"{start},{end}", "format": "JSON", "token_auth": MAT_TOKEN, **extra}
    req = urllib.request.Request(MAT_URL, data=urllib.parse.urlencode(params).encode())
    if HOST_HEADER:
        req.add_header("Host", HOST_HEADER)
    payload = json.loads(urllib.request.urlopen(req, timeout=60).read())
    # Matomo reports failures as 200 + {"result": "error"}; accepting that as a
    # report makes later code iterate its keys as if they were rows.
    if isinstance(payload, dict) and payload.get("result") == "error":
        raise RuntimeError(f'Matomo {method}: {payload.get("message", "error")}')
    return payload


def mat_pages(page_size=500, max_pages=40):
    """Every flat page-URL row, fetched in pages.

    A truncated list is indistinguishable from "that route had no visits", so
    form_started() and error_page_views() would report 0 for any route beyond
    the cut-off. max_pages bounds a site with an unbounded URL space.
    """
    collected, offset, truncated = [], 0, True
    for _ in range(max_pages):
        batch = mat("Actions.getPageUrls", flat="1",
                    filter_limit=str(page_size), filter_offset=str(offset))
        if not isinstance(batch, list):
            raise RuntimeError(f"Matomo page list: expected a list, got {type(batch).__name__}")
        # An empty batch is the normal end of the report -- on an empty site,
        # and after an exact multiple of page_size. Only running out of
        # iterations means the list was actually cut short.
        if not batch:
            truncated = False
            break
        collected += batch
        if len(batch) < page_size:
            truncated = False
            break
        offset += page_size
    if truncated:
        # Exhausted the cap: a route past the cut-off is unanswerable, and
        # reporting 0 visits for it would be a guess.
        raise RuntimeError(f"Matomo page list exceeded {max_pages * page_size} rows")
    return collected


def page_visits(*needles):
    """Visits for the first flat page-URL row whose label/url contains any needle."""
    for row in matomo.get("pages", []):
        haystack = (row.get("label", "") + " " + row.get("url", "")).lower()
        if any(n in haystack for n in needles):
            return row.get("nb_visits", 0)
    return NA


if MAT_URL and MAT_TOKEN:
    try:
        matomo["all"] = mat("VisitsSummary.get")
        matomo["employee"] = mat("VisitsSummary.get", segment="pageUrl=@/employee")
        matomo["citizen"] = mat("VisitsSummary.get", segment="pageUrl=@/citizen")
        matomo["pages"] = mat_pages()
    except Exception as exc:                                   # never let Matomo blank the PGR half
        print(f"# Matomo unavailable: {exc}", file=sys.stderr)
        matomo = {}

if "--matomo-pages" in sys.argv:
    for row in matomo.get("pages", []):
        print(f'{row.get("nb_visits"):>6}  {row.get("label")}')
    sys.exit(0)

def mins(sec):
    return round(sec / 60, 1) if sec else NA


site, emp = matomo.get("all") or {}, matomo.get("employee") or {}
cit = matomo.get("citizen") or {}

body = {"RequestInfo": {"apiId": "Rainmaker", "ver": ".01", "action": "", "authToken": token},
        "tenantId": tenant, "queries": QUERIES}
headers = {"Content-Type": "application/json"}
if HOST_HEADER:
    headers["Host"] = HOST_HEADER
req = urllib.request.Request(f"{base}/pgr-services/v2/analytics/_query",
                             data=json.dumps(body).encode(), headers=headers)
try:
    res = json.loads(urllib.request.urlopen(req, timeout=60).read())
except Exception as exc:                                        # unreachable PGR -> "-" columns, not a crash
    print(f"# PGR unavailable: {exc}", file=sys.stderr)
    res = {}
if "--raw" in sys.argv:
    print(json.dumps(res, indent=1, ensure_ascii=False), file=sys.stderr)


def rows(key):
    block = (res.get("results") or res).get(key) or {}
    return block.get("rows") or block.get("data") or []


PGR_MISS = 0 if res else NA                # unreachable PGR -> "-", reachable-but-zero -> 0


def query_failed(key):
    """True when the batch answered but THIS named query errored.

    The API reports that as partial:true with an {"error": ...} block, leaving
    the rest of the response intact — so an empty row list here means "failed",
    not "zero".
    """
    block = (res.get("results") or res).get(key)
    return isinstance(block, dict) and block.get("error") is not None


def val(key, col, default=None):
    default = PGR_MISS if default is None else default
    if query_failed(key):
        return NA
    r = rows(key)
    if not r:
        return default
    row = r[0]
    return (row.get(col) if isinstance(row, dict) else row[0]) or default


by_source = {r.get("source"): r.get("n") for r in rows("filed_by_source")}


def filed_via(source):
    """Complaints filed through one channel; NA when PGR itself was unreachable."""
    return by_source.get(source, 0) if res else NA
def hours(ms):
    return round(ms / 3600000, 1) if isinstance(ms, (int, float)) else NA


csat = val("csat", "avg_rating")
_acted = val("first_action", "n")
first_action = (f'{hours(val("first_action", "ms"))}   ({_acted} of those filed this week)'
                if isinstance(_acted, (int, float)) and _acted else NA)
# A day with no snapshot cannot answer the question; 0 would be a false zero.
_snapshot = val("snapshot_taken", "n")
# NA is a string and therefore truthy -- test the type, not the value.
_have_snapshot = isinstance(_snapshot, (int, float)) and _snapshot > 0
beyond_sla = val("beyond_sla", "n") if _have_snapshot else NA
_bk = [val("backlog", "created_before"), val("backlog", "resolved_before"), val("rejected_before", "n")]
_reconstructed = _bk[0] - _bk[1] - _bk[2] if all(isinstance(x, (int, float)) for x in _bk) else NA
# Prefer the snapshot; fall back to the reconstruction, which is approximate —
# a complaint rejected before TO and later reopened is subtracted even though
# it is active again.
backlog_end = val("open_at_end", "n") if _have_snapshot else _reconstructed

# ---------------------------------------------------------------- Postgres (optional)
# Set PG_CONTAINER to the platform Postgres container; queries run via `docker exec psql`.
# Unset -> auth/OTP columns stay "-". PG_USER/PG_DB default to postgres.
PG_CONTAINER = os.environ.get("PG_CONTAINER")
PG_USER = os.environ.get("PG_USER", "postgres")
PG_DB = os.environ.get("PG_DB", "postgres")


def pg(sql, **params):
    """Single scalar from the platform DB via docker exec psql; NA if unreachable.

    Values go in as psql variables and are referenced :'like_this', so psql
    quotes them as literals. Never interpolate a value into `sql` -- the dates
    come from argv.

    The statement goes in on stdin, not via -c: psql substitutes variables in
    input it reads, but -c hands the string straight to the server, which
    rejects the :'name' syntax.
    """
    if not PG_CONTAINER:
        return NA
    argv = ["docker", "exec", "-i", PG_CONTAINER, "psql", "-U", PG_USER, "-d", PG_DB]
    for key, value in params.items():
        argv += ["-v", f"{key}={value}"]
    try:
        out = subprocess.run(argv + ["-tA"], input=sql,
                             capture_output=True, text=True, timeout=60, check=True).stdout.strip()
        return int(out) if out else 0
    except Exception as exc:                                    # never let PG blank the rest
        print(f"# Postgres unavailable: {exc}", file=sys.stderr)
        return NA


# These tables are shared by every tenant on the box. Unscoped, the counts
# silently include other deployments. Matched as a prefix because DIGIT tenants
# are hierarchical: TENANT_ID=pg must also cover pg.citya.
TENANT_SCOPE = "(:'tenant' = '' OR {col} = :'tenant' OR {col} LIKE :'tenant' || '.%')"


def failed_logins(user_type):
    return pg("SELECT count(*) FROM eg_user_login_failed_attempts f "
              "JOIN eg_user u ON u.uuid = f.user_uuid "
              "WHERE f.attempt_date >= :'t0' AND f.attempt_date < :'t1' "
              "AND u.type = :'utype' AND " + TENANT_SCOPE.format(col="u.tenantid"),
              t0=FROM, t1=TO, utype=user_type, tenant=tenant)


failed_citizen = failed_logins("CITIZEN")
failed_employee = failed_logins("EMPLOYEE")
# every FE registration goes through OTP, so this gives a floor for the OTP volume
registrations = pg("SELECT count(*) FROM eg_user WHERE type = 'CITIZEN' "
                   "AND createddate >= :'from_date' AND createddate < :'to_date' "
                   "AND " + TENANT_SCOPE.format(col="tenantid"),
                   from_date=d_start.isoformat(),
                   to_date=(d_end + datetime.timedelta(days=1)).isoformat(), tenant=tenant)
def nb_count(where):
    """SENT dispatches in the week matching a channel/type predicate; NA if PG unreachable.

    `where` is a literal fragment written in this file, never user input.
    """
    return pg("SELECT count(*) FROM nb_dispatch_log WHERE status = 'SENT' "
              "AND created_time >= :'t0' AND created_time < :'t1' "
              "AND " + TENANT_SCOPE.format(col="tenant_id") + " AND " + where,
              t0=FROM, t1=TO, tenant=tenant)


_otp = "(lower(event_name) LIKE '%otp%' OR lower(coalesce(template_key, '')) LIKE '%otp%')"
otp_sms_sent = nb_count(f"channel = 'SMS' AND {_otp}")
# no OTP rows ever -> OTP isn't routed through novu-bridge here, so it's unmeasurable, not zero
if pg("SELECT count(*) FROM nb_dispatch_log WHERE "
      + TENANT_SCOPE.format(col="tenant_id") + " AND " + _otp, tenant=tenant) == 0:
    otp_sms_sent = NA
other_sms = nb_count(f"channel = 'SMS' AND NOT {_otp}")
whatsapp_notif = nb_count("channel = 'WHATSAPP'")
email_notif = nb_count("channel = 'EMAIL'")

# ------------------------------------------------------- nginx access logs (optional)
# Successful logins aren't in any table -> counted from nginx access logs (token 200s).
# Citizen vs employee is split by the referer (the digit-ui page the token call came from).
# Longer retention than Loki, but still logrotate-bounded: NA when logs don't reach week start.
NGINX_GLOB = os.environ.get("NGINX_ACCESS_GLOB", "/var/log/nginx/access.log*")
# The v2 SPA serves /citizen and /employee; older builds used /digit-ui/<role>.
# Matching only one silently reports zero logins on the other.
LOGIN_REFERERS = {
    "citizen": os.environ.get("CITIZEN_PATHS", "/digit-ui/citizen,/citizen").split(","),
    "employee": os.environ.get("EMPLOYEE_PATHS", "/digit-ui/employee,/employee").split(","),
}


def nginx_logins():
    """citizen/employee token 200s for the week; NA each if logs don't reach the week start."""
    counts, earliest = {"citizen": 0, "employee": 0}, None
    for path in glob.glob(NGINX_GLOB):
        opener = gzip.open if path.endswith(".gz") else open
        try:
            with opener(path, "rt", errors="replace") as fh:
                for line in fh:
                    try:
                        ts = datetime.datetime.strptime(
                            line.split("[", 1)[1].split("]", 1)[0], "%d/%b/%Y:%H:%M:%S %z")
                    except (IndexError, ValueError):
                        continue
                    ms = int(ts.timestamp() * 1000)
                    earliest = ms if earliest is None else min(earliest, ms)
                    if not (FROM <= ms < TO and "POST /user/oauth/token" in line
                            and '" 200 ' in line):
                        continue
                    for role, prefixes in LOGIN_REFERERS.items():
                        if any(p.strip() and p.strip() in line for p in prefixes):
                            counts[role] += 1
                            break
        except OSError:
            continue
    if earliest is None or earliest > FROM:
        return {role: NA for role in counts}
    return counts


_logins = nginx_logins()
successful_citizen, successful_employee = _logins["citizen"], _logins["employee"]

def error_page_views(needle):
    """error page actually displayed; absent-but-pages-loaded means a real 0."""
    n = page_visits(needle)
    return 0 if matomo.get("pages") and n == NA else n


error_pages = error_page_views("/citizen/error")
error_pages_emp = error_page_views("/employee/user/error")


def form_started(path):
    """visits to the create-complaint landing (exact path, not its sub-steps); 0 if none."""
    for row in matomo.get("pages", []):
        for field in (row.get("url"), row.get("label")):
            if field and field.lower().split("?")[0].rstrip("/").endswith(path):
                return row.get("nb_visits", 0)
    return 0 if matomo.get("pages") else NA


def abandonment(started, filed):
    """percent of started forms not filed; NA if we don't have a start count."""
    # Both sides must be real numbers. Treating an unknown filed count as 0
    # would report 100% abandonment for a week nobody measured.
    if not isinstance(started, (int, float)) or not started:
        return NA
    if not isinstance(filed, (int, float)):
        return NA
    return round(max(started - filed, 0) / started * 100, 1)


form_started_citizen = form_started("/citizen/pgr/create-complaint")
form_started_emp = form_started("/employee/pgr/create-complaint")
abandon_citizen = abandonment(form_started_citizen, filed_via("web"))
abandon_emp = abandonment(form_started_emp, filed_via("inperson"))

SHEETS = [
    ("Citizen", [
        ("Period", [("Week No.", week_no), ("Week Start", start), ("Week End", end)]),
        ("Unique Visits", [("Landing Page Visitors", page_visits("/landing")),
                           ("Tutorial Page Visitors", page_visits("tutorial", "manual"))]),
        ("Authentication", [("Successful Authentications", successful_citizen), ("Failed Authentications", failed_citizen),
                            ("OTP SMS Sent", otp_sms_sent), ("New Registrations", registrations)]),
        ("Citizen Journey", [("Avg Session Duration (min)", mins(cit.get("avg_time_on_site"))), ("Complaint Form Started", form_started_citizen),
                             ("Complaints Filed Online", filed_via("web")),
                             ("Form Abandonment Rate", abandon_citizen),
                             ("Citizen Satisfaction / 5", csat if csat else NA),
                             ("Survey Responses", val("csat", "responses"))]),
        ("Notifications", [("Other SMS Notifications", other_sms), ("WhatsApp Notifications", whatsapp_notif),
                           ("Email Notifications", email_notif)]),
        ("Reliability", [("Error Pages Displayed", error_pages), ("Citizen Facing Downtime (min)", NA),
                         ("Notes", NA)]),
    ]),
    ("Employee", [
        ("Period", [("Week No.", week_no), ("Week Start", start), ("Week End", end)]),
        ("Employee Usage", [("Successful Logins", successful_employee),
                            ("Failed Logins", failed_employee),
                            ("Unique Employee Visitors", emp.get("nb_uniq_visitors", NA)),
                            ("Dashboard Accesses", page_visits("dashboard")),
                            ("Avg Session Duration (min)", mins(emp.get("avg_time_on_site")))]),
        ("Reception", [("Complaint Form Started", form_started_emp),
                       ("Complaints Filed by Reception", filed_via("inperson")),
                       ("Form Abandonment Rate", abandon_emp)]),
        ("Case Processing", [("Complaints Solved", val("solved", "n")),
                             ("Complaints Rejected", val("rejected_in_week", "n")),
                             ("Complaints Under Processing", val("filed_still_open", "n")),
                             ("Resolved Within SLA", val("sla", "on_time")),
                             ("Active Cases Beyond SLA", beyond_sla),
                             ("Total Active Cases", backlog_end),
                             ("Avg Resolution Time (h)", hours(val("avg_resolution", "ms"))),
                             ("Avg Time to First Action (h)", first_action),
                             ("Reopened Complaints", val("reopened_in_week", "n"))]),
        ("Experience & Quality", [("Staff Satisfaction / 5", NA), ("Survey Responses", NA),
                                  ("Open P1 Defects", NA)]),
        ("Reliability", [("Email Notifications", email_notif), ("Error Pages Displayed", error_pages_emp),
                         ("Employee Facing Downtime (min)", NA), ("Notes", NA)]),
    ]),
]

print(f"# complaints: {base} (tenant {tenant})")
print(f'# web analytics: {"Matomo site " + MAT_SITE + " @ " + MAT_URL if matomo else "not configured"}')
print()

for sheet, bands in SHEETS:
    print(f"{sheet}:")
    for band, fields in bands:
        print(f"    {band}:")
        for label, value in fields:
            print(f"        {label + ':':<32} {value}")
    print()

SOURCES = {
    ("Period", "Week No."): "computed", ("Period", "Week Start"): "input", ("Period", "Week End"): "input",
    ("Unique Visits", "Landing Page Visitors"): "Matomo", ("Unique Visits", "Tutorial Page Visitors"): "Matomo",
    ("Authentication", "Successful Authentications"): "nginx access logs",
    ("Authentication", "Failed Authentications"): "Postgres (egov-user)",
    ("Authentication", "OTP SMS Sent"): "Postgres (novu-bridge dispatch log)",
    ("Authentication", "New Registrations"): "Postgres (egov-user)",
    ("Citizen Journey", "Avg Session Duration (min)"): "Matomo",
    ("Citizen Journey", "Complaint Form Started"): "Matomo",
    ("Citizen Journey", "Complaints Filed Online"): "PGR API",
    ("Citizen Journey", "Form Abandonment Rate"): "computed (Matomo+PGR)",
    ("Citizen Journey", "Citizen Satisfaction / 5"): "PGR API",
    ("Citizen Journey", "Survey Responses"): "PGR API",
    ("Notifications", "Other SMS Notifications"): "Postgres (novu-bridge)",
    ("Notifications", "WhatsApp Notifications"): "Postgres (novu-bridge)",
    ("Notifications", "Email Notifications"): "Postgres (novu-bridge)",
    ("Reliability", "Error Pages Displayed"): "Matomo",
    ("Reliability", "Citizen Facing Downtime (min)"): "gatus/Prometheus (n/a)",
    ("Reliability", "Employee Facing Downtime (min)"): "gatus/Prometheus (n/a)",
    ("Reliability", "Email Notifications"): "Postgres (novu-bridge)",
    ("Reliability", "Notes"): "manual",
    ("Employee Usage", "Successful Logins"): "nginx access logs",
    ("Employee Usage", "Failed Logins"): "Postgres (egov-user)",
    ("Employee Usage", "Unique Employee Visitors"): "Matomo",
    ("Employee Usage", "Dashboard Accesses"): "Matomo",
    ("Employee Usage", "Avg Session Duration (min)"): "Matomo",
    ("Reception", "Complaint Form Started"): "Matomo",
    ("Reception", "Complaints Filed by Reception"): "PGR API",
    ("Reception", "Form Abandonment Rate"): "computed (Matomo+PGR)",
    ("Case Processing", "Complaints Solved"): "PGR API",
    ("Case Processing", "Complaints Rejected"): "PGR API",
    ("Case Processing", "Complaints Under Processing"): "PGR API",
    ("Case Processing", "Resolved Within SLA"): "PGR API",
    ("Case Processing", "Active Cases Beyond SLA"): "PGR API",
    ("Case Processing", "Total Active Cases"): "PGR API",
    ("Case Processing", "Avg Resolution Time (h)"): "PGR API",
    ("Case Processing", "Avg Time to First Action (h)"): "PGR API",
    ("Case Processing", "Reopened Complaints"): "PGR API",
    ("Experience & Quality", "Staff Satisfaction / 5"): "none",
    ("Experience & Quality", "Survey Responses"): "none",
    ("Experience & Quality", "Open P1 Defects"): "none",
}

if "--csv" in sys.argv:
    i = sys.argv.index("--csv")
    outfile = (sys.argv[i + 1] if i + 1 < len(sys.argv) and not sys.argv[i + 1].startswith("-")
               else f"kpi-{start}_{end}.csv")
    with open(outfile, "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["sheet", "band", "metric", "value", "source", "week", "week_start", "week_end"])
        for sheet, bands in SHEETS:
            for band, fields in bands:
                for label, value in fields:
                    w.writerow([sheet, band, label, value, SOURCES.get((band, label), ""),
                                week_no, start, end])
    print(f"# wrote {outfile}", file=sys.stderr)

other = {k: v for k, v in by_source.items() if k not in ("web", "inperson")}
if other:
    print("Not represented in either sheet — filed via:",
          ", ".join(f"{k} {v}" for k, v in sorted(other.items())))
