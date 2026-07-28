# Field-Level Attribute Access Control — Design

**Author:** Vinoth Rallapalli · **Date:** 2026-07-07 · **Status:** Proposal — share plan before implementing (per request)
**Scope:** `egov-accesscontrol` (`Action.resource` schema), `pgr-services` (new field-masking enforcement point)
**Builds on:** [`accesscontrol-policy-conditions-design.md`](accesscontrol-policy-conditions-design.md) — reuses the same `Action` record, the same JsonLogic engine (`PolicyEvaluator`), and the same `user`/`resource` input-document contract already implemented and verified live for `/pgr-services/v2/request/_search`.

---

## 1. Problem

Today's access-control work (see the companion doc) answers **"can this role see this complaint at all?"** — a record-level allow/deny. It says nothing about **"which fields of a complaint this role is allowed to see."** Concretely: a GRO or LME should not see a citizen's `mobileNumber` when browsing complaints, but the citizen themselves (viewing their own complaint) and a tenant-wide admin should. This must generalize to *any* field, not just `mobileNumber`, and adding a new field/role rule must be a config change, not a code change.

## 2. What already exists (and why it doesn't cover this)

`pgr-services` has exactly one field-masking mechanism today: `EncryptionDecryptionService` + `ComplaintTemplateTypeConfig.allowedViewerRoles` + `PGRService.applyDecryptOrMask`. It:
- Is **all-or-nothing** — when a complaint is confidential and the caller isn't an allowed viewer, `maskAll()` wipes *every* `extendedAttributes` dynamic field to `"****"`. There is no per-field distinction.
- Only reaches `extendedAttributes` (category-specific dynamic fields) — it has no path to `Service.citizen.mobileNumber`, which is a fixed field populated from `egov-user`, not part of `extendedAttributes`.
- Is tied to real encryption/decryption via `egov-enc-service` — a different, heavier mechanism than "mask a plaintext field for display."

There's also a telling dead end: MDMS's `ComplaintSchema.fields[]` already carries a `"pii": true/false` flag per field, but `ComplaintTemplateTypeConfig.FieldDefinition` never mapped it — Jackson silently drops it. Nobody wired this up; it's not a working mechanism today.

**Conclusion:** this needs a new, generalized mechanism — not a tweak to `applyDecryptOrMask`. The `extendedAttributes` confidentiality mechanism stays as-is (it does real crypto, a different concern); this is additive.

## 3. Prior art

- **DIGIT's own documented pattern** (platform docs, not this repo): a `DataSecurity` MDMS module (`SecurityPolicy` + `MaskingPatterns` masters) with a `roleBasedDecryptionPolicy` mapping role → per-attribute visibility (`PLAIN` / `MASKED` / `NONE`), enforced at decrypt/serialize time, driven entirely by MDMS data (no redeploy for a new field or role).
- **Industry comparison** (Hasura column permissions, GraphQL field directives, OPA/Rego field masking, Jackson `@JsonView`): the annotation/DTO-per-role approaches are simple but require a code change + redeploy per field or role; the declarative/config-driven approaches (Hasura, OPA, DIGIT's own model) push that into data instead — and that's the axis the user asked for ("extendible and easy to configure").

This design follows the declarative-config direction, but instead of standing up a parallel policy framework, it **reuses the JsonLogic engine and `Action` record already built and verified live** in this codebase, per explicit direction: extend the existing `Action.resource` field rather than adding a new field or a new MDMS master.

## 4. Design

### 4.1 `Action.resource` becomes structured (was: flat list of resource-type strings)

Today (`egov-accesscontrol`, `ACCESSCONTROL-ACTIONS-TEST.actions-test`, action id 2008):
```jsonc
"resource": ["complaint"]
```

New shape — `resource` becomes a **JSON object** keyed by resource type, each optionally carrying an `attributes` object (itself keyed by field path) so any number (N) of per-field visibility rules can be declared without arrays:
```jsonc
"resource": {
  "complaint": {
    "attributes": {
      "citizen.mobileNumber": {
        "condition": {
          "or": [
            { "==": [ { "var": "user.attributes.tenantWide" }, true ] },
            { "==": [ { "var": "resource.complaint.accountId" }, { "var": "user.uuid" } ] }
          ]
        },
        "onDeny": { "strategy": "MASK_SHOW_LAST_N", "n": 2, "maskChar": "X" }
      }
    }
  }
}
```
- `condition` evaluates to **true = field visible as-is**, **false = apply `onDeny`** — same JsonLogic contract, same `user`/`resource` input document already built by `SearchAccessPolicyService` for the record-level check. No new policy vocabulary.
- The `attributes` key is a JSON **object**, not an array — its keys ARE the field paths, so adding the Nth rule is adding one more key, and a duplicate path is structurally impossible (object keys are unique) rather than a data-quality risk to catch separately.
- Each field path is a Spring bean nested-property path evaluated against the root response object for that resource type (`Service` for `"complaint"`) — e.g. `citizen.mobileNumber` → `service.getCitizen().getMobileNumber()`.
- Backward compatible: `resource` entries in the old flat-string-array shape (`["complaint"]`) are treated as "resource type only, no attribute rules" — a no-op for field masking. Parsing must accept **both** shapes; this is genuinely still a "TEST" master, but other tenants' MDMS data may already have the old shape (e.g. the Nairobi config snapshot), so no forced migration is needed.
- Extraction and **validation of this structure happen in `pgr-services`** (the consuming service), not in `egov-accesscontrol` — accesscontrol stores/returns it as opaque JSON. A malformed entry (missing `condition`, unrecognized `onDeny.strategy`, wrong types) is logged and treated as fail-closed (mask) for that field, never silently ignored in a way that could leave the field exposed.

**`egov-accesscontrol` changes required:**
- `Action.java`: `resource` field type changes from `List<String>` to `Object` (untyped — mirrors how `condition` is already untyped; accesscontrol doesn't need to understand or validate the internal shape, it just stores/returns whatever JSON is there).
- `ActionRowMapper.java`, `ActionSearchRowMapper.java`, `ActionRepository.convertToAction` (MDMS parsing path), `ActionContract.java`: update the `resource` deserialization from `List<String>`-typed parsing to generic `Object` parsing (same pattern already used for `condition`).
- No DB migration change needed — the `resource` column is already `text` storing a raw JSON string; the new shape serializes into the same column type.

### 4.2 Fetch & cache (extend `AccessPolicyRegistry`, no new MDMS round trip)

`AccessPolicyRegistry` already fetches and caches the full action record (id 2008, `/pgr-services/v2/request/_search`) from `egov-accesscontrol`'s `/access/v1/actions/mdms/_get` for the record-level `condition`. Extend it to also expose the parsed `resource` attribute rules from the **same cached record** — no second fetch:
- `registry.getCondition(url, requestInfo, tenantId)` — existing, renamed for clarity now that there are two accessors.
- `registry.getFieldVisibilityRules(url, requestInfo, tenantId, resourceType)` — new; reads `action.get("resource")`, looks up the key matching `resourceType` (e.g. `"complaint"`), returns its `attributes` object as a validated `Map<String, FieldVisibilityRule>` keyed by field path (empty if the old flat-string shape, no match, or the entry fails validation).

### 4.3 Enforcement: new `FieldVisibilityService` in `org.egov.pgr.policy`

- For each `ServiceWrapper` in a result page: build the same `user`/`resource` input document already built for record-level enforcement (extract this into a small shared `PolicyInputBuilder` helper so `SearchAccessPolicyService` and `FieldVisibilityService` don't duplicate `buildUserDoc`/`buildResourceDoc`).
- For each attribute rule: evaluate `condition` via the existing `PolicyEvaluator`. If **false**, apply `onDeny` to the field at `path` using Spring's `BeanWrapperImpl` (`new BeanWrapperImpl(service).setPropertyValue(path, maskedValue)`) — handles nested bean paths natively, no reflection code of our own, works directly on the typed `Service`/`User` object graph (no JSON round-trip needed).
- Fail-closed consistent with the rest of this system: if the condition can't be evaluated (malformed rule, missing MDMS data), **mask** (never leave the field visible) — same principle as the record-level PDP.

### 4.4 Masking strategies — small built-in set, selected by name from MDMS

```java
enum MaskingStrategy {
    REDACT,            // field -> null
    MASK_SHOW_LAST_N   // field -> maskChar repeated, keeping the last `n` characters
}
```
- New field/role rules: pure MDMS data change (add an `attributes[]` entry) — no code, no redeploy.
- A genuinely new masking *shape* (rare — e.g. "show first N" for a different field type): one small addition to this enum + its handler, then reusable via config forever, same tradeoff DIGIT's own `MaskingPatterns` master makes.

### 4.5 Wiring point

`PGRService.search()` / `plainSearch()`, right after `applyDecryptOrMask(...)` (must run after `enrichUsers` so `citizen` is populated):
```java
fieldVisibilityService.apply(requestInfo, scope, "complaint", enrichedServiceWrappers);
```
`create()`/`update()` responses are **not** wired up — they echo back to the creating citizen, who always passes the "own record" condition; flagged as an explicit non-goal rather than silently skipped.

## 5. Example: the stated GRO/LME case

MDMS `ACCESSCONTROL-ACTIONS-TEST.actions-test` id 2008 `resource` gets one `attributes[]` entry (§4.1's example). No pgr-services code path needs to know about "GRO" or "LME" by name — the condition is purely `tenantWide OR own-record`, so *any* non-owning, non-tenant-wide role is masked automatically, including GRO/LME today and any future role tomorrow with zero code change.

## 6. Testing plan

- **Unit**: `FieldVisibilityService` — condition-true leaves field untouched; condition-false applies each `MaskingStrategy`; malformed rule fails closed (masks); old flat-string `resource` shape is a no-op.
- **Unit**: `AccessPolicyRegistry.getFieldVisibilityRules` — parses both `resource` shapes; per-(tenant, url) caching reused from the existing condition cache (same record, same TTL).
- **API-level** (extends the existing live test matrix): GRO/LME viewing another citizen's complaint → `mobileNumber` masked; the same GRO/LME viewing a complaint where they ARE the record's own citizen — not applicable for employees, but citizen-owner viewing own complaint → `mobileNumber` visible; tenant-wide role → visible.

## 7. Rollout

1. `egov-accesscontrol`: retype `Action.resource` to `Object`, ship — no behavior change (old data still round-trips; nothing yet reads it as structured attributes).
2. `pgr-services`: add `FieldVisibilityService` + `MaskingStrategy`, wire into `search()`/`plainSearch()` — with `resource` still in the old flat-string shape, this is a no-op (nothing masked, current behavior unchanged).
3. Update the MDMS action-test entry for id 2008 with the `mobileNumber` rule (§4.1) — this is the one step that actually turns masking on, purely a data change.
4. Verify live (per §6), fine-tune, then consider whether `extendedAttributes`' existing all-or-nothing mechanism should eventually be re-expressed as `attributes[]` rules too for consistency — explicitly out of scope for this pass.

## Open items

- `path` resolution assumes a Spring-bean-navigable object graph (works for `Service`/`User`); if a future resource type is JSON-shaped (`JsonNode`/`Map`) rather than a typed POJO, `BeanWrapperImpl` won't apply directly — would need a small `JsonNode`-path setter alongside it (same dual-shape problem already solved once for `additionalDetail` in the record-level work).
- Only `"complaint"` is wired up as a resource type in this pass; reuse for other resource types (e.g. an `"employee"` type for HRMS-backed views) is a config addition, not a code change, once a second call site adopts `FieldVisibilityService`.
