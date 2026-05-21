# API Registry

DIGIT API behaviors, parameters, and quirks discovered through agent sessions.
Entries keyed by stable ID (A###). ACTIVE entries have full detail; CHANGED/DEPRECATED entries are stubs pointing to graveyard.

## A004 — mdms_get_tenants repeated calls
**Status:** ACTIVE | **Discovered:** 2026-03-03 (session 7248e43f)

Observed pattern of 6-7 consecutive mdms_get_tenants calls without intervening operations. Likely indicates client-side retry logic, pagination handling, or tenant enumeration across hierarchy levels. All calls succeeded without errors even when repeated.

Agent guidance: If tenant data is stable within a session, cache the first response to avoid redundant calls.

## A005 — validate_boundary tool
**Status:** ACTIVE | **Discovered:** 2026-03-03 (session 7248e43f)

Validation tool for geographic/administrative boundaries. Appears 3 times in session alongside mdms_search. Used before pgr_create operations to verify location data. No errors observed across all invocations.

Agent guidance: Call validate_boundary after mdms_search and before pgr_create when location fields are involved.

## A006 — validate_employees tool
**Status:** ACTIVE | **Discovered:** 2026-03-03 (session 7248e43f)

Employee/user validation tool. Appears 3 times in workflow, typically after mdms_search operations. Used to verify employee assignments before complaint creation. No validation failures observed in session data.

Agent guidance: Use validate_employees to confirm employee availability before assigning to complaints.

## A013 — Pre-auth tool calls produce ambiguous results
**Status:** ACTIVE | **Discovered:** 2026-03-03 (session c2923ec7)

Session called mdms_get_tenants twice before configure (authentication) with 0 errors. In env-var-configured HTTP deployments, the API client may auto-authenticate silently, making the results valid but the subsequent explicit configure call redundant. If auto-auth did NOT occur, the tool returned empty/partial data without signaling an auth problem, causing the agent to retry post-auth.

MCP improvement: Tools requiring auth should return a clear `"authenticated": true/false` flag in responses, or return an explicit "not authenticated" error instead of silently proceeding.

Agent guidance: Always call configure before data-fetching tools unless get_environment_info confirms auto-authentication is active.
