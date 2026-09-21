# Notification golden master (characterisation fixture)

This folder pins **what `pgr-services` publishes today**, envelope by envelope, so that when the
routing / recipient-resolution / rendering / envelope-minting code moves into `novu-bridge` the new
path can be proved equal to the old one. It is a *characterisation* fixture: it records behaviour,
not intent. Some of what it records is arguably wrong — that is the point.

| File | What it is |
|---|---|
| `inputs/masters/RAINMAKER-PGR.Notification*.json` | Verbatim copies of the four shipped MDMS seeds from `utilities/default-data-handler/src/main/resources/mdmsData-dev/RAINMAKER-PGR/`. Copies exist because the Docker test runner mounts only `backend/pgr-services`. `GoldenInputSeedDriftTest` fails if a copy drifts (and skips outside a monorepo checkout). |
| `inputs/scenarios.json` | The input matrix: 26 scenarios of (transition × audience × channel × locale × recipient world). |
| `golden-envelopes.json` | **Generated.** Every envelope the real `NotificationService` handed to the Kafka producer for those inputs — 57 envelopes. |

Driven by `src/test/java/org/egov/pgr/service/notification/golden/`:
`GoldenEnvelopeFixtureGenerator` (builds the object graph and captures), and
`GoldenEnvelopeCharacterisationTest` (compares, proves determinism, guards matrix coverage).

---

## The rule

**Never regenerate to make a red test green.** A failure here means the observable notification
contract changed: a different body, a different `transactionId`, a recipient gained or lost, an
envelope that used to be published and no longer is. Fix the code.

Regenerate only when the change is *intended*, and say so in the commit message. The four
differences the thin-event design deliberately introduces (`eventName` gaining the target state, the
new `templateKey` form, new `SKIPPED` ledger rows, the `source_path` column — design §8.3) are
bridge-side and must **not** change this file: `pgr-services` keeps publishing what it publishes
until task T8 replaces the producer, and at that point the parity test compares against *this*
recorded behaviour with the §8.3 differences applied explicitly.

## Regenerating

The normal test runner mounts the module read-only, so regeneration needs its own read-write run:

```bash
docker run --rm -v "$PWD/backend/pgr-services":/w -v "$HOME/.m2-docker":/root/.m2 \
  -w /w maven:3.9-eclipse-temurin-17 \
  mvn -B -Dtest=GoldenEnvelopeCharacterisationTest -Dgolden.regenerate=true test

# the container writes as root — hand the files back and drop its target/
docker run --rm -v "$PWD/backend/pgr-services":/w maven:3.9-eclipse-temurin-17 \
  bash -c "chown -R $(id -u):$(id -g) /w/src/test && rm -rf /w/target"
```

With `-Dgolden.regenerate=true` the comparison is skipped and the file is rewritten from the live
code. Without it (the normal run) the file is read from the classpath and compared.

---

## What is normalised, and why

Everything on the wire is compared **literally**, except two fields that main code generates from
non-injectable sources. They are checked for *shape* before being replaced, so a change from a uuid
to something else, or from an ISO-8601 instant to something else, still fails the test.

| Field | Replaced with | Why it cannot be frozen |
|---|---|---|
| `event.eventId` | `"<uuid>"` | `UUID.randomUUID()` inline in `NotificationService.publishRenderedEvent` (l.810). No clock/id seam exists and this task may not touch `src/main`. |
| `event.eventTime` | `"<timestamp>"` | `Instant.now()` inline at l.813. Same reason. |

Everything else is verbatim and is the contract being preserved: `transactionId`, `subscriberId`,
`channel`, `renderedBody`, `subject`, `templateKey`, `templateId`, `contentVariables`, the whole
`contact` block (userId / type / name / phone / email / locale), `tenantId`, `eventName`,
`eventType`, `schemaVersion`, `producer`, `module`, `entityType`, `entityId` and the `data` block —
plus the Kafka `topic` and the tenant id passed to `Producer.push`.

Two further sources of run-to-run variance are removed at the source rather than normalised:

* **Time zone.** The generator forces `TimeZone.setDefault("UTC")` for the run, exactly as
  `MainConfiguration.initialize()` does in production (`app.timezone=UTC`). `{date}` is formatted
  with `ZoneId.systemDefault()`, so without this the fixture would depend on the machine.
* **Per-scenario object graph.** `NotificationService` holds an instance-level `preferredLocaleCache`
  (60 s TTL) and `MDMSUtils` caches master rows; every scenario gets a fresh graph so no scenario
  can see the previous one's world.

## Ordering

`envelopes[]` is sorted by `(event.transactionId, event.templateKey, event.renderedBody)` so the
file never churns. The order the producer was *actually* called in is preserved separately in
`emissionOrder[]` (an array of `transactionId`s) — it is a real observable (routing-row file order ×
recipient order) and a later port should not reorder it silently.

---

## JSON shapes (for the bridge-side parity test)

Both files are plain JSON. Nothing in them requires a `pgr-services` class to read.

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

**`world`** — everything outside the service:

| Key | Shape | Feeds |
|---|---|---|
| `localization` | `{ "rainmaker-pgr": {"messages":[{code,message,…}]}, "rainmaker-common": {…} }` | egov-localization |
| `localizationFails` | `true` → every localization call throws | the outage path |
| `shortUrl` | string | egov-url-shortening result |
| `shortUrlFails` | `true` → the shortener throws | the outage path |
| `usersByUuid` | `{ "<uuid>": {uuid,name,mobileNumber,countryCode,emailId,createdDate,…} }` | egov-user `_search` by uuid (assignee hydration) |
| `rolePools` | `{ "<ROLE>": [ [page 0 rows], [page 1 rows], … ] }` | egov-user `_search` by `roleCodes`, one array per page |
| `preferences` | `{ "<uuid>": "hi_IN" }` | digit-user-preferences-service |
| `workflowHistory` | `{ "ProcessInstances": [ {action, assignes:[{uuid,name,mobileNumber}]} ] }` | egov-workflow-v2 `?history=true` |
| `hrms` | `{ "Employees": [ {user:{name}, assignments:[{department,designation,isCurrentAssignment}]} ] }` | egov-hrms |
| `mdms` | `{ "MdmsRes": { "RAINMAKER-PGR": { "ComplaintHierarchy": [ {code, department} ] } } }` | `MDMSUtils.mDMSCall` |

`usersByUuid` rows **must** carry a `createdDate` in `dd-MM-yyyy HH:mm:ss`: `NotificationService`
runs every egov-user response through `parseResponse`, and a null `createdDate` NPEs inside a
`catch (Exception)` that silently yields "no assignee".

### `golden-envelopes.json`

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

## The matrix — 26 scenarios, 57 envelopes

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

`GoldenEnvelopeCharacterisationTest.everySeededActiveTransitionIsInTheMatrix` fails if a new active
routing row introduces an `(action, toState)` no scenario covers.

Workflow actions deliberately left out of the matrix: `COMMENT` (three self-transitions, no seeded
routing rows, same zero-envelope shape as `S26`) and the second `ASSIGN`
(`PENDINGFORREASSIGNMENT --ASSIGN--> PENDINGATLME`), which matches the same routing rows as `S04`
because `fromState` never reaches the router — its envelopes would be byte-identical to `S04`'s.

---

## Behaviour recorded here that is easy to lose in a port

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
