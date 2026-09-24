# Weekly M&E KPI extraction

`kpi-week.py` collects one week of monitoring-and-evaluation figures for a
CCRS/DIGIT deployment and prints them in the order of the tracking workbook,
optionally writing the same rows as CSV.

It reads from four places and none of them is this tool's own store: the PGR
analytics API for complaint figures, Matomo for web analytics, the platform
Postgres for authentication and notification counts, and nginx access logs for
successful logins. Only the PGR half is required. Anything the deployment does
not expose prints as `-` rather than a zero, because a missing measurement and
a real zero are different answers.

Pure standard library — Python 3.9 or newer, no packages to install.

## Getting Started

```
cp kpi.env.example kpi.env
chmod 600 kpi.env
$EDITOR kpi.env
python3 kpi-week.py 2026-09-14 2026-09-20
```

The two arguments are the week's first and last day, inclusive, as `YYYY-MM-DD`.
Add `--csv` to also write `kpi-<start>_<end>.csv`, or `--csv <file>` to choose
the name.

Values are read from the environment first, then from a `kpi.env` beside the
script. A real environment variable always wins, so a cron entry can override
the file without editing it. `kpi.env` holds credentials and is gitignored;
keep it that way.

### Configuration

Two settings are required, and deliberately have no defaults — a wrong default
would silently report another deployment's numbers.

| Variable | What it controls |
|---|---|
| `BASE_URL` | the deployment's base URL, e.g. `https://pgr.example.gov` |
| `TENANT_ID` | tenant the figures are scoped to |

Then one of: `AUTH_TOKEN` for a short-lived token pasted in by hand, or
`PGR_USERNAME` and `PGR_PASSWORD` for a service account the script mints its own
token from. Unattended runs need the second — a pasted token expires.

| Variable | What it controls |
|---|---|
| `TZ_NAME` | IANA zone deciding which local day a timestamp falls in (default `UTC`) |
| `WEEK1_START` | week 1 of a programme tracking sheet; unset, ISO week numbers are used |
| `MATOMO_URL`, `MATOMO_TOKEN`, `MATOMO_SITE_ID` | web-analytics columns; skipped entirely if unset |
| `PG_CONTAINER`, `PG_USER`, `PG_DB` | Postgres reached via `docker exec psql`; authentication and notification columns |
| `NGINX_ACCESS_GLOB` | access logs for successful-login counts (default `/var/log/nginx/access.log*`) |
| `PGR_USER_TYPE`, `OAUTH_CLIENT_ID`, `OAUTH_CLIENT_SECRET` | only if the deployment's OAuth differs from the DIGIT default |
| `HTTP_HOST_HEADER` | see below |

**Set `TZ_NAME`.** It decides which week a complaint filed near midnight belongs
to. Left at `UTC` on a deployment that is not, the boundaries drift by the
offset and the first and last day of every week are wrong at the edges.

### Running against a host with no public DNS

Point `BASE_URL` and `MATOMO_URL` at Kong or a container on the box, and set
`HTTP_HOST_HEADER` to the public domain so Kong still matches its route:

```
BASE_URL=http://localhost:8000
MATOMO_URL=http://localhost:8000/matomo/index.php
HTTP_HOST_HEADER=pgr.example.gov
```

### Weekly runs

`run-weekly.sh` computes the last complete Monday-to-Sunday window and writes a
CSV beside the script under `out/`. Paths resolve from the script's own
location, so the checkout can live anywhere:

```
0 6 * * 1  /path/to/kpi-week/run-weekly.sh >> /var/log/kpi-week.log 2>&1
```

It shells out to `python3` for the date arithmetic rather than `date -d`, which
is GNU-only and absent on BSD and macOS.

## What the columns come from

Every metric carries its source in the CSV's `source` column, so a number can
always be traced. The groupings:

- **PGR analytics API** — everything about complaints: filed, solved, rejected,
  reopened, backlog, SLA compliance, resolution times, CSAT.
- **Matomo** — visits, session durations, page-level counts, and the
  form-started counts that feed the abandonment rates.
- **Postgres** — failed authentications, new registrations, and notification
  dispatch counts per channel.
- **nginx access logs** — successful logins, which exist in no table. Split
  between citizen and employee by the referring page. Bounded by log rotation:
  if the logs no longer reach the week's start, this prints `-` rather than an
  undercount.

Three columns are permanently `-` because nothing in the platform produces
them: staff satisfaction, open P1 defects, and facing-downtime minutes. The
last would come from gatus or Prometheus, which this tool does not read.

OTP volume is `-` rather than `0` when no OTP rows exist at all, since that
means OTP is not routed through novu-bridge on that deployment — unmeasurable
rather than none.

## Debugging

| Flag | Effect |
|---|---|
| `--raw` | dump the PGR analytics response to stderr |
| `--matomo-pages` | list every Matomo page URL with its visit count, then exit |

`--matomo-pages` is the quickest way to find the right page path when a
form-started or error-page column reads `-`: the matching is substring-based,
and deployments name their routes differently.

An unreachable source never aborts the run. PGR, Matomo and Postgres failures
each print one line to stderr and leave their columns as `-`, so a partial
outage still produces the rest of the sheet.
