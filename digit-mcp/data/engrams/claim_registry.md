# Claim Registry

Epistemic claims about DIGIT API behavior — what we believe, what's been refuted, what's contested.
Entries keyed by stable ID (C###). Each claim has an evidence chain from session data.

## C004 — Long-running sessions are stable
**Status:** CONFIRMED | **Claimed:** 2026-03-03 | **Confidence:** High

Session 7248e43f ran for 1083 minutes (~18 hours) with 98 tool calls and 0 errors. Suggests DIGIT API maintains connection stability and consistent behavior over extended durations without degradation or timeout issues.

Evidence: Session 7248e43f (HTTP transport, 98 tools, 0 errors, 1083min duration).

## C005 — Validation tools precede data mutations
**Status:** CONFIRMED | **Claimed:** 2026-03-03 | **Confidence:** Medium

validate_boundary and validate_employees appear in workflows before pgr_create operations. Pattern suggests pre-flight validation is standard practice for ensuring data integrity before complaint creation. No failures observed when validation is performed.

Evidence: Session 7248e43f shows validate_boundary (3×) and validate_employees (3×) preceding pgr_create calls.

## C006 — Session initialization is idempotent
**Status:** CONFIRMED | **Claimed:** 2026-03-03 | **Confidence:** High

The sequence configure → enable_tools → mdms_get_tenants appears 9 times across session 7248e43f without errors. Multiple reinitialization cycles within a single session are safe and do not cause state conflicts or errors.

Evidence: Session 7248e43f contains 9 instances of the initialization triplet with 0 errors.

## C013 — HTTP sessions bypass init tool without consequence
**Status:** PROVISIONAL | **Claimed:** 2026-03-03 | **Confidence:** Low

Session c2923ec7 (HTTP, 7 tools, 121min) never called `init`, instead starting with get_environment_info and manually calling enable_tools. Completed without errors. Suggests `init` is optional for HTTP sessions where the agent self-directs tool group enablement. However, skipping `init` means no purpose is recorded, no userName is set, and tool group selection is unguided — the agent must already know which groups it needs.

MCP improvement: For HTTP sessions, if `init` has not been called after the first 3 tool calls, inject a hint in tool responses suggesting `init` for better session tracking and guided tool discovery.

Evidence: Session c2923ec7 — 7 tools, 0 errors, no init call, no purpose or userName recorded.
