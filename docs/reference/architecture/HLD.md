# Config Service HLD

## Why a Dedicated Config Service (instead of only MDMS-v2)

This section answers a common architecture question: "Why can’t we just use MDMS-v2 for configuration?"

### Short answer

If requirements are limited to storing and searching records, MDMS-v2 can be sufficient.
A dedicated Config Service is needed when configuration is part of runtime decision-making and must be deterministic, fast, and operationally predictable.

### Core justification

1. Runtime contract mismatch
- MDMS-v2 is primarily optimized for browse/search style access.
- Runtime consumers often need a **single best-match** record, not a list.
- Best-match resolution is a product behavior contract, not just a data query.

2. Deterministic precedence must be centralized
- Runtime config selection usually depends on precedence (for example tenant/locale specificity and wildcard fallback).
- If each consumer implements precedence locally, behavior drifts across services.
- A central resolver keeps behavior consistent, testable, and auditable.

3. Performance model is different
- Runtime resolution should be index-backed and return in predictable latency.
- List-and-filter patterns (especially client-side filtering) degrade at scale.
- A purpose-built resolve query with strict ordering and indexes is operationally safer.

4. Synchronous operational guarantees
- Runtime operations often need immediate read-after-write consistency.
- A synchronous write path avoids eventual-consistency surprises in production operations.
- This improves debuggability and reduces cross-service timing issues.

5. Domain semantics should be explicit
- Runtime configuration includes semantic selector keys, fallback behavior, and deterministic tie-breakers.
- Treating these as generic master rows can hide behavior-critical semantics.
- A Config Service makes these semantics explicit in API and data model.

6. Clear separation of concerns
- MDMS-v2 remains useful for schema governance and master-data capabilities.
- Config Service focuses on runtime-safe config CRUD/search/resolve semantics.
- This separation reduces accidental coupling while allowing independent evolution.

## Recommended architectural split

1. Use MDMS schema APIs for schema definition and governance.
2. Use Config Service for:
- synchronous config entry create/update/search
- deterministic resolve API
- precedence/fallback contract enforcement
- runtime-focused indexing and performance

## Decision rule for teams

A dedicated Config Service is justified when all are true:
- runtime consumers need deterministic single-record resolution,
- precedence/fallback logic must be uniform across consumers,
- latency and operational predictability are important,
- synchronous consistency is preferred for config updates.

If these are not required, MDMS-v2 alone may be enough.
