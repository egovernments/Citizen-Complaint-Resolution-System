#!/usr/bin/env python3
"""
OPTIONAL: enrich run.json with Claude when ANTHROPIC_API_KEY is present.

- Writes a contextual "why it matters / how to fix" for each NON-curated rule
  (curated rules keep their vetted text - never overwritten).
- Writes an executive summary (management narrative + systemic correlation).
- Caches per-rule results in enrich-cache.json (pulled from gh-pages) so unchanged
  rules are not re-billed. No-ops silently if the key or SDK is missing, or on refusal.

Uses the official Anthropic Python SDK. Model defaults to claude-opus-5
(override with ANTHROPIC_MODEL). Env: RUN_JSON, CACHE_FILE, REPO.
"""
import os, sys, json, urllib.request

def log(*a):
    print(*a, file=sys.stderr)

def bail(msg):
    log(msg + " — skipping enrichment (non-fatal).")
    sys.exit(0)

if not os.environ.get("ANTHROPIC_API_KEY"):
    bail("No ANTHROPIC_API_KEY")
try:
    from anthropic import Anthropic
except Exception:
    bail("anthropic SDK not installed")

RUN = os.environ.get("RUN_JSON", "run.json")
CACHE = os.environ.get("CACHE_FILE", "enrich-cache.json")
REPO = os.environ.get("REPO", "")
MODEL = os.environ.get("ANTHROPIC_MODEL", "claude-opus-5")

run = json.load(open(RUN))
findings = run.get("findings", [])
if not findings:
    bail("No findings to enrich")

# load cache: local file, else gh-pages raw
cache = {}
if os.path.exists(CACHE):
    try: cache = json.load(open(CACHE))
    except Exception: cache = {}
elif REPO:
    try:
        u = f"https://raw.githubusercontent.com/{REPO}/gh-pages/{CACHE}"
        cache = json.loads(urllib.request.urlopen(u, timeout=10).read())
    except Exception as e:
        log("no remote cache:", e)

# unique rules
rules = {}
for f in findings:
    r = rules.setdefault(f["id"], {"id": f["id"], "title": f["title"], "severity": f["severity"],
                                   "area": f["area"], "count": 0, "curated": f.get("curated", False),
                                   "sample": (f["locations"][0]["path"] if f.get("locations") else "")})
    r["count"] += f["count"]
todo = [r for r in rules.values() if not r["curated"] and r["id"] not in cache]

catalogue = [{"id": r["id"], "title": r["title"], "severity": r["severity"], "count": r["count"]}
             for r in rules.values()]
prompt = (
    "You are a security engineer writing a remediation report for the Ansible + "
    "docker-compose deployment (setup path C: `./deploy.sh <tenant>`) of DIGIT/CMS, "
    "a public-sector complaint-management platform. The repository is PUBLIC.\n\n"
    "Write an `executive_summary` (3-4 sentences for management/PM): overall risk posture, "
    "the top SYSTEMIC themes (correlate related findings - e.g. isolation weaknesses that "
    "compound), and what to prioritize.\n\n"
    "Then, for EACH rule in `to_explain`, write:\n"
    "- `why`: 1-2 sentences on why this is a real security risk IN THIS deployment context.\n"
    "- `fix`: 1-2 sentences of concrete, actionable remediation (config/command level).\n\n"
    "Return ONLY minified JSON: "
    '{"executive_summary":"...","rules":[{"id":"...","why":"...","fix":"..."}]}\n\n'
    "Full finding catalogue (for summary context):\n" + json.dumps(catalogue) + "\n\n"
    "to_explain:\n" + json.dumps([{"id": r["id"], "title": r["title"], "severity": r["severity"],
                                   "area": r["area"], "sample": r["sample"]} for r in todo])
)

client = Anthropic()  # resolves ANTHROPIC_API_KEY / ant profile
def call():
    # opus-5: prefer server-side refusal fallback; fall back to plain create on older SDKs.
    try:
        return client.beta.messages.create(
            model=MODEL, max_tokens=16000, output_config={"effort": "low"},
            betas=["server-side-fallback-2026-07-01"], fallbacks="default",
            messages=[{"role": "user", "content": prompt}])
    except TypeError:
        return client.messages.create(
            model=MODEL, max_tokens=16000,
            messages=[{"role": "user", "content": prompt}])

try:
    resp = call()
except Exception as e:
    bail(f"API call failed: {e}")

if getattr(resp, "stop_reason", None) == "refusal":
    bail("model refused")

text = "".join(getattr(b, "text", "") for b in resp.content if getattr(b, "type", "") == "text")
try:
    data = json.loads(text[text.find("{"): text.rfind("}") + 1])
except Exception:
    bail("could not parse model JSON")

for r in data.get("rules", []):
    if r.get("id") and r.get("why") and r.get("fix"):
        cache[r["id"]] = {"why": r["why"], "fix": r["fix"]}

for f in findings:
    if f.get("curated"):
        continue
    c = cache.get(f["id"])
    if c:
        f["why"], f["fix"], f["enriched"] = c["why"], c["fix"], True

run["meta"]["executive_summary"] = data.get("executive_summary", "")
run["meta"]["enriched"] = True
json.dump(run, open(RUN, "w"), indent=1)
json.dump(cache, open(CACHE, "w"), indent=1)
log(f"enriched {len(todo)} new rule(s); cache now {len(cache)}; model {MODEL}")
