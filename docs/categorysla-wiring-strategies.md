# CategorySLA Wiring Strategies

How tenants get their complaints to resolve against the right `CRS.CategorySLA` row.

## Background

`CRS.CategorySLA` rows are keyed by the tuple `(path, category, subcategoryL1)`. The
escalation scheduler, when scanning open complaints, has to answer one question per
complaint:

> Which `(path, category, subcategoryL1)` does this complaint belong to?

The scheduler does not invent the answer. The COMPLAINT must somehow either **carry**
the tuple directly, or be **mappable** to it through some auxiliary lookup. Two
strategies are supported in v1; tenants pick one based on how much control they have
over their intake form.

If neither strategy is wired, the scheduler still works — it just falls back to
`CRS.StateSLA` per-state defaults (see [Fallback](#fallback-when-neither-is-wired)).

---

## Strategy A — Rich intake

The citizen intake form captures `path`, `category`, and `subcategoryL1` explicitly
as fields the citizen (or CSR agent) selects when filing the complaint. They get
written onto the complaint under `additionalDetail`. The scheduler reads them directly.

- **Best for**: new deployments designing the intake form from scratch, or deployments
  whose intake form is being rebuilt as part of a broader CRS rollout.
- **Schema work**: none beyond updating the intake-form config. The
  [Configurator roadmap](crs-configurator-roadmap.md) item **G8 (Submission Forms)**
  is what enables operators to build these forms without code changes.
- **Code path**: `extractCategoryTuple` reads
  `complaint.additionalDetail.{path, category, subcategoryL1}` first and short-circuits
  if all three are present.
- **Operator UX**: cleanest — operators viewing a complaint see the actual category
  fields on the complaint record itself. No indirection.

### Example complaint payload (Strategy A)

```json
{
  "serviceRequestId": "PG-2026-06-001234",
  "serviceCode": "WaterSupply.LowPressure",
  "tenantId": "ke.nairobi",
  "applicationStatus": "PENDINGASSIGNMENT",
  "additionalDetail": {
    "path": "Water",
    "category": "Supply",
    "subcategoryL1": "LowPressure"
  }
}
```

The three fields under `additionalDetail` are what the scheduler keys on. `serviceCode`
is still present and useful for other purposes (workflow routing, dashboards), but
plays no role in CategorySLA lookup under Strategy A.

---

## Strategy B — ServiceDefs extension

Existing complaints already carry `serviceCode`. Rather than rewriting the intake form
to add three new fields, the tenant extends their existing
`RAINMAKER-PGR.ServiceDefs` records to carry `path`, `category`, and `subcategoryL1`.
The scheduler builds a `serviceCode → tuple` map once per scan from ServiceDefs and
resolves each complaint through it.

- **Best for**: existing deployments with legacy intake forms that cannot easily be
  changed, but whose ServiceDefs catalog is already well-curated.
- **Schema work**: extend the `ServiceDefs` schema to allow the three additional
  fields, then bulk-update existing ServiceDefs records to populate them. One MDMS
  migration; no per-complaint backfill.
- **Code path**: when `additionalDetail` does not carry the tuple, `extractCategoryTuple`
  falls back to `serviceCodeToCategory[complaint.serviceCode]`.
- **Operator UX**: indirect — the category mapping lives in MDMS, not on the
  complaint. To understand why a given complaint resolved to a particular SLA,
  operators have to cross-reference its `serviceCode` against ServiceDefs.

### Example ServiceDefs record (Strategy B)

```json
{
  "serviceCode": "WaterSupply.LowPressure",
  "serviceName": "Low water pressure",
  "department": "DEPT_WATER",
  "path": "Water",
  "category": "Supply",
  "subcategoryL1": "LowPressure"
}
```

The bottom three fields are the Strategy-B extension. Existing consumers of
`ServiceDefs` ignore the unknown fields; the scheduler is the only thing that reads
them today.

---

## Comparison table

|                                | Strategy A (rich intake)               | Strategy B (ServiceDefs extension)            |
|--------------------------------|----------------------------------------|-----------------------------------------------|
| Complaint payload size         | larger (carries tuple)                 | unchanged                                     |
| Migration effort               | new intake form needed                 | one MDMS bulk update                          |
| Category change handling       | rewrites complaint (or accepts drift)  | takes effect on next scan (no complaint rewrite) |
| Audit clarity                  | tuple visible on the complaint         | tuple resolved at read time                   |
| Cross-tenant portability       | depends on intake schema               | depends on ServiceDefs schema                 |
| First-time setup cost          | high (form work)                       | low (one bulk update)                         |
| Ongoing maintenance            | per-form change                        | per-ServiceDef change                         |

---

## Fallback when neither is wired

If a complaint has no usable tuple from either strategy — `additionalDetail` missing
the fields AND its `serviceCode` not present in (or not extended by) ServiceDefs — the
scheduler:

1. Records the per-complaint skip reason `UNMAPPED_CATEGORY` against that srid.
2. Falls back to `CRS.StateSLA` per-state defaults for the breach calculation.
3. Continues escalating the complaint (escalation does not stop just because the
   category is unknown).

This means everyone gets the same SLA regardless of category — fine as a v1 safety net
so escalation does not silently stop, but not recommended long-term. The skip count
shows up in the scheduler's OTEL span as
`escalation.skipped.unmapped_category` and in `skipBreakdown` on the trigger response.

---

## Choosing for your tenant

A short decision tree:

- **The intake form is being redesigned anyway?** → **Strategy A**. You get the
  cleanest model and the most operator-friendly view, and you avoid an MDMS-side
  data-quality dependency.
- **ServiceDefs is already well-curated and stable, and intake-form changes are
  expensive?** → **Strategy B**. One MDMS bulk update gets the whole tenant onto
  category-aware SLAs without touching a single complaint.
- **Mixed legacy + new — old complaints with `serviceCode` only, new complaints
  with rich intake?** → **Strategy B now**, migrate to **Strategy A** as the intake
  form is rebuilt. The scheduler reads `additionalDetail` first, so once Strategy A
  is wired for new complaints, they automatically prefer it; old complaints continue
  to resolve through ServiceDefs.

You can also run both at once — `extractCategoryTuple` will use `additionalDetail`
when present and fall through to ServiceDefs otherwise.

---

## Operational tips

- **See which strategy fired for a specific complaint.** Run
  `POST /pgr-services/escalation/_trigger` with a single srid in the body and look at
  the `slaSource` attribute in the response. Values are `additionalDetail`,
  `serviceDefs`, or `stateSlaFallback`.
- **Trace-back drawer.** The SLA Matrix configurator's trace-back drawer (see
  [Configurator UI](escalation-feature-design.md#configurator-ui)) shows the same
  `slaSource` per complaint, alongside which `CategorySLA` row resolved.
- **Diagnosing `UNMAPPED_CATEGORY`.** If you see a non-zero
  `UNMAPPED_CATEGORY` count in `skipBreakdown`, for each affected srid:
  1. Check whether the complaint's `additionalDetail` has all three of `path`,
     `category`, `subcategoryL1` (Strategy A diagnosis).
  2. Check whether its `serviceCode` has a matching `ServiceDefs` record with the
     three extension fields populated (Strategy B diagnosis).
  3. If both fail, you are running on the StateSLA fallback for that complaint.
- **Watch for category drift under Strategy B.** Changes to ServiceDefs take effect
  on the next scheduler scan. There is no complaint rewrite. This is usually what you
  want; just be aware that the SLA "applied" to a complaint can shift retroactively
  if you renamed/recategorised its ServiceDef.

---

## Cross-references

- [Escalation feature design](escalation-feature-design.md) — the scheduler, skip
  reasons, OTEL span attributes, and where `extractCategoryTuple` sits in the scan
  loop.
- [CRS Configurator roadmap](crs-configurator-roadmap.md) — **G1 Taxonomy editor**
  will constrain today's free-text `(path, category, subcategoryL1)` to a managed
  controlled vocabulary; **G8 Submission Forms** is what makes Strategy A practical
  for non-engineers by exposing an intake-form editor.
- Discussion [#773](https://github.com/egovernments/Citizen-Complaint-Resolution-System/discussions/773)
  — open discussion thread for tenant teams choosing between A and B.
