# Workflow Registry

Common tool call sequences, success patterns, and failure recovery paths.
Entries keyed by stable ID (W###). CURRENT entries describe working patterns; SUPERSEDED entries point to replacements.

## W004 — Standard session initialization
**Status:** CURRENT | **Discovered:** 2026-03-03

Sequence: configure → enable_tools → mdms_get_tenants

Reliable initialization pattern observed 9 times in session 7248e43f. Establishes configuration, activates toolset, and retrieves tenant context. Can be safely repeated within a session if context needs to be refreshed or reestablished.

Agent guidance: Use this triplet at session start and after any suspected configuration drift.

## W005 — PGR complaint creation with verification
**Status:** CURRENT | **Discovered:** 2026-03-03

Sequence: mdms_search (metadata lookup) → pgr_create → pgr_search (verification)

Pattern observed multiple times in session 7248e43f. After creating complaint, immediately search to verify creation and retrieve full complaint object with server-assigned fields. mdms_search may be repeated for different metadata modules.

Agent guidance: Always verify pgr_create success with immediate pgr_search using returned complaint ID.

## W006 — Validated complaint creation
**Status:** CURRENT | **Discovered:** 2026-03-03

Sequence: mdms_search → validate_boundary / validate_employees → pgr_create

Extended creation workflow with pre-flight validation. Lookup metadata, validate location/employees, then create complaint. Observed in session 7248e43f with no validation failures. Higher confidence of success compared to unvalidated creation.

Agent guidance: Use validation tools when location or employee assignment data comes from user input or external sources.

## W013 — Explore-before-auth anti-pattern (HTTP sessions)
**Status:** CURRENT | **Discovered:** 2026-03-03 (session c2923ec7)

Sequence: get_environment_info → mdms_get_tenants → mdms_get_tenants → configure → enable_tools → mdms_get_tenants → mdms_search

Agent explored environment and fetched tenant data before authenticating, then repeated mdms_get_tenants post-auth. The `init` tool was skipped entirely. Results in 3 redundant calls (2 pre-auth tenant fetches + 1 repeated post-auth). Contrast with W004 which authenticates first.

MCP improvement: After get_environment_info, if no auth token is present, the response should include a prominent directive: "Call configure next to authenticate before querying data."

Agent guidance: Follow W004 (configure first). Use get_environment_info only to check which environment is targeted, not to begin data exploration.
