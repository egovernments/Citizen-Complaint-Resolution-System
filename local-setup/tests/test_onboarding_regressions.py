#!/usr/bin/env python3
"""Live-stack regression suite for the tenant-onboarding failures hit during the
Maputo (mz / mz.maputo) bring-up on 2026-05-21.

Every test here maps to a concrete bug that reached a user that day. They run
against an already-deployed stack (not mocks) — point them at the box with env
vars and they assert the failure mode does not recur:

    BASE_URL        http://localhost          (host nginx / API edge)
    STATE_TENANT    mz                        (MCP bootstrap root / pgr state root)
    CITY_TENANT     mz.maputo                 (configurator targetTenant / UI tenant)
    UI_TENANT       <CITY_TENANT>             (where digit-ui reads localization)
    LOCALE          en_IN                     (LOCALE_DEFAULT_LOCALE_REGION)
    HIERARCHY_TYPE  ADMIN                     (PGR boundary hierarchy name)
    PGR_LOC_MODULE  rainmaker-common          (module the UI fetches on load)
    ADMIN_USER      ADMIN
    ADMIN_PASS      eGov@123
    OAUTH_CLIENT    egov-user-client:         (basic auth user:secret; secret empty)

Run:  pytest -v local-setup/tests/test_onboarding_regressions.py
"""
import base64
import os
import re

import pytest
import requests

BASE = os.environ.get("BASE_URL", "http://localhost").rstrip("/")
STATE = os.environ.get("STATE_TENANT", "mz")
CITY = os.environ.get("CITY_TENANT", "mz.maputo")
UI_TENANT = os.environ.get("UI_TENANT", CITY)
LOCALE = os.environ.get("LOCALE", "en_IN")
HIER_DEFAULT = os.environ.get("HIERARCHY_TYPE", "ADMIN")
LOC_MODULE = os.environ.get("PGR_LOC_MODULE", "rainmaker-common")
ADMIN_USER = os.environ.get("ADMIN_USER", "ADMIN")
ADMIN_PASS = os.environ.get("ADMIN_PASS", "eGov@123")
OAUTH_CLIENT = os.environ.get("OAUTH_CLIENT", "egov-user-client:")

TIMEOUT = 30


@pytest.fixture(scope="session")
def token():
    """ADMIN mints a token at the STATE tenant.

    Regression: on 2026-05-21 the deploy aborted at the `validate — public UI
    returns 200` gate, which sits BEFORE the `mcp-bootstrap` tasks, so the state
    tenant was never seeded and nothing downstream existed. A failure here means
    seeding never ran.
    """
    auth = base64.b64encode(OAUTH_CLIENT.encode()).decode()
    r = requests.post(
        f"{BASE}/user/oauth/token",
        headers={"Authorization": f"Basic {auth}",
                 "Content-Type": "application/x-www-form-urlencoded"},
        data={"username": ADMIN_USER, "password": ADMIN_PASS, "tenantId": STATE,
              "userType": "EMPLOYEE", "scope": "read", "grant_type": "password"},
        timeout=TIMEOUT,
    )
    assert r.status_code == 200, (
        f"ADMIN could not mint a token at '{STATE}' (HTTP {r.status_code}). "
        f"The tenant bootstrap (mcp-bootstrap) likely never ran. Body: {r.text[:300]}"
    )
    body = r.json()
    tok = body.get("access_token")
    assert tok, f"no access_token in oauth response: {body}"
    return tok, body.get("UserRequest", {})


def _ri(tok):
    return {"RequestInfo": {"apiId": "Rainmaker", "authToken": tok,
                            "msgId": "regression|en_IN"}}


def _mdms_search(tok, tenant, module, master):
    r = requests.post(
        f"{BASE}/mdms-v2/v1/_search",
        json={"RequestInfo": {"authToken": tok},
              "MdmsCriteria": {"tenantId": tenant,
                               "moduleDetails": [{"moduleName": module,
                                                  "masterDetails": [{"name": master}]}]}},
        timeout=TIMEOUT,
    )
    r.raise_for_status()
    return r.json()


def test_tenant_bootstrapped(token):
    """Seeding ran: ADMIN exists at the state tenant (the `token` fixture proves it)."""
    tok, user = token
    assert tok


def _hierarchy_leaf_defs(res):
    """Leaf complaint types from a RAINMAKER-PGR.ComplaintHierarchy search result.

    ComplaintHierarchy is one adjacency list holding interior nodes AND leaf
    complaint types. A row is a LEAF iff it carries `department` or `slaHours`
    (interior nodes omit both). A leaf's `code` IS the serviceCode stored on a
    complaint, verbatim.
    """
    rows = (res.get("MdmsRes", {}).get("RAINMAKER-PGR", {}) or {}).get(
        "ComplaintHierarchy", []
    )
    return [r for r in rows if "department" in r or "slaHours" in r]


def test_servicedefs_resolve_at_state_root(token):
    """PGR validates complaint types at the COMPUTED STATE ROOT, not the city.

    Regression (colecta_lixo JSONPATH_ERROR): the configurator wrote the complaint
    types only at the city (mz.maputo); pgr-services resolves them at the state
    root (mz) and found nothing -> `Failed to parse mdms response for service`.
    The ComplaintHierarchy leaf rows must be readable at the state root.
    """
    tok, _ = token
    res = _mdms_search(tok, STATE, "RAINMAKER-PGR", "ComplaintHierarchy")
    defs = _hierarchy_leaf_defs(res)
    assert defs, (
        f"no RAINMAKER-PGR.ComplaintHierarchy leaf rows at the state root '{STATE}'. "
        f"pgr-services resolves complaint types at the state root, so complaint "
        f"create will fail JSONPATH_ERROR. Seed the complaint types at '{STATE}', "
        f"not just '{CITY}'."
    )


def test_complaint_create_passes_servicedef_validation(token):
    """Creating a complaint must get PAST the ServiceDef lookup (no JSONPATH_ERROR).

    Regression: a citizen filing `colecta_lixo` got
    `{code: JSONPATH_ERROR, message: Failed to parse mdms response for service: colecta_lixo}`.
    We pick a real serviceCode from the root and assert the create does not fail
    on the ServiceDef parse (it may fail later for unrelated reasons; that's fine).

    Opt-in: this writes a real complaint, so it's skipped unless
    RUN_COMPLAINT_CREATE_SMOKE is set (don't pollute a live tenant every CI run).
    """
    if not os.environ.get("RUN_COMPLAINT_CREATE_SMOKE"):
        pytest.skip("create-smoke is opt-in (writes a real complaint); "
                    "set RUN_COMPLAINT_CREATE_SMOKE=1 to run")
    tok, user = token
    res = _mdms_search(tok, STATE, "RAINMAKER-PGR", "ComplaintHierarchy")
    defs = _hierarchy_leaf_defs(res)
    if not defs:
        pytest.skip("no ComplaintHierarchy leaf rows at the state root (covered by the dedicated test)")
    service_code = defs[0].get("code")
    payload = _ri(tok)
    payload["RequestInfo"]["userInfo"] = user
    payload["service"] = {
        "active": True, "tenantId": CITY, "serviceCode": service_code,
        "description": "onboarding regression smoke", "source": "web",
        "citizen": {"name": "Regression Smoke", "mobileNumber": "812345678",
                    "type": "CITIZEN", "tenantId": CITY,
                    "roles": [{"code": "CITIZEN", "name": "Citizen", "tenantId": CITY}]},
        "address": {"tenantId": CITY},
    }
    payload["workflow"] = {"action": "APPLY", "verificationDocuments": []}
    r = requests.post(f"{BASE}/pgr-services/v2/request/_create", json=payload, timeout=TIMEOUT)
    blob = r.text
    assert "JSONPATH_ERROR" not in blob and "Failed to parse mdms response" not in blob, (
        f"complaint create for serviceCode='{service_code}' failed the ServiceDef "
        f"lookup — the def is missing at the state root '{STATE}'. Response: {blob[:400]}"
    )


def _effective_hierarchy_type():
    """The hierarchyType the PGR UI actually queries with: globalConfigs HIERARCHY_TYPE,
    else the module's hardcoded 'ADMIN' fallback."""
    try:
        gc = requests.get(f"{BASE}/digit-ui/globalConfigs.js", timeout=TIMEOUT).text
    except requests.RequestException:
        return HIER_DEFAULT
    m = re.search(r'HIERARCHY_TYPE["\']\s*\)\s*return\s+(\w+)', gc)
    if m:
        var = m.group(1)
        vm = re.search(rf'var\s+{var}\s*=\s*["\']([^"\']+)["\']', gc)
        if vm:
            return vm.group(1)
    return HIER_DEFAULT


def test_boundary_picker_resolves(token):
    """The citizen complaint location picker must find a boundary tree.

    Regression (empty dropdowns "post map"): the PGR module queries
    `boundary-relationships/_search?...&hierarchyType=<X>` where X =
    globalConfigs.HIERARCHY_TYPE || 'ADMIN'. The onboarded hierarchy was named
    something else, so the search returned nothing and the dropdowns were empty.
    The hierarchy the UI asks for must exist and resolve.
    """
    tok, _ = token
    hier = _effective_hierarchy_type()

    hdef = requests.post(
        f"{BASE}/boundary-service/boundary-hierarchy-definition/_search",
        json={"RequestInfo": {"authToken": tok},
              "BoundaryTypeHierarchySearchCriteria": {"tenantId": CITY, "hierarchyType": hier}},
        timeout=TIMEOUT,
    )
    hdef.raise_for_status()
    hierarchies = hdef.json().get("BoundaryHierarchy", [])
    assert hierarchies, (
        f"no boundary hierarchy named '{hier}' at '{CITY}'. The PGR picker queries "
        f"hierarchyType='{hier}' (globalConfigs HIERARCHY_TYPE or the 'ADMIN' "
        f"fallback); if the onboarded hierarchy has a different name the dropdowns "
        f"come up empty. Name the hierarchy '{hier}' or set HIERARCHY_TYPE in globalConfigs."
    )
    levels = [b.get("boundaryType") for b in hierarchies[0].get("boundaryHierarchy", [])]
    assert levels, f"hierarchy '{hier}' has no levels"

    rel = requests.post(
        f"{BASE}/boundary-service/boundary-relationships/_search"
        f"?tenantId={CITY}&hierarchyType={hier}&boundaryType={levels[0]}&includeChildren=true",
        json={"RequestInfo": {"authToken": tok}}, timeout=TIMEOUT,
    )
    rel.raise_for_status()
    tb = rel.json().get("TenantBoundary", [])
    boundaries = [b for h in tb for b in h.get("boundary", [])]
    assert boundaries, (
        f"boundary-relationships search returned no boundaries for "
        f"hierarchyType='{hier}' at '{CITY}' — picker dropdowns will be empty."
    )


def test_localization_resolves_for_ui_request(token):
    """The UI's localization fetch must return messages (else labels are raw keys).

    Regression (EN labels not showing): localization existed in the DB but the
    `/localization/messages/v1/_search` for (UI tenant, en_IN, rainmaker-common)
    came back empty — a stale/empty redis `messages` cache that survived an
    egov-localization restart. The API must return what the DB holds.
    """
    tok, _ = token
    r = requests.post(
        f"{BASE}/localization/messages/v1/_search"
        f"?tenantId={UI_TENANT}&locale={LOCALE}&module={LOC_MODULE}",
        json={"RequestInfo": {"authToken": tok}}, timeout=TIMEOUT,
    )
    r.raise_for_status()
    msgs = r.json().get("messages", [])
    assert msgs, (
        f"localization empty for tenant='{UI_TENANT}' locale='{LOCALE}' "
        f"module='{LOC_MODULE}' — the UI will render raw keys. Check the locale/"
        f"tenant the UI requests, and bust the redis cache: "
        f"`docker exec digit-redis redis-cli DEL messages`."
    )


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-v"]))
