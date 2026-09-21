# Notification golden master (characterisation fixtures)

This folder holds the shared input matrix for the notification cutover and **two** generated
fixtures — one for each side of it. It is a *characterisation* record: it pins behaviour, not
intent. Some of what it pins is arguably wrong; that is the point.

| File | What it is |
|---|---|
| `inputs/masters/RAINMAKER-PGR.Notification*.json` | Verbatim copies of the four shipped MDMS seeds from `utilities/default-data-handler/src/main/resources/mdmsData-dev/RAINMAKER-PGR/`. Copies exist because the Docker test runner mounts only `backend/pgr-services`. `GoldenInputSeedDriftTest` fails if a copy drifts (and skips outside a monorepo checkout). |
| `inputs/scenarios.json` | The input matrix: 26 scenarios of (transition × audience × channel × locale × recipient world). |
| `golden-envelopes.json` | **Generated, and now FROZEN here.** The 57 pre-rendered envelopes `pgr-services` published *before* task T8. |
| `golden-thin-events.json` | **Generated.** The 26 thin events the real `NotificationService` publishes *after* task T8 — one per scenario. |

## Which fixture is whose

After the T8 cutover `pgr-services` no longer routes, resolves recipients, renders or mints
envelopes. It publishes ONE thin domain event per workflow transition
(`docs/2.12/notifications/contract/thin-event-v1.schema.json`) and `novu-bridge` does the rest. So
the two files have different owners:

* **`golden-thin-events.json` pins `pgr-services`.** `GoldenThinEventCharacterisationTest` drives the
  real `NotificationService` over the matrix and compares. Nothing in this module reads
  `golden-envelopes.json` any more.
* **`golden-envelopes.json` is now `novu-bridge`'s acceptance criterion.** Its `ThinEventParityTest`
  feeds these same scenarios through the resolution stage and must mint exactly these envelopes
  (modulo the four intended differences in design §8.3). It keeps a byte-identical copy of this
  whole folder and `GoldenFixtureSyncTest` fails if the copies drift — which is why
  `golden-envelopes.json` and `inputs/` **must not change** in this module.

## How the thin-event fixture is kept honest

Generated once from the real producer, then held to an independent expectation forever after:

1. `GoldenThinEventFixtureGenerator` runs the real `NotificationService` and captures what reaches
   the Kafka producer → that is what the committed file records.
2. `BridgeThinEventSpec` — a **line-by-line mirror** of
   `backend/novu-bridge/src/test/java/org/egov/novubridge/service/resolution/golden/ScenarioThinEventBuilder.java`
   at commit `350f4c38` (blob `4c4eafb1`) — derives the expected event from `inputs/scenarios.json`
   alone, touching no main code of this module.
3. `GoldenThinEventCharacterisationTest` asserts (1) == the file **and** the file == (2).

A fixture regenerated to launder a producer bug would immediately go red on (2). If the bridge's
`ScenarioThinEventBuilder` changes, update `BridgeThinEventSpec` with it, re-read the diff, and only
then regenerate.

The generator also **booby-traps two stubs**: a call to egov-localization or to
digit-user-preferences-service fails the run outright. The thin event ships localization *codes* and
names no per-recipient locale, so either call means the rendering half came back.

---

## The rule

**Never regenerate to make a red test green.** A failure means the observable notification contract
changed: a placeholder gained or lost, an actor changed shape, a `transactionSeed` moved (which
moves every `transactionId` the bridge completes, and a mid-flight redeploy then double-sends
instead of upserting one ledger row). Fix the code.

Regenerate only when the change is *intended*, and say so in the commit message.

## Regenerating

The normal test runner mounts the module read-only, so regeneration needs its own read-write run:

```bash
docker run --rm -v "$PWD/backend/pgr-services":/w -v "$HOME/.m2-docker":/root/.m2 \
  -w /w maven:3.9-eclipse-temurin-17 \
  mvn -B -Dtest=GoldenThinEventCharacterisationTest -Dgolden.regenerate=true test

# the container writes as root — hand the files back and drop its target/
docker run --rm -v "$PWD/backend/pgr-services":/w maven:3.9-eclipse-temurin-17 \
  bash -c "chown -R $(id -u):$(id -g) /w/src/test && rm -rf /w/target"
```

With `-Dgolden.regenerate=true` the comparison is skipped and the file is rewritten from the live
code. Without it (the normal run) the file is read from the classpath and compared. On the very
first regeneration the fixture is not yet on the classpath, so the second assertion errors — rerun
without the flag once the file is in place.

`golden-envelopes.json` has **no** regeneration path left in this module: the code that produced it
is gone. Recovering it means checking out a pre-T8 revision.

---

## What is normalised, and why

Everything on the wire is compared **literally**, except two fields that main code generates from
non-injectable sources. They are checked for *shape* before being replaced, so a change from a uuid
to something else, or from an ISO-8601 instant to something else, still fails the test.

| Field | Replaced with | Why it cannot be frozen |
|---|---|---|
| `event.eventId` | `"<uuid>"` | `UUID.randomUUID()` inline in `ThinEventBuilder.build` (and, in the frozen envelope fixture, in the deleted `publishRenderedEvent`). No clock/id seam exists. |
| `event.eventTime` | `"<timestamp>"` | `Instant.now()`, same line, same reason. |

Everything else is verbatim and is the contract being preserved. For `golden-thin-events.json`:
`kind`, `eventName`, `ledgerEventName`, `transactionSeed`, `entityType`, `entityId`, `tenantId`, the
whole `actors` map, `data`, `localized`, `localizationModules`, `localizationLocale` and `payload` —
plus the Kafka `topic` and the tenant id passed to `Producer.push`. For the frozen
`golden-envelopes.json` it is additionally `transactionId`, `subscriberId`, `channel`,
`renderedBody`, `subject`, `templateKey`, `templateId`, `contentVariables` and the `contact` block.

A null value is **omitted** from the thin event rather than written as `null`: the bridge binds the
wire form to its `ThinEvent` POJO, where absent and null are the same thing, and omitting keeps
contact detail the producer does not hold off the broker entirely.

Two further sources of run-to-run variance are removed at the source rather than normalised:

* **Time zone.** The generator forces `TimeZone.setDefault("UTC")` for the run, exactly as
  `MainConfiguration.initialize()` does in production (`app.timezone=UTC`). `{date}` is formatted
  with `ZoneId.systemDefault()`, so without this the fixture would depend on the machine.
* **Per-scenario object graph.** `MDMSUtils` caches master rows per state tenant; every scenario gets
  a fresh graph so no scenario can see the previous one's world.

## Ordering

`golden-thin-events.json` needs no ordering rule: a transition publishes exactly one event, so
`events[]` has one element.

In the frozen `golden-envelopes.json`, `envelopes[]` is sorted by
`(event.transactionId, event.templateKey, event.renderedBody)` so the file never churns, and
`emissionOrder[]` preserves the order the producer was *actually* called in — a real observable
(routing-row file order × recipient order) that the bridge-side port must not reorder silently.

---

## JSON shapes (for the bridge-side parity test)

All three files are plain JSON. Nothing in them requires a `pgr-services` class to read.

### `inputs/scenarios.json`

```jsonc
{
  "defaults": {
    "tenantId": "ke.bomet",
    "masters": { "routing": "seed", "templates": "seed", "providerTemplates": "seed" },
    "config":  { /* the PGRConfiguration values every scenario starts from */ },
    "world":   { /* the outside world every scenario starts from */ }
  },
  "scenarios": [
    {
      "id": "S04-assign-citizen-and-assignee",
      "description": "…what this scenario pins…",
      "config":  { /* optional: overrides defaults.config key by key */ },
      "masters": { /* optional: see below */ },
      "world":   { /* optional: overrides defaults.world key by key (whole-key replacement) */ },
      "request": { "RequestInfo": {…}, "service": {…}, "workflow": {…} }
    }
  ]
}
```

`request` is a PGR `ServiceRequest` exactly as it arrives on `save-pgr-request` /
`update-pgr-request`.

**`masters`** — per master (`routing`, `templates`, `providerTemplates`):

* absent or `"seed"` → the committed copy of the shipped seed;
* an inline array → **replaces** the seed entirely;
* `"<name>Append": [ … ]` → rows appended after whichever base was chosen.

Since the T8 cutover `pgr-services` reads none of `masters`, and never calls egov-localization or
the preference service. Those blocks stay because they are the **bridge's** inputs: its parity test
runs the same scenarios through the resolution stage with the same world.

**`world`** — everything outside the service:

| Key | Shape | Feeds |
|---|---|---|
| `localization` | `{ "rainmaker-pgr": {"messages":[{code,message,…}]}, "rainmaker-common": {…} }` | egov-localization (bridge-side only) |
| `localizationFails` | `true` → every localization call throws | the outage path (bridge-side only) |
| `shortUrl` | string | egov-url-shortening result |
| `shortUrlFails` | `true` → the shortener throws | the outage path |
| `usersByUuid` | `{ "<uuid>": {uuid,name,mobileNumber,countryCode,emailId,createdDate,…} }` | egov-user `_search` by uuid (assignee hydration) |
| `rolePools` | `{ "<ROLE>": [ [page 0 rows], [page 1 rows], … ] }` | egov-user `_search` by `roleCodes`, one array per page (bridge-side only) |
| `preferences` | `{ "<uuid>": "hi_IN" }` | digit-user-preferences-service (bridge-side only) |
| `workflowHistory` | `{ "ProcessInstances": [ {action, assignes:[{uuid,name,mobileNumber}]} ] }` | egov-workflow-v2 `?history=true` |
| `hrms` | `{ "Employees": [ {user:{name}, assignments:[{department,designation,isCurrentAssignment}]} ] }` | egov-hrms |
| `mdms` | `{ "MdmsRes": { "RAINMAKER-PGR": { "ComplaintHierarchy": [ {code, department} ] } } }` | `MDMSUtils.mDMSCall` |

`usersByUuid` rows **must** carry a `createdDate` in `dd-MM-yyyy HH:mm:ss`: `NotificationService`
runs every egov-user response through `parseResponse`, and a null `createdDate` NPEs inside a
`catch (Exception)` that silently yields "no assignee".

### `golden-thin-events.json`

```jsonc
{
  "normalisedFields": { "event.eventId": "<uuid>", "event.eventTime": "<timestamp>" },
  "contract": "docs/2.12/notifications/contract/thin-event-v1.schema.json",
  "scenarios": [
    {
      "id": "S04-…", "description": "…", "eventCount": 1,
      "events": [
        { "producerTenantId": "ke.bomet",
          "topic": "complaints.domain.events",
          "event": { /* the thin event, verbatim, in the order ThinEventBuilder builds it */ } }
      ]
    }
  ]
}
```

### `golden-envelopes.json` (frozen)

```jsonc
{
  "normalisedFields": { "event.eventId": "<uuid>", "event.eventTime": "<timestamp>" },
  "envelopeOrdering": "…",
  "scenarios": [
    {
      "id": "S04-…", "description": "…", "envelopeCount": 6,
      "emissionOrder": ["<transactionId>", …],
      "envelopes": [
        { "producerTenantId": "ke.bomet",
          "topic": "complaints.domain.events",
          "event": { /* the v1 envelope, verbatim, in the order NotificationService builds it */ } }
      ]
    }
  ]
}
```

---

## The matrix — 26 scenarios: 26 thin events, and the 57 envelopes they must become

The **Envelopes** column below is what the pre-cutover producer published and what `novu-bridge` must
now mint from the one thin event each scenario produces. Three rows read `0`: under the thin path
those transitions still publish an event and the bridge records a visible
`SKIPPED / NB_NO_ROUTING` row instead of dropping them silently (design errata 10).

| Scenario | Envelopes | What it pins |
|---|---|---|
| `S01-apply-citizen-all-channels` | 3 | APPLY→PENDINGFORASSIGNMENT, citizen with phone+email; WHATSAPP carries an approved Twilio `templateId` + positional `contentVariables` |
| `S02-apply-citizen-phone-only` | 2 | no email ⇒ the EMAIL row is contact-gated away (no phantom send) |
| `S03-apply-citizen-uuid-falls-back-to-accountId` | 3 | blank citizen uuid ⇒ subscriber key = `service.accountId`; a `+`-prefixed mobile is not re-prefixed |
| `S04-assign-citizen-and-assignee` | 6 | ASSIGN→PENDINGATLME with a named assignee (egov-user + HRMS + MDMS); EMPLOYEE WHATSAPP emits with **no** `templateId` |
| `S05-reassign-citizen` | 3 | REASSIGN→PENDINGFORREASSIGNMENT (seed rows author a `fromState` the runtime never supplies) |
| `S06-resolve-citizen` | 3 | RESOLVE→RESOLVED |
| `S07-reject-citizen-with-comments` | 3 | REJECT→REJECTED, `{additional_comments}` from `workflow.comments` |
| `S08-reopen-citizen` | 3 | REOPEN→PENDINGFORASSIGNMENT |
| `S09-rate-closedafterresolution-assignee-from-history` | 3 | RATE→CLOSEDAFTERRESOLUTION; assignee from the last `ASSIGN` in workflow history; `{rating}` |
| `S10-rate-closedafterrejection-no-routing` | 0 | a transition with no routing row: silence, no ledger row anywhere |
| `S11-assign-citizen-prefers-hi` | 3 | per-recipient locale hi_IN ⇒ hi body/subject/provider template; unresolved `{emp_*}` stay as literal braces |
| `S12-assign-citizen-prefers-unseeded-locale` | 3 | fr_FR ⇒ body, `templateKey` and provider template fall back to en_IN while `contact.locale` stays fr_FR |
| `S13-assign-msgid-drives-placeholder-localization` | 3 | `RequestInfo.msgId` locale localises the placeholder VALUES while the template locale is per recipient |
| `S14-assign-role-pool-dedupe-paging` | 7 | 3-holder pool paged 2 at a time; the holder who is also the assignee is deduped on `(channel, subscriberKey)`; a holder with no contact is dropped |
| `S15-assigneeOnly-collapses-role-to-assignee` | 1 | `assigneeOnly` row + named assignee ⇒ no pool search; `contact.type` becomes `EMPLOYEE` while the template stays under the role |
| `S16-assigneeOnly-without-assignee-falls-back-to-pool` | 2 | no assignee ⇒ the row falls through to the whole pool |
| `S17-router-drops-inactive-unknown-channel-and-pseudo-audience` | 2 | rows the router drops: `active:false`, an unknown channel (PUSH), `AUTO_ESCALATE`, a blank audience and another `businessService` |
| `S18-whatsapp-provider-template-not-approved` | 1 | unapproved Twilio row ⇒ still emitted, `templateId` absent, so the bridge can write `SKIPPED / NB_TEMPLATE_NOT_APPROVED` |
| `S19-email-escapes-values-subject-does-not` | 1 | EMAIL body HTML-escapes substituted values; the subject does not |
| `S20-email-subject-falls-back-to-complaint-id` | 1 | null template subject ⇒ `"Complaint <serviceRequestId>"` |
| `S21-routed-channel-without-template-emits-nothing` | 0 | routed + resolvable recipient + no template ⇒ silent drop |
| `S22-pool-member-without-uuid-keys-on-phone` | 1 | uuid-less holder ⇒ `subscriberId`/`transactionId` carry the raw MSISDN |
| `S23-all-thirteen-placeholders` | 1 | all 13 tokens with every source healthy |
| `S24-url-shortener-down-blanks-download-link` | 1 | shortener outage ⇒ `{download_link}` blanked, everything else intact |
| `S25-localization-down-falls-back-to-raw-values` | 1 | localization outage ⇒ raw service code / raw status, `{ulb}`, `{ao_designation}`, `{emp_department}`, `{emp_designation}` left as literal braces |
| `S26-escalate-has-no-routing-today` | 0 | PGR's supervisor escalation (`PENDINGATLME --ESCALATE--> PENDINGATLME`) reaches this code but has no seeded routing row: nobody is told |

`GoldenThinEventCharacterisationTest.everySeededActiveTransitionIsInTheMatrix` fails if a new active
routing row introduces an `(action, toState)` no scenario covers.

Workflow actions deliberately left out of the matrix: `COMMENT` (three self-transitions, no seeded
routing rows, same zero-envelope shape as `S26`) and the second `ASSIGN`
(`PENDINGFORREASSIGNMENT --ASSIGN--> PENDINGATLME`), which matches the same routing rows as `S04`
because `fromState` never reaches the router — its envelopes would be byte-identical to `S04`'s.

---

## Behaviour recorded in `golden-envelopes.json` that is easy to lose in a port

These describe the **pre-cutover** envelope path; they are now `novu-bridge`'s to preserve. Items 1
and 6 are the two the producer still has a hand in: `transactionSeed` supplies the first three
segments of the transaction id, and `download_link` is the one token the producer blanks.

1. **`transactionId` = `serviceRequestId : ACTION : TOSTATE : tenantId : subscriberKey : CHANNEL`** —
   note the tenant id is *inside* it, because `subscriberId` (`tenantId:subKey`) is interpolated
   whole. Any bridge-side reconstruction must keep all six segments in that order.
2. **`subscriberKey` = uuid, else phone, else nothing** — an envelope with neither is dropped before
   publish, silently.
3. **Dedupe is on `(channel, subscriberKey)`; the audience is deliberately not in the key**, and the
   key is consumed only *after* a successful publish (so a missing template on the first row does
   not suppress the second row for the same person).
4. **Locale has two independent axes.** The *template* locale is per recipient (user-preferences,
   falling back to `pgr.notification.default.locale`, and the renderer falls back again per field).
   The *placeholder values* are localised once per event from `RequestInfo.msgId` — recipients in
   different languages share one set of substituted values.
5. **`contact.locale` is the recipient's preference, not the locale that was rendered.** When the
   preferred locale has no template, the body is the default locale's while `contact.locale` still
   says `fr_FR`. `templateKey` is the only field that tells you what was actually rendered.
6. **Unresolved placeholders stay as literal braces** (`{emp_name}`), except `{download_link}`, which
   is blanked to `""` on a shortener failure.
7. **EMAIL bodies escape substituted values, subjects do not**, and an EMAIL with no template subject
   gets `"Complaint <id>"`.
8. **WhatsApp without an approved provider template still emits**, with `templateId` and
   `contentVariables` absent from the map entirely (not present-and-null).
9. **`contentVariables` are positional** (`{"1":…}`) built from the provider template's ordered
   `variables`; a missing placeholder becomes `""`, never null.
10. **Role-pool order is `LinkedHashMap` insertion order across pages, with uuid-less holders appended
    last** — not sorted, not stable against egov-user's own ordering.
