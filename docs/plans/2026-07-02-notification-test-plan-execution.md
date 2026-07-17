# Execution Plan: Closing the Notification Test Plan (§6 of the design doc)

> **STATUS: EXECUTED (Phase 1+2) — 2026-07-02, commit `e9ffbbb14`** (pushed to fork PR ChakshuGautam/CCRS#58).
> Because findings W1–W5 already landed (`a819c12a7`), every previously **BLOCKED (Wx)** test was
> implemented as its **post-fix** assertion directly — no pre-fix pins survive. Full suites green,
> 0 failures / 0 errors / 0 skipped:
> - **default-data-handler**: 7 (DDH-1 golden round-trip ×5 + DDH-2 malformed-skip).
> - **pgr-services**: 67 (NotificationResolverEdgeCasesTest ×10, SeedFixtureDriftTest ×2, MDMS cache mirrors ×4, + pre-existing).
> - **novu-bridge**: 70 (WHATSAPP-no-provider, unknown-channel, idempotency + upsert-key, FAILED-row, controller redaction/allowlist, consent matrix, envelope negatives, consumer wiring).
> - **configurator**: `tsc -b`/vite build clean + 22 vitest + 12 data-provider node:test (CFG-1 UUID checker, CFG-2 happy-path; write-path branches already covered by `notificationWritePath.test.ts`).
>
> **Phase 3 (live E2E) DEFERRED**: `local-setup/tests/e2e/notifications/e2e-role-notifications.js` is authored,
> syntax- and secret-clean, but needs the running DIGIT stack (docker-exec psql) on the pilot server, and
> the owner-supplied `LME_*`/`GRO_*` contacts for LIVE_DELIVERY. CI note: the data-provider specs run under
> Node's `node:test` (`npm test` in that package), not root vitest.

**Date**: 2026-07-02
**Feature branch**: `feat/pgr-notifications-configure` (squashed feature commit on `upstream/develop`)
**Closes**: the "To add" tables (G1–G20) in `docs/plans/2026-06-29-pgr-config-driven-notifications-design.md` §6, published as fork discussion ChakshuGautam/CCRS#59.
**Companion plan**: `docs/plans/2026-07-02-notification-findings-execution.md` (the findings-remediation plan). Several tests below assert **post-fix** behavior and cannot pass until a findings workstream lands. Workstream IDs used below:

| ID | Findings workstream (behavior, so you can match even if numbering differs) |
|----|---------------------------------------------------------------------------|
| **W1** | novu-bridge channel gate + Baileys removal: unknown channel → `NB_UNSUPPORTED_CHANNEL` (never the SMS workflow); `WHATSAPP` with no provider → `SKIPPED` row with `NB_NO_PROVIDER`; `BaileysSendClient`/`BaileysProviderStrategy` deleted |
| **W2** | novu-bridge delivery robustness: delivery failure persists a `FAILED` `nb_dispatch_log` row before rethrow; pre-send idempotency check; RestTemplate timeouts |
| **W3** | pgr-services emission fixes: per-channel contact filtering (EMAIL needs email, SMS/WHATSAPP need phone), role-pool pagination, dedupe-key-after-publish |
| **W4** | pgr-services MDMS cache TTL/invalidation |
| **W5** | configurator Configure-tab write path: `{ returnPromise: true }` on all mutations, duplicate-key Add→update branch, reactivation of soft-deleted rows, old-pair deactivation on key-changing edit |

Every test is marked **RUNNABLE NOW** (passes against the current branch) or **BLOCKED (Wx)** (write it together with, or after, that workstream — it asserts the fixed behavior). Where a pinning variant is valuable now, it is spelled out.

**Rules for the executor**:
- Only add test files, test fixtures, and the E2E script location named below. Do not change `src/main` code in this plan — production changes belong to the findings plan.
- Ground every assertion in the anchors quoted here. If an anchor does not match the file you open, STOP and re-check the file rather than improvising.
- No secrets in any committed file: no API keys, tokens, passwords, private IPs, or SSH host aliases. All credentials/endpoints the E2E script needs come from environment variables.

---

## 1. Recipient matrix for live E2E

Live end-to-end runs deliver real messages. These are the test identities:

| Audience | Phone | Email | Status |
|----------|-------|-------|--------|
| **CITIZEN** (complaint filer) | `+919415787824` | `contact@theflywheel.in` | Owner's own contacts — **authorized by the owner for use in this repo and in live test runs** |
| **PGR_LME** (assignee / role pool) | `<LME_PHONE>` | `<LME_EMAIL>` | **Placeholder — owner will supply.** Until supplied, LME legs assert dispatch-log rows only (no human-received verification) |
| **GRO** (role pool) | `<GRO_PHONE>` | `<GRO_EMAIL>` | **Placeholder — owner will supply.** Same interim rule as LME |

### Where these get wired

The live E2E is the role-notification script (currently a 197-line Node script run on the pilot server; flow: citizen register → APPLY → ASSIGN → RESOLVE, polling `nb_dispatch_log` after each transition and cross-referencing recipient uuids against `eg_userrole_v1`). Its repo home is **`local-setup/tests/e2e/notifications/e2e-role-notifications.js`** (see E2E-0 below — `local-setup/tests/e2e/playwright.config.ts` has `testDir: './specs'`, so a plain `.js` file under `notifications/` is invisible to Playwright and is run directly with `node`).

**1. CITIZEN wiring — the script's citizen registration.** Today the script registers a fresh citizen with a generated tenant-local phone (`const CITIZEN_PHONE = '7' + String(Date.now()).slice(-8);`) and `CITIZEN_EMAIL = 'contact@theflywheel.in'`. For live-delivery runs the script gains a `LIVE_DELIVERY=1` mode:
   - Registration still uses a generated tenant-valid local number (the tenant's MDMS `common-masters.UserValidation` regex is Kenya-format and will reject an Indian number at `/user/citizen/_create`).
   - Immediately after registration, the script updates the citizen's contacts via egov-user's **`/user/users/_updatenovalidate`** (the internal update endpoint that skips format validation), setting `mobileNumber` from env `LIVE_CITIZEN_PHONE` (default `+919415787824` → store local part `9415787824` with `countryCode` `+91`) and `emailId` from `LIVE_CITIZEN_EMAIL` (default `contact@theflywheel.in`). The call needs an employee/superuser token the script already obtains.
   - The complaint payload's `service.citizen` block (which is what `NotificationService.resolveByAudience` reads for the CITIZEN audience — it uses `request.getService().getCitizen()`, not a DB lookup) carries the same live `mobileNumber`/`countryCode`/`emailId`, so the emitted events target the owner's real contacts.
   - **Verify on first live run**; if pgr-services rejects the citizen block's number format, fallback: temporarily broaden `common-masters.UserValidation` on the test tenant and delete the Redis key `validationRules` (the user service caches validation rules there across restarts), then restore afterwards.

**2. LME/GRO wiring — HRMS/eg_user contact updates on the target server.** The test employees (the ASSIGN actor and at least one more PGR_LME holder, plus a GRO holder) must carry the live contacts so role-pool fan-out reaches a real device. Mechanism, in preference order:
   - **HRMS employee `_update`** (`/egov-hrms/employees/_update`) with the employee's current record plus new `user.mobileNumber`/`user.emailId` — the supported administrative path; or
   - **egov-user `/user/users/_updatenovalidate`** directly against the employee's user record when the live number fails HRMS's hardcoded 10-digit mobile validation.
   - The script reads `LME_PHONE`, `LME_EMAIL`, `GRO_PHONE`, `GRO_EMAIL` from env. When unset it prints a notice and skips the contact update (dispatch-log assertions still run; human-received verification is skipped). **Do not commit real values** — the owner supplies them at run time.

**3. Credentials.** The script must take the employee login from env (`E2E_EMP_USER`, `E2E_EMP_PASS`, `E2E_TENANT` default `ke.bomet`) — the current copy hardcodes a username/password pair, which must NOT be carried into the repo copy.

---

## 2. Existing coverage (verified by running the suites — do not re-derive)

51 passing automated tests + 1 live E2E scenario exist on this branch:

| Suite | File | Count | Pins |
|-------|------|-------|------|
| `NotificationRouterTest` | `backend/pgr-services/src/test/java/org/egov/pgr/service/notification/NotificationRouterTest.java` | 14 | Full routing-match matrix: role audiences kept verbatim, AUTO_ESCALATE/SYSTEM dropped, unknown channel dropped, RATE toState disambiguation, fromState optional/specific, inactive rows, blank inputs |
| `TemplateRendererTest` | `backend/pgr-services/src/test/java/org/egov/pgr/service/notification/TemplateRendererTest.java` | 5 | Placeholder fill, default-locale fallback, missing template → null, case-insensitive keys, null placeholder left literal |
| `NotificationConfigDrivenEmissionTest` | `backend/pgr-services/src/test/java/org/egov/pgr/service/notification/NotificationConfigDrivenEmissionTest.java` | 4 | One event per channel with full envelope assertions, flag-off short-circuit, role-pool fan-out (2 holders → 2 events), cross-role `channel\|subscriber` dedupe |
| `NotificationGoldenOutputTest` | `backend/pgr-services/src/test/java/org/egov/pgr/service/notification/NotificationGoldenOutputTest.java` | 9 | SMS legacy-parity gate over seeded fixtures, incl. `allTransitions_configDrivenSetEqualsLegacySet` sweep; explicitly rejects empty-set false proofs |
| `DispatchPipelinePassThroughTest` | `backend/novu-bridge/src/test/java/org/egov/novubridge/service/DispatchPipelinePassThroughTest.java` | 4 | Verbatim pass-through per channel (no template/provider resolution), preference-denied → SKIPPED. NOTE: `whatsappEvent_routesToBaileys_notNovu` is rewritten by W1 (see NB-1) |
| `BaileysProviderStrategyTest` | `backend/novu-bridge/src/test/java/org/egov/novubridge/service/provider/BaileysProviderStrategyTest.java` | 4 | Baileys-specific — **deleted wholesale by W1**; its one durable concern (who owns bare `"whatsapp"` in the strategy factory) is re-pinned in NB-1 |
| `ProviderAgnosticTest` | `backend/novu-bridge/src/test/java/org/egov/novubridge/service/ProviderAgnosticTest.java` | 2 | Pre-existing legacy tests (weak assertions); not part of this PR, leave alone |
| `validateNotifications.test.ts` | `configurator/src/resources/workflow-services/validateNotifications.test.ts` | 11 | All rules R1–R6, case-insensitivity, string-boolean active flags, inactive-row handling. All fixtures use symbolic `nextState` names (gap CFG-1) |
| `DefaultDataHandlerApplicationTests` | `utilities/default-data-handler/src/test/java/org/egov/DefaultDataHandlerApplicationTests.java` | 1 (stub) | `contextLoads` only — the splitter has **zero** coverage (gap DDH-1) |
| Live E2E | (server-side script; repo copy created by E2E-0) | 1 scenario | Citizen register → APPLY → ASSIGN → RESOLVE with per-role/per-channel `nb_dispatch_log` assertions cross-checked against `eg_userrole_v1`; WHATSAPP misses currently downgraded to warnings |

**Scope note**: Baileys-specific delivery tests are excluded (the provider is being removed by W1). The WHATSAPP-no-provider safe-skip behavior is covered instead (NB-1 unit, E2E-5 live).

---

## 3. Test implementation plan, by layer

Conventions used below. Java tests follow the existing patterns in this repo:
- **Router-style unit test** (`NotificationRouterTest`): `@ExtendWith(MockitoExtension.class)` + `@MockitoSettings(strictness = Strictness.LENIENT)`, `@Mock` collaborators, `@InjectMocks` subject, `LinkedHashMap` rows as MDMS fixtures.
- **Pipeline-style unit test** (`DispatchPipelinePassThroughTest`): plain JUnit 5, `new EnvelopeValidator()` real, `mock(...)` for `PreferenceServiceClient`/`NovuClient`/`DispatchLogRepository`/`MdmsServiceClient`, a real `NovuBridgeConfiguration` with setters, service constructed by hand, `ArgumentCaptor` assertions. (Post-W1 the constructor loses the `BaileysSendClient` parameter — mirror whatever the constructor looks like after W1.)
- Run commands are given per test. Maven module tests run from the module directory (`backend/pgr-services`, `backend/novu-bridge`, `utilities/default-data-handler`); configurator tests via `npm test` / `npx vitest run` from `configurator/`.

### Layer A — default-data-handler (splitter)

#### DDH-1 (gap G1, P0) — Splitter golden round-trip · **RUNNABLE NOW**

- **Target file**: `utilities/default-data-handler/src/test/java/org/egov/handler/service/PgrWorkflowConfigSplitterTest.java` (new).
- **Subject**: `DataHandlerService.createPgrWorkflowConfig(String targetTenantId)` at `utilities/default-data-handler/src/main/java/org/egov/handler/service/DataHandlerService.java` line 492. It (a) parses classpath `PgrWorkflowConfig.json`, (b) strips `notifications` from every action node and `notificationTemplates` from the root (lines 541–562), POSTs the stripped workflow via `workflowUtil.createWfConfig(businessServiceRequest)` (line 566), then (c) emits MDMS rows via `emitNotificationRouting` (line 583, uid `String.join(".", PGR_BUSINESS_SERVICE, action, toState, audience, channel)` at line 602) and `emitNotificationTemplates` (line 612, uid `String.join(".", audience, action, toState, channel, locale)` at line 639), each ending in `mdmsV2Util.createMdmsData(mdmsRequest)` inside `createNotificationMdmsRow`.
- **Harness**: plain Mockito unit test (`spring-boot-starter-test` is already a dependency in `utilities/default-data-handler/pom.xml`; it bundles mockito + junit-jupiter). Construct the service by hand — the constructor (line 62) is `DataHandlerService(MdmsV2Util, HrmsUtil, LocalizationUtil, TenantManagementUtil, ServiceConfiguration, ObjectMapper, ResourceLoader, WorkflowUtil, CustomKafkaTemplate, MdmsBulkLoader, RestTemplate)`. Pass:
  - `mock(...)` for everything except: a **real** `new ObjectMapper()` and a **real** `new org.springframework.core.io.DefaultResourceLoader()` (so `classpath:PgrWorkflowConfig.json` resolves from `src/main/resources`, which is on the test classpath).
  - Capture `workflowUtil.createWfConfig(...)` with `ArgumentCaptor<BusinessServiceRequest>` and `mdmsV2Util.createMdmsData(...)` with `ArgumentCaptor<MdmsRequest>` (check the exact model package names by opening `WorkflowUtil`/`MdmsV2Util` — they are in `org.egov.handler.util`).
- **Golden fixtures**: create `utilities/default-data-handler/src/test/resources/notification/golden-routing-uids.json` and `golden-template-uids.json` containing exactly these arrays (derived from `src/main/resources/PgrWorkflowConfig.json`, verified 2026-07-02 — 11 routing rows, 5 templates × 11 bodies):
  - Routing uids: `PGR.APPLY.PENDINGFORASSIGNMENT.CITIZEN.SMS`, `PGR.APPLY.PENDINGFORASSIGNMENT.CITIZEN.WHATSAPP`, `PGR.APPLY.PENDINGFORASSIGNMENT.CITIZEN.EMAIL`, `PGR.APPLY.PENDINGFORASSIGNMENT.GRO.SMS`, `PGR.ASSIGN.PENDINGATLME.PGR_LME.SMS`, `PGR.ASSIGN.PENDINGATLME.PGR_LME.WHATSAPP`, `PGR.ASSIGN.PENDINGATLME.PGR_LME.EMAIL`, `PGR.ASSIGN.PENDINGATLME.CITIZEN.SMS`, `PGR.RESOLVE.RESOLVED.CITIZEN.SMS`, `PGR.RESOLVE.RESOLVED.CITIZEN.WHATSAPP`, `PGR.RESOLVE.RESOLVED.CITIZEN.EMAIL`
  - Template uids: `CITIZEN.APPLY.PENDINGFORASSIGNMENT.SMS.en_IN`, `CITIZEN.APPLY.PENDINGFORASSIGNMENT.WHATSAPP.en_IN`, `CITIZEN.APPLY.PENDINGFORASSIGNMENT.EMAIL.en_IN`, `GRO.APPLY.PENDINGFORASSIGNMENT.SMS.en_IN`, `PGR_LME.ASSIGN.PENDINGATLME.SMS.en_IN`, `PGR_LME.ASSIGN.PENDINGATLME.WHATSAPP.en_IN`, `PGR_LME.ASSIGN.PENDINGATLME.EMAIL.en_IN`, `CITIZEN.ASSIGN.PENDINGATLME.SMS.en_IN`, `CITIZEN.RESOLVE.RESOLVED.SMS.en_IN`, `CITIZEN.RESOLVE.RESOLVED.WHATSAPP.en_IN`, `CITIZEN.RESOLVE.RESOLVED.EMAIL.en_IN`
- **Tests + assertions**:
  1. `strippedWorkflow_hasNoNotificationResidue_atAnyDepth` — call `createPgrWorkflowConfig("ke.testtenant")`; serialize the captured `BusinessServiceRequest` back to a `JsonNode` with the real ObjectMapper; recursively walk the tree and assert **no field named `notifications` or `notificationTemplates` exists at any depth**. Also assert every captured `BusinessService.getTenantId()` equals `ke.testtenant` (set at line 565). (The `treeToValue` at line 564 would itself throw on unstripped fields since `Action`/`BusinessService` have no `@JsonIgnoreProperties` — the strip working is precisely why this call succeeds.)
  2. `emittedRoutingRows_matchGoldenUids_andRowShape` — collect all captured `MdmsRequest`s with `schemaCode == "RAINMAKER-PGR.NotificationRouting"`; assert the `uniqueIdentifier` set equals the golden routing-uid set (order-insensitive) and total count is 11. For one known row (`PGR.APPLY.PENDINGFORASSIGNMENT.GRO.SMS`) assert the `data` node carries `businessService=PGR`, `action=APPLY`, `toState=PENDINGFORASSIGNMENT`, `audience=GRO`, `channel=SMS`, `assigneeOnly=false`, `active=true`, `fromState` null (lines 592–600).
  3. `emittedTemplateRows_matchGoldenUids_andCarryBodies` — same for `RAINMAKER-PGR.NotificationTemplate`: uid set equals golden template-uid set, count 11; for one row assert `data` has non-blank `body`, `locale=en_IN`, `active=true` and a `placeholders` array (lines 628–637).
  4. `rerun_isIdempotent_emitsIdenticalPayloads` — call `createPgrWorkflowConfig` twice; assert `createMdmsData` was invoked 44 times total and the multiset of `(schemaCode, uniqueIdentifier)` from the second pass equals the first, and no exception escapes. (True duplicate tolerance — swallowing `DUPLICATE_RECORD` / MDMS phantom-200 — lives inside the real `MdmsV2Util` and is out of unit scope; state that in a comment.)
  5. `workflowPostedBeforeMdmsEmission` — use `Mockito.inOrder(workflowUtil, mdmsV2Util)` to assert `createWfConfig` happens before the first `createMdmsData` (the splitter's documented ordering).
- **Run**: `cd utilities/default-data-handler && mvn -q test -Dtest=PgrWorkflowConfigSplitterTest`

#### DDH-2 (finding #16 guard) — Malformed authoring row is skipped, not fatal · **BLOCKED (findings plan DDH workstream)**

- **Target file**: same class, extra tests.
- Today `emitNotificationRouting` builds the uid via `String.join(...)` over `.asText(null)` values (line 602) — a notification missing `audience`/`channel`, or an action missing `nextState`, throws NPE, and `createPgrWorkflowConfig` catches only `IOException` (line 572). After the findings fix (validate the four fields, skip+WARN):
  - `malformedNotification_missingChannel_isSkipped_othersEmitted` — feed a doctored config (add a test-only resource `src/test/resources/PgrWorkflowConfig-malformed.json`, load it through a `ResourceLoader` stub returning that resource for the classpath key) with one notification lacking `channel`; assert no exception, the workflow is still POSTed, and the remaining well-formed rows are all emitted.
- **Run**: same command as DDH-1.

### Layer B — pgr-services

#### PGR-1 (gap G4, P0) — Resolver edge cases at emission level · **RUNNABLE NOW** (one sub-case blocked on W3)

- **Target file**: `backend/pgr-services/src/test/java/org/egov/pgr/service/notification/NotificationResolverEdgeCasesTest.java` (new).
- **Harness**: copy the harness of `NotificationConfigDrivenEmissionTest` exactly — same 11 `@Mock`s (`PGRConfiguration`, `NotificationUtil`, `WorkflowService`, `ServiceRequestRepository`, `MDMSUtils`, `HRMSUtil`, `ObjectMapper`, `MultiStateInstanceUtil`, `NotificationRouter`, `TemplateRenderer`, `Producer`), `@InjectMocks NotificationService`, `@BeforeEach` stubbing `config.getNotificationConfigDriven()=true`, `getNotificationDefaultLocale()="en_IN"`, `getComplaintsDomainEventsTopic()="complaints.domain.events"`, renderer answering `"BODY-" + channel`. Role pools are stubbed via `serviceRequestRepository.fetchResult(any(), any())` returning a `LinkedHashMap` with key `"user"` → list of user maps (`uuid`, `name`, `mobileNumber`, `countryCode`, `emailId`) — this is what `resolveUsersByRole` (NotificationService.java line 966) parses through `mapContactUser`. Anchor: the emission loop is `processConfigDriven` (line 855); contact-presence gate is line 894 (`!StringUtils.hasText(recipient.phone) && !StringUtils.hasText(recipient.email)`); the internal-user swap needs `config.getUserHost()`/`getUserSearchEndpoint()` stubbed to any string and `getInternalMicroserviceUser` satisfied — mirror how `NotificationConfigDrivenEmissionTest.roleAudience_fansOutToPool_oneEventPerPoolMember` already stubs this (open that test and copy its stubbing verbatim).
- **Tests**:
  1. `roleWithZeroHolders_emitsNothing_noException` — router returns one match `GRO|SMS`; user search returns `{"user": []}`; assert `producer.push` never called, no exception.
  2. `zeroHolderRole_doesNotAffect_otherMatches` — matches `[GRO|SMS, CITIZEN|SMS]`, GRO pool empty, citizen present → exactly 1 push, envelope's contact type `CITIZEN`.
  3. `holderWithNoContact_isSkipped_restOfPoolNotified` — pool of 3, one member has neither phone nor email → exactly 2 pushes (line 894 gate).
  4. **BLOCKED (W3)** `phoneOnlyHolder_onEmailRow_isSkippedPerChannel` — match `GRO|EMAIL`, pool member has phone but no email → **after W3** zero pushes for that member; today this test would FAIL (the current gate only drops both-missing). Write it alongside W3, and until then add the pinning twin `phoneOnlyHolder_onEmailRow_currentlyEmits_PINNED` asserting 1 push with a `// TODO W3` comment, so the behavior change is visible in the diff when W3 lands.
  5. `assigneeOnlyTrue_restrictsPoolToAssignee` — match `PGR_LME|SMS` with `assigneeOnly=true` (`new RoutingMatch("PGR_LME","SMS", true)` — check the actual `RoutingMatch` constructor arity in `backend/pgr-services/src/main/java/org/egov/pgr/service/notification/RoutingMatch.java` first); request's `workflow.assignes=[<uuid>]`; stub `fetchUserByUUID` path (it goes through the same `serviceRequestRepository.fetchResult` — differentiate by capturing the request payload: assignee lookup sends `uuid` filter, pool lookup sends `roleCodes`); assert exactly 1 push to the assignee and **no** user search containing `roleCodes` was made (`resolveByAudience` line 951 → `resolveAssignee` line 1026).
  6. `employeeAlias_resolvesAssignee_notRolePool` — match `EMPLOYEE|SMS`; same assertion pattern: 1 push, no `roleCodes` search (line 942–946).
  7. `autoEscalateAndSystem_resolveToEmpty_defensively` — router (mocked) returns matches with audience `AUTO_ESCALATE` and `SYSTEM` → zero pushes (defensive branch line 947, independent of the router's own drop).
  8. `citizenAlsoHoldingRoutedRole_getsOneMessagePerChannel` — matches `[CITIZEN|SMS, GRO|SMS]`; GRO pool contains a member whose uuid equals the citizen's uuid plus one other member → exactly 2 pushes (citizen once, other member once) — cross-**audience** dedupe via the `channel + "|" + recipient.subscriberKey()` key (line 902).
  9. `userSearchFailure_gracefulSkip_othersUnaffected` — `fetchResult` throws for the `roleCodes` call, matches `[GRO|SMS, CITIZEN|SMS]` → 1 push (citizen), no exception (catch at line 997 returns empty; outer catch line 881 guards the rest).
- **Run**: `cd backend/pgr-services && mvn -q test -Dtest=NotificationResolverEdgeCasesTest`

#### PGR-2 (gap G5, P0) — Golden-fixture drift guard · **RUNNABLE NOW**

- **Target file**: `backend/pgr-services/src/test/java/org/egov/pgr/service/notification/SeedFixtureDriftTest.java` (new).
- **Facts (verified 2026-07-02)**: `backend/pgr-services/src/test/resources/notification/seed-routing.json` (33 rows) is **JSON-equal to** `utilities/default-data-handler/src/main/resources/mdmsData-dev/RAINMAKER-PGR/RAINMAKER-PGR.NotificationRouting.json`; `seed-templates.json` (11 rows) is **JSON-equal to the `channel == "SMS"` subset (in file order)** of `.../RAINMAKER-PGR.NotificationTemplate.json` (33 rows). `NotificationGoldenOutputTest` line 47 claims "copied verbatim"; this test makes the claim self-verifying.
- **Tests**: plain JUnit, Jackson `ObjectMapper.readTree`:
  1. `routingFixture_equalsAuthoritativeSeed` — read the fixture from the classpath and the seed via relative path `Paths.get("..", "..", "utilities", "default-data-handler", "src", "main", "resources", "mdmsData-dev", "RAINMAKER-PGR", "RAINMAKER-PGR.NotificationRouting.json")` (surefire's working directory is the module dir `backend/pgr-services`). Wrap in `Assumptions.assumeTrue(Files.exists(seedPath), "monorepo layout not present — skipping drift guard")` so a packaged build outside the monorepo skips instead of failing. Assert `JsonNode` equality (Jackson `equals` is order-sensitive for arrays, which is what we want).
  2. `templateFixture_equalsSmsSubsetOfAuthoritativeSeed` — filter the seed array to nodes with `"SMS".equalsIgnoreCase(node.path("channel").asText())`, keeping order; assert equality with the fixture array.
- **Run**: `cd backend/pgr-services && mvn -q test -Dtest=SeedFixtureDriftTest`

#### PGR-3 (gap G12, P1) — MDMS notification-cache semantics · **RUNNABLE NOW** (rewrite trigger noted for W4)

- **Target file**: `backend/pgr-services/src/test/java/org/egov/pgr/util/MDMSUtilsNotificationCacheTest.java` (new).
- **Subject anchors** (`backend/pgr-services/src/main/java/org/egov/pgr/util/MDMSUtils.java`): `notificationRoutingCache`/`notificationTemplateCache` declared at lines 63–64; `getNotificationRouting` (line 101) caches only non-empty results (`if (!fetched.isEmpty()) notificationRoutingCache.put(...)` line 106); `fetchNotificationMaster` (line 124) goes through `serviceRequestRepository.fetchResult(getMdmsSearchUrl(), req)` and a `JsonPath.read`, returning `Collections.emptyList()` on any exception.
- **Harness**: Mockito over `MDMSUtils` with `@Mock ServiceRequestRepository` and `@Mock MultiStateInstanceUtil` (stub `getStateLevelTenant("ke.bomet")` → `"ke"`), plus whatever config mock `getMdmsSearchUrl()` needs (open `MDMSUtils` constructor/fields and mirror; `MDMSUtils` is `@Component` with autowired fields — if fields are not constructor-injected use `ReflectionTestUtils.setField`). Stub `fetchResult` to return an object from which `JsonPath.read(result, "$.MdmsRes[\"RAINMAKER-PGR\"].NotificationRouting")`-style paths extract rows — the simplest is a nested `Map` mirroring an MDMS v1-style response; copy the exact jsonpath constants `MDMS_NOTIFICATION_ROUTING_JSONPATH`/`MDMS_NOTIFICATION_TEMPLATE_JSONPATH` from `backend/pgr-services/src/main/java/org/egov/pgr/util/PGRConstants.java` (grep for them) and shape the map to satisfy them.
- **Tests**:
  1. `nonEmptyResult_isCachedPerStateTenant` — first call returns 2 rows; second call: `fetchResult` verified `times(1)`, same rows returned.
  2. `emptyResult_isNotCached_retriedNextCall` — first call returns empty (or `fetchResult` throws); second call: `fetchResult` verified `times(2)`.
  3. `stalenessUntilRestart_PINNED` — first call returns rows A; re-stub `fetchResult` to return rows B; second call still returns A. Add comment: `// Pins finding #8: configurator MDMS edits are invisible until restart. W4 replaces this with a TTL test (advance a clock past the TTL and assert refetch), mirroring novu-bridge's identify-TTL pattern.`
  4. Same trio for `getNotificationTemplates`.
- **Run**: `cd backend/pgr-services && mvn -q test -Dtest=MDMSUtilsNotificationCacheTest`

#### PGR-4 (gap G20, P2) — Per-recipient locale propagation · **BLOCKED (per-recipient locale is not implemented — finding #13)**

- Current fact: `processConfigDriven` renders once with `locale = config.getNotificationDefaultLocale()` (line 871) and every `ResolvedRecipient` gets that same default (lines 933/967). Until the findings plan implements per-recipient locale, only a pinning test is possible:
- **Add to** `NotificationResolverEdgeCasesTest`: `renderUsesInstanceDefaultLocale_PINNED` — verify `templateRenderer.render(...)` captor's locale argument equals `en_IN` regardless of recipient. When per-recipient locale lands, replace with: recipient carrying `sw_KE` → renderer called with `sw_KE` and the event's `contact.locale == "sw_KE"`.
- **Run**: bundled with PGR-1.

### Layer C — novu-bridge

All pipeline tests mirror `DispatchPipelinePassThroughTest` (its `setUp()` and `smsEvent()` builder are the canonical harness — reuse via copy or a small shared test util class in the same package). After W1 lands, drop the `BaileysSendClient` mock everywhere (the constructor parameter is removed).

#### NB-1 (gap G2, P0) — WHATSAPP with no provider → SKIPPED / `NB_NO_PROVIDER`, never SMS fallback · **BLOCKED (W1)**

- **Target file**: `backend/novu-bridge/src/test/java/org/egov/novubridge/service/DispatchPipelineWhatsappNoProviderTest.java` (new); simultaneously **delete** `DispatchPipelinePassThroughTest.whatsappEvent_routesToBaileys_notNovu` (lines 114–130) and **delete** `backend/novu-bridge/src/test/java/org/egov/novubridge/service/provider/BaileysProviderStrategyTest.java` — these die with W1's Baileys removal.
- **Current anchors being replaced**: `DispatchPipelineService.process()` lines 108–114 (`if ("WHATSAPP".equalsIgnoreCase(channel)) { ... baileysSendClient.send(...) }`) and `NovuBridgeConfiguration.getNovuWorkflowId` lines 117–129, whose `case "SMS": default: return novuWorkflowSms;` silently maps unknown/null channels to the SMS workflow.
- **Tests (assert W1's target behavior)**:
  1. `whatsappEvent_noProvider_isSkipped_withNbNoProviderRow` — build the `smsEvent()` fixture, set channel `WHATSAPP` (and the matching transactionId suffix). With the WHATSAPP-enable gate off (default, e.g. `config.setWhatsappChannelEnabled(false)` — use the exact setter W1 introduces): assert `novuClient.identifyThenTrigger` never called; no exception thrown (a thrown exception would DLQ-spam permanently undeliverable events); `dispatchLogRepository.upsert` captured once with `status="SKIPPED"` and `lastErrorCode="NB_NO_PROVIDER"`; `DispatchResult.novuTriggered == false`.
  2. `whatsappEvent_neverFallsBackToSmsWorkflow` — same event; capture ALL `identifyThenTrigger`/`trigger` interactions on the `NovuClient` mock and assert there are none (the no-SMS-fallback ruling, end of the `backend_baileys_removal` scope: "NEVER fall through to the SMS workflow").
  3. `whatsappEvent_gateEnabled_triggersNovuWhatsappWorkflow` — gate on: assert `identifyThenTrigger` called with channel `WHATSAPP` (the `novu.bridge.workflow.id.whatsapp=complaints-whatsapp` config key survives removal and is resolved inside `NovuClient`).
  4. Re-pin the durable Baileys-test concern: `bareWhatsappAlias_ownedByMetaStrategy` (or whatever W1 decides) — a small test on `NovuProviderStrategyFactory` asserting exactly one strategy `supports("whatsapp")` after removal. Put it in `backend/novu-bridge/src/test/java/org/egov/novubridge/service/provider/ProviderStrategyAliasTest.java`.
- **Run**: `cd backend/novu-bridge && mvn -q test -Dtest=DispatchPipelineWhatsappNoProviderTest,ProviderStrategyAliasTest`

#### NB-2 (gap G6, P1) — Unknown channel → `NB_UNSUPPORTED_CHANNEL`, never the SMS workflow · **BLOCKED (W1)**

- **Target files**: `backend/novu-bridge/src/test/java/org/egov/novubridge/config/NovuBridgeConfigurationChannelMapTest.java` (new) + one pipeline test appended to `DispatchPipelineWhatsappNoProviderTest`.
- **Tests**:
  1. `getNovuWorkflowId_unknownChannel_throwsUnsupported` — `new NovuBridgeConfiguration()` with the three workflow ids set via setters; assert `getNovuWorkflowId("PIGEON")` and `getNovuWorkflowId(null)` throw `CustomException` with code `NB_UNSUPPORTED_CHANNEL` (or return the sentinel W1 chooses — match W1's implementation, the invariant is: **not** `novuWorkflowSms`).
  2. `getNovuWorkflowId_knownChannels_mapCorrectly` — `"SMS"`→sms id, `"EMAIL"`→email id, `"WHATSAPP"`→whatsapp id, case-insensitive.
  3. Pipeline: `pigeonChannelEvent_isRejectedOrSkipped_neverTriggersNovu` — event with channel `PIGEON` (note: `EnvelopeValidator` only requires channel non-blank for pre-rendered events, so `PIGEON` reaches the pipeline — the bridge must defend independently of PGR's router); assert no `identifyThenTrigger` call and either a `CustomException` with `NB_UNSUPPORTED_CHANNEL` (→ DLQ) or a `SKIPPED` row, matching W1's decision; add a comment naming which was chosen.
- **Run**: `cd backend/novu-bridge && mvn -q test -Dtest=NovuBridgeConfigurationChannelMapTest,DispatchPipelineWhatsappNoProviderTest`

#### NB-3 (gap G3, P0) — transactionId redelivery idempotency · split: pinning **RUNNABLE NOW**, pre-send dedupe **BLOCKED (W2)**

- **Target files**: `backend/novu-bridge/src/test/java/org/egov/novubridge/service/DispatchPipelineIdempotencyTest.java` and `backend/novu-bridge/src/test/java/org/egov/novubridge/repository/DispatchLogRepositoryUpsertKeyTest.java` (both new).
- **Tests**:
  1. **RUNNABLE NOW** `redelivery_sameEventTwice_PINNED_retriggersNovu_andUpsertsSameKey` — pipeline test; call `service.process(event, true, null)` twice with the identical event; assert `identifyThenTrigger` called twice (current behavior — safe only because Novu dedupes on transactionId) and both `upsert` captures carry the same `(transactionId, channel, recipientValue)` triple. Comment: `// W2 adds a pre-send SENT-row check; flip this to assert the second call skips delivery.`
  2. **BLOCKED (W2)** `redelivery_withExistingSentRow_skipsProviderSend` — stub the repository query W2 introduces (e.g. `existsSent(txn, channel, recipient)` → true); assert zero provider calls on redelivery and result marked skipped/duplicate.
  3. **RUNNABLE NOW** `upsertSql_usesExtendedConflictKey` — repository test: construct `DispatchLogRepository` with `mock(JdbcTemplate.class)`, real `ObjectMapper`, real `NovuBridgeConfiguration` (set `dispatchLogEnabled=true` — the guard at the top of `upsert()` returns early when false); call `upsert(...)` with a fully-populated `DispatchLogEntry`; capture the SQL string (first arg of `jdbcTemplate.update(String, Object...)`) and assert it contains `ON CONFLICT (transaction_id, channel, recipient_value) DO UPDATE` — pinning the `V20260701000000__extend_dispatch_unique_key.sql` migration key (file at `backend/novu-bridge/src/main/resources/db/migration/main/`). Also assert the recipient_value parameter position carries the entry's value.
  4. **OPTIONAL (only if Docker available in CI)** — a true DB-level test of two recipients coexisting on the same (txn, channel) requires Postgres semantics (`ON CONFLICT` partial support in H2 is unreliable). If added: Testcontainers `postgresql` test-scoped dependency, apply the three migration files with plain JDBC, insert (txnA, SMS, rec1) and (txnA, SMS, rec2) → 2 rows; re-upsert (txnA, SMS, rec1) with new status → still 2 rows, status updated. Guard with `@Tag("docker")` and exclude the tag from the default surefire run. If Docker is not available, skip this — item 3 pins the contract.
- **Run**: `cd backend/novu-bridge && mvn -q test -Dtest=DispatchPipelineIdempotencyTest,DispatchLogRepositoryUpsertKeyTest`

#### NB-4 (gap G7, P1) — Delivery failure persists a FAILED row · **BLOCKED (W2)** with a runnable pinning twin

- **Target file**: `backend/novu-bridge/src/test/java/org/egov/novubridge/service/DispatchPipelineFailureRowTest.java` (new).
- **Current anchor**: `DispatchPipelineService.process()` persists `SKIPPED` (line 82), `RECEIVED` (line 94) and `SENT` (line 131) — nothing persists `FAILED`; a throwing `novuClient.identifyThenTrigger` propagates to `DomainEventConsumer.listen`, which only logs + `publishDlq` (see `backend/novu-bridge/src/main/java/org/egov/novubridge/consumer/DomainEventConsumer.java` lines 38–50).
- **Tests**:
  1. **RUNNABLE NOW** `providerThrows_PINNED_noRowPersisted_exceptionPropagates` — stub `identifyThenTrigger` to throw `CustomException("NB_NOVU_TRIGGER_FAILED", ...)`; assert the exception propagates out of `process` and `dispatchLogRepository.upsert` was **never** called with any status. Comment: `// Pins finding #3 — the Logs screen shows nothing for failed sends. W2 flips this.`
  2. **BLOCKED (W2)** `providerThrows_persistsFailedRow_thenRethrows` — same stub; assert `upsert` captured once with `status="FAILED"` and `lastErrorCode="NB_NOVU_TRIGGER_FAILED"` (message propagated), and the exception is still rethrown (DLQ routing preserved).
  3. **BLOCKED (W2)** `novuNon2xxOrNullResponse_recordsFailed` — stub `identifyThenTrigger` to return a `NovuResponse` with `statusCode=500` (and separately `null`); assert `FAILED` row, not the unconditional `SENT` of today (line 131).
- **Run**: `cd backend/novu-bridge && mvn -q test -Dtest=DispatchPipelineFailureRowTest`

#### NB-5 (gap G10, P1) — Proxy endpoint contract + redaction · **RUNNABLE NOW**

- **Target files**: `backend/novu-bridge/src/test/java/org/egov/novubridge/web/controllers/DispatchLogControllerTest.java` and `IntegrationControllerTest.java` (new, same package as the controllers).
- **Harness**: plain unit tests — construct `new DispatchLogController(mock(DispatchLogRepository.class))` and `new IntegrationController(mock(NovuClient.class))` and call the handler methods directly (no MockMvc needed; the controllers are constructor-injected POJOs).
- **DispatchLogControllerTest**:
  1. `missingTenantId_returns400` — `logs(null, ...)` and `logs("  ", ...)` → `ResponseEntity` status 400 (guard at line 65).
  2. `filters_arePassedThroughVerbatim` — call with referenceNumber/prefix-flag/transactionId/channel/status; capture `dispatchLogRepository.list(...)` args and assert 1:1 pass-through.
  3. `limit_isClampedTo1..500_default50` — `limit=null`→50, `limit=0`→1, `limit=9999`→500 (line 69); `offset=null`→0, negative→0.
  4. `total_comesFromCountWithSameFilters` — stub `count(...)`→ 1234, assert response `total==1234` and the count call received identical filter args as `list`.
- **IntegrationControllerTest** (redaction — the only safety property on a route that is not auth-gated at Kong on the pilot):
  1. `credentialsAtTopLevel_areMaskedWholesale` — `listIntegrations()` mock returns `{data: [{providerId: "twilio", channel: "sms", credentials: {apiKey: "SECRET", from: "+15550100"}}]}`; assert every value under `credentials` equals `"***"` and `providerId`/`channel` are untouched (`redactCredentials`, IntegrationController.java lines 91–107).
  2. `credentialsNestedInMapsAndLists_areMasked` — integration containing `{meta: {inner: {credentials: {token: "SECRET"}}}, steps: [{credentials: {password: "SECRET"}}]}` → all masked (map recursion line 98, list traversal lines 100/110).
  3. `nullCredentialValues_stayNull` — `{credentials: {apiKey: null}}` → stays `null` (line 128).
  4. `responseNeverContainsKnownSecretMarker` — belt-and-braces: serialize the full response with Jackson and assert the string `"SECRET"` does not appear anywhere.
  5. `credentialsAsList_PINNED_gap` — `{credentials: [{apiKey: "SECRET"}]}` — the `value instanceof Map` guard (line 96) does NOT mask this shape today; pin whichever behavior exists after the findings plan's redaction hardening (allowlist) — if unhardened, assert the leak WITH a `// KNOWN GAP` comment so it can't regress silently into a release unnoticed.
  6. `emptyOrMalformedNovuEnvelope_yieldsEmptyList` — `listIntegrations` returns null body / `{data: "not-a-list"}` → `data=[]`, `total=0` (`extractIntegrations` lines 68–82).
- **Run**: `cd backend/novu-bridge && mvn -q test -Dtest=DispatchLogControllerTest,IntegrationControllerTest`

#### NB-6 (gap G11, P1) — Consent-gate flag matrix · **RUNNABLE NOW**

- **Target file**: `backend/novu-bridge/src/test/java/org/egov/novubridge/service/PreferenceGateMatrixTest.java` (new).
- **Subject**: real `PreferenceServiceClient` (constructor: `(RestTemplate, NovuBridgeConfiguration)`) with `mock(RestTemplate.class)`; flag property `novu.bridge.preference.enabled` (`NovuBridgeConfiguration` line 42; compose ships it **false** — `local-setup/docker-compose.egov-digit.yaml` line 2165 `NOVU_BRIDGE_PREFERENCE_ENABLED: ${...:-false}` — while the Java default is `true`; pin both facts).
- **Tests** (behavior verified in `PreferenceServiceClient.isChannelAllowed`, lines 28–104):
  1. `gateOff_allowsWithoutConsultingService` — `config.setPreferenceEnabled(false)`; assert `true` returned and `restTemplate.exchange` never called (line 33).
  2. `gateOn_grantedConsent_allows` — enabled; stub exchange → 200 with body `{preferences: [{payload: {consent: {SMS: {status: "GRANTED"}}}}]}` → `true`.
  3. `gateOn_missingConsentOrNotGranted_denies` — empty preferences list / null payload / consent map missing the channel / `status != GRANTED` → all `false` (the cascade of guards, lines 58–94).
  4. `gateOn_serviceUnreachable_failsClosed_PINNED` — stub exchange to throw `ResourceAccessException` → `false` (catch at line 100 returns false). **This pins fail-closed as the current outage posture** — comment: `// Rollout decision (design doc Open item 4): if the team chooses fail-open, this test is the one to flip.`
  5. `gateOn_blankUserId_denies` — line 37.
  6. Pipeline integration (already half-covered by `preferenceDenied_skipsDelivery_andLogsSkipped`): add `preferenceDenied_persistsSkippedRow_withPreferenceDeniedCode` to the pipeline harness asserting the upsert carries `status="SKIPPED"`, `lastErrorCode="NB_PREFERENCE_DENIED"` (DispatchPipelineService line 82) — the existing test doesn't inspect the log row.
- **Run**: `cd backend/novu-bridge && mvn -q test -Dtest=PreferenceGateMatrixTest`

#### NB-7 (gap G13, P1) — Envelope negatives through the pipeline · **RUNNABLE NOW**

- **Target file**: `backend/novu-bridge/src/test/java/org/egov/novubridge/service/EnvelopePipelineNegativesTest.java` (new).
- **Subject**: real `EnvelopeValidator` (already instantiated real in the pass-through harness but only ever fed valid events). Contract at `backend/novu-bridge/src/main/java/org/egov/novubridge/service/EnvelopeValidator.java`: pre-rendered events (contact present or renderedBody non-blank) require `channel`, `renderedBody`, `subscriberId`; all events require `eventId`/`eventType`/`eventName`/`tenantId`; legacy events require `workflow.toState`.
- **Tests** — for each mutation of the valid `smsEvent()` fixture: blank `renderedBody` (with contact still present), blank `subscriberId`, blank `channel`, null contact + blank renderedBody + no workflow block, blank tenantId:
  - assert `service.process(event, true, null)` throws `CustomException` with code `NB_INVALID_EVENT` (or `NB_SUBSCRIBER_ID_MISSING` for the post-validator subscriber guard at DispatchPipelineService line 67);
  - assert **no** provider call and **no** `upsert` (today validation throws before any persist — pin that; if the findings plan later adds an INVALID log row, flip the upsert assertion to expect `status="INVALID"`).
- **Run**: `cd backend/novu-bridge && mvn -q test -Dtest=EnvelopePipelineNegativesTest`

#### NB-8 (gap G19, P2, optional) — Kafka wiring · **RUNNABLE NOW** (needs one test-scoped dependency)

- **Target file**: `backend/novu-bridge/src/test/java/org/egov/novubridge/consumer/DomainEventConsumerWiringTest.java` (new).
- Minimal version WITHOUT embedded Kafka (do this one): unit-test `DomainEventConsumer.listen(HashMap, topic)` directly — it `mapper.convertValue`s the raw map into `ComplaintsDomainEvent` and calls `dispatchPipelineService.process(event, true, null)`. Feed a `HashMap` shaped like PGR's producer payload (mirror the envelope asserted in `NotificationConfigDrivenEmissionTest`: eventId/eventName/tenantId/channel/subscriberId/contact/renderedBody/transactionId/data) with a real `ObjectMapper`; capture the `ComplaintsDomainEvent` and assert all fields survived the map→POJO conversion. Also: `processingThrows_publishesDlq` — pipeline mock throws `CustomException`; assert `producer.push(tenant, config.getDlqTopic(), payloadContainingErrorCode)`.
- Full embedded-Kafka version (`spring-kafka-test`) only if the team wants it — it adds a Spring context test that is slow; the unit version above already covers the deserialization glue, which is the actual risk.
- **Run**: `cd backend/novu-bridge && mvn -q test -Dtest=DomainEventConsumerWiringTest`

### Layer D — configurator

#### CFG-1 (gap G8, P1) — Checker against a live-shaped (UUID-nextState) BusinessService · **RUNNABLE NOW**

- **Target file**: extend `configurator/src/resources/workflow-services/validateNotifications.test.ts` (existing, 11 tests — follow its exact style: `describe`/`it`, `template()`/`routing()` override helpers, fixtures as consts).
- **Subject anchors** (`validateNotifications.ts`): `statusByStateUuid` built at lines 123–126 from `state.uuid → state.applicationStatus ?? state.state`; `resolveState` at line 127; the transition set at lines 130–135 keys on `ACTION|resolved-applicationStatus`. Every existing fixture uses symbolic `nextState` strings, so `statusByStateUuid` stays empty and the uuid branch is dead in the current suite.
- **New fixture** `PGR_LIVE` (mirror the real workflow-v2 shape):
  ```ts
  const PGR_LIVE: BusinessServiceRecord = {
    businessService: 'PGR',
    states: [
      { uuid: 'uuid-pfa', state: 'PENDINGFORASSIGNMENT', applicationStatus: 'PENDINGFORASSIGNMENT',
        actions: [{ action: 'ASSIGN', nextState: 'uuid-lme', roles: ['GRO'] }] },
      { uuid: 'uuid-lme', state: 'PENDINGATLME', applicationStatus: 'PENDINGATLME',
        actions: [{ action: 'RESOLVE', nextState: 'uuid-res', roles: ['PGR_LME'] }] },
      { uuid: 'uuid-res', state: 'RESOLVED', applicationStatus: 'RESOLVED', actions: [] },
    ],
  };
  ```
- **Tests**:
  1. `R4 does not false-positive on a valid transition when nextState is a UUID` — routing row `{action:'ASSIGN', toState:'PENDINGATLME'}` (keyed by applicationStatus, as the Configure tab writes it) + matching template → zero `transition-exists` findings.
  2. `R4 fires when the routing row stores the raw UUID instead of the status name` — routing row `{action:'ASSIGN', toState:'uuid-lme'}` → exactly one `transition-exists` error (operators must store names; the raw uuid is the regression the resolution exists to prevent).
  3. `R4 fires when the resolved transition set does not contain the pair` — routing row `{action:'ASSIGN', toState:'RESOLVED'}` (a real status, but not ASSIGN's resolved target) → exactly one `transition-exists` error, proving UUID resolution didn't over-broaden the transition set. Additionally, add an action `{action:'GHOST', nextState:'uuid-nowhere'}` (UUID pointing at a missing state) to the fixture and assert a routing row `{action:'GHOST', toState:'PENDINGATLME'}` errors — `resolveState` falls back to the raw uuid (line 127: `statusByStateUuid.get(ns) || ns`), so the transition key becomes `GHOST|UUID-NOWHERE` and never matches a status name.
  4. `full clean config passes against the live shape` — the three valid rows + templates → `[]` (excluding known-benign warns).
- **Run**: `cd configurator && npx vitest run src/resources/workflow-services/validateNotifications.test.ts`

#### CFG-2 (gap G9, P1) — Configure-tab dual-master write path · happy path **RUNNABLE NOW**; failure/re-add paths **BLOCKED (W5)**

- **Target file**: `configurator/src/resources/notification-configure/NotificationConfigure.test.tsx` (new). Vitest + jsdom + Testing Library are already devDependencies (`jsdom`, `@testing-library/react`, `@testing-library/jest-dom` in `configurator/package.json`). Put `// @vitest-environment jsdom` as the first line so the file runs in jsdom regardless of global config.
- **Harness**:
  - Render the exported page component: `import NotificationConfigure from './NotificationConfigure'` (default export at line 784; named export `NotificationConfigure()` at line 540).
  - Wrap in ra-core's `CoreAdminContext` with a mock dataProvider (plain object of `vi.fn()`s) and a fresh `QueryClient`. The component loads, via `useGetList`/`useGetOne` (lines 544–579): `workflow-business-services` (list + one), `notification-routing`, `notification-template`, `access-roles`. Stub `getList`/`getOne` per-resource; return the `PGR_LIVE`-shaped record (states with `uuid` + `applicationStatus`, actions with UUID `nextState` — this doubles as a UUID-resolution smoke test of the write path, since the tab writes `toState` as the resolved status name).
  - Mock the toast surface: `vi.mock('ra-core', async (orig) => ({ ...(await orig()), useNotify: () => notifySpy }))` — partial module mock keeping everything else real.
  - **Avoid the Radix selects entirely** (they need pointer-event polyfills in jsdom): the form defaults `audience` to `ctx.audienceOptions[0]` and `channel` to `'SMS'` (lines 139–140), so a test only needs to click the transition row's `Add` button (button text `Add`, line ~403), type into the body textarea (placeholder `Message body — use {id} {complaint_type} {status} {ulb} {date} tokens`, line ~247), and click the `Save` button (line ~253).
- **Tests**:
  1. **RUNNABLE NOW** `add_createsBothMasters_withResolvedToState` — perform Add→type→Save; assert `dataProvider.create` called twice: once for `notification-routing` with `data` containing `businessService:'PGR'`, `action`, `toState:'PENDINGATLME'` (**the resolved status name, not `uuid-lme`**), default audience, `channel:'SMS'`, `active:true`; once for `notification-template` with `locale:'en_IN'`, the typed `body`, `active:true`.
  2. **BLOCKED (W5)** `add_routingSucceedsTemplateFails_surfacesError_noSuccessToast` — `create` mock resolves for `notification-routing`, rejects for `notification-template`; assert `notifySpy` received the error message and NOT `'Notification added.'`. (Today this cannot pass: `useCreate` without `{ returnPromise: true }` returns react-query's fire-and-forget `mutate` — the `await` at NotificationConfigure lines 181/187 resolves void, the catch at line 192 is dead code, and the success toast at line 190 fires unconditionally. W5 adds `{ returnPromise: true }` to every call.)
  3. **BLOCKED (W5)** `addDuplicateKey_branchesToUpdate_notPhantomCreate` — seed `notification-routing` list with an existing row for the same (audience, channel, action, toState); Save; assert `update` (not `create`) is called for both masters — W5's duplicate-key branch; today the create hits MDMS phantom-200 and the operator's text is silently discarded.
  4. **BLOCKED (W5)** `removeThenReAdd_reactivatesSoftDeletedRow` — seed lists so the chip exists; click the chip's remove button, confirm (`window.confirm` → `vi.spyOn(window, 'confirm').mockReturnValue(true)`); assert `delete` called for both masters (soft-delete via the dataProvider); then re-Add the same key and assert W5's reactivation branch (an `update` carrying `isActive/active: true` against the inactive row id) rather than a doomed `create` colliding on the intact `uniqueIdentifier`.
  5. **BLOCKED (W5)** `editChangingChannel_deactivatesOldPair` — start edit on an existing chip (pencil), and (because selects are hard to drive in jsdom) drive this one at a lower level if W5 extracts the save logic into a testable helper — if W5 exposes e.g. `saveNotificationPair(...)`, test the helper directly: changing the key must create the new pair AND soft-delete `seed.routingId`/`seed.templateId` (today the old pair keeps firing — finding #10). If no helper is extracted, test via component with a pre-seeded editSeed path and skip the select interaction by asserting on the fallback create+delete calls.
- **Run**: `cd configurator && npx vitest run src/resources/notification-configure/NotificationConfigure.test.tsx`
- **Type gate** after any configurator change: `cd configurator && npm run build` (runs `tsc -b`).

### Layer E — live E2E extensions (target: the pilot server, tenant `ke.bomet`)

All E2E work happens in ONE script so the harness (auth, psql helper, poll loop) is shared. **No Baileys delivery testing anywhere** — WhatsApp assertions are about the SKIPPED gate (E2E-5).

#### E2E-0 — Port the script into the repo · **RUNNABLE NOW** (prerequisite for E2E-1…5)

- **Target file**: `local-setup/tests/e2e/notifications/e2e-role-notifications.js` (new directory). `local-setup/tests/e2e/playwright.config.ts` sets `testDir: './specs'`, so nothing under `notifications/` is collected by Playwright; the script is executed with `node` on the target server (it shells out to `docker exec docker-postgres psql ...` for `nb_dispatch_log`/`eg_userrole_v1` reads, so it must run where the compose stack runs).
- Port the existing 197-line server-side script with these changes:
  1. **Secrets out**: employee credentials from `E2E_EMP_USER`/`E2E_EMP_PASS` env (fail fast with a clear message when unset); tenant from `E2E_TENANT` (default `ke.bomet`); Kong URL from `E2E_KONG` (default `http://localhost:18000`).
  2. **Recipient wiring** per §1: `LIVE_DELIVERY`, `LIVE_CITIZEN_PHONE`/`LIVE_CITIZEN_EMAIL` (defaults `+919415787824` / `contact@theflywheel.in` — authorized), `LME_PHONE`/`LME_EMAIL`/`GRO_PHONE`/`GRO_EMAIL` (no defaults — literal placeholders documented in the header comment; skip contact updates when unset).
  3. **Dynamic EXPECT matrix**: replace the hardcoded `EXPECT` object with rows read from the server's own MDMS at startup — `psql` over the MDMS store: `SELECT data FROM eg_mdms_data WHERE schemacode='RAINMAKER-PGR.NotificationRouting' AND isactive=true AND tenantid='<state tenant>'` (verify the exact table/column names once with `\d eg_mdms_data` on the server; MDMS v2 stores the row JSON in a `data` jsonb column). Group active rows by `action` → `[{aud, ch[]}]`. This makes the script correct on both seed lineages (the 11-row splitter policy and the 33-row legacy dev seed — finding #18) and powers E2E-4 for free.
  4. Keep: per-transition polling of `nb_dispatch_log` filtered by `transaction_id LIKE '%:ACTION:%'`, recipient-uuid extraction from the txn (`complaintId:action:toState:tenant:uuid:channel`), role cross-check against `eg_userrole_v1` joined on `(user_id, user_tenantid)`, hard exit-code-1 on failure, full dispatch-log dump at the end. Extend the psql SELECT to include `last_error_code` (needed by E2E-5).
- **Run (on the target server, repo checked out)**: `E2E_EMP_USER=... E2E_EMP_PASS=... node local-setup/tests/e2e/notifications/e2e-role-notifications.js`

#### E2E-1 (gap G14, P2) — REJECT / REOPEN / RATE legs · **RUNNABLE NOW**

- Extend the script with two more complaints (the existing complaint A keeps APPLY→ASSIGN→RESOLVE):
  - **Complaint A continues**: citizen `RATE`s it (workflow action `RATE`, `toState CLOSEDAFTERRESOLUTION`) → assert the dynamic-EXPECT rows for `RATE` where the dispatch rows' txn contains `:RATE:CLOSEDAFTERRESOLUTION:` — this live-tests RATE's toState disambiguation (unit-pinned by `rate_disambiguatesByToState`).
  - **Complaint B**: APPLY → employee `REJECT` (→ `REJECTED`; assert REJECT matrix) → citizen `REOPEN` (→ `PENDINGFORASSIGNMENT`; assert REOPEN matrix).
  - **Complaint C**: APPLY → REJECT → citizen `RATE` (→ `CLOSEDAFTERREJECTION`; assert the other RATE branch).
- On a splitter-seeded tenant these transitions have **zero routing rows** (`PgrWorkflowConfig.json` authors notifications only on APPLY/ASSIGN/RESOLVE — verified) — then the assertion for each leg is the E2E-4 negative (zero new rows); on a legacy-seeded tenant they carry CITIZEN/EMPLOYEE rows (33-row seed, verified). The dynamic EXPECT handles both; log which mode was detected.
- Note: the citizen RATE call needs the rating field on the service/workflow payload — mirror how the UI submits RATE (check `pgr-services` `_update` with `workflow.action='RATE'` and `service.rating`); the citizen token (not employee) must drive RATE/REOPEN.

#### E2E-2 (gap G15, P2) — Multi-holder pool-size completeness · **RUNNABLE NOW** (keep the pool ≤ the egov-user default page size until W3's pagination fix is deployed)

- Before APPLY, count the expected pool directly: `SELECT COUNT(DISTINCT u.uuid) FROM eg_userrole_v1 ur JOIN eg_user u ON u.id=ur.user_id AND u.tenantid=ur.user_tenantid WHERE ur.role_code='PGR_LME' AND u.tenantid='<tenant>' AND u.active=true AND (u.mobilenumber IS NOT NULL OR u.emailid IS NOT NULL)`. If the pool has < 2 holders, provision one more PGR_LME employee via HRMS `_create` (or log a SKIP with instructions).
- After ASSIGN, assert `count(rows where channel=SMS and audience-check(PGR_LME)) == pool count` — **equality, not ≥1** (today's script passes with a single holder).
- Dual-role dedupe live: the ASSIGN actor holds GRO+PGR_LME; assert its uuid appears **exactly once per channel** in the ASSIGN rows.
- **Caveat in-script**: if pool count > 10 (stock egov-user default page size), print a warning that the count assertion is expected to fail until the findings plan's pagination fix (W3) is deployed — do not silently pass.

#### E2E-3 (gap G16, P2) — Novu-side verification · **RUNNABLE NOW**

- After each transition's dispatch rows are found, verify the trigger actually reached Novu and produced a message — closing exactly the observability hole the blank-email bug (v1-origin workflows rendering nothing) hid in:
  - The compose maps novu-api to host port **14002** (`local-setup/docker-compose.egov-digit.yaml`: `ports: "14002:3000"`); endpoint base from env `NOVU_API_URL` (default `http://localhost:14002`), key from env `NOVU_API_KEY` (never committed), header `Authorization: ApiKey <key>`.
  - Query `GET /v1/notifications?transactionId=<txn>` (Novu CE 2.3.0 activity feed; **verify the exact query-param name once against the running instance** — some versions take `transactionIds[]`); fall back to `GET /v1/messages?subscriberId=<subscriberId>&channel=<sms|email>` and match `transactionId` client-side.
  - Assert per SENT dispatch row (SMS/EMAIL only — WHATSAPP is SKIPPED per E2E-5): at least one Novu activity/message exists for the transactionId, and its job/step status is not `failed`, and (for EMAIL) the rendered content is non-empty — a v1-origin workflow silently rendering nothing shows up as an empty/failed step here.
  - Gate with `VERIFY_NOVU=1` so the script still runs on boxes where the Novu API port/key isn't reachable.

#### E2E-4 (gap G17, P2) — Negative: no routing rows → zero dispatch rows · **RUNNABLE NOW**

- Already implied by the dynamic EXPECT: for any exercised transition whose routing-row set is empty, poll for 60s and assert **zero** new `nb_dispatch_log` rows whose txn contains `:<ACTION>:` for that complaint. On a splitter-seeded tenant the REJECT/REOPEN/RATE legs provide this for free; if every exercised transition has rows (legacy seed), the script must still produce one negative: deactivate one routing row via MDMS `_update` (`isActive=false`), **restart pgr-services** (`docker restart pgr-services` — required because of the no-TTL cache, finding #8/PGR-3; re-check this step after W4 lands, a TTL makes the restart a wait instead), drive the transition, assert zero rows, then restore the row + restart again. Keep this branch behind `NEGATIVE_VIA_DEACTIVATION=1` since it mutates server config.

#### E2E-5 (gap G18, P2) — WHATSAPP no-provider hard assertion · **BLOCKED (W1 deployed to the target server)**

- Replace the current warn branch (`} else if (ch === 'WHATSAPP') { warn('...baileys logged out...') }` in `assertTransition`) with a hard assertion:
  1. For every expected `(audience, WHATSAPP)` row: a dispatch row **exists** with `status='SKIPPED'` AND `last_error_code='NB_NO_PROVIDER'` (add `last_error_code` to the SELECT — see E2E-0.4). Missing row OR any other status = failure.
  2. **No SMS fallback**: assert no SMS-channel row exists whose `transaction_id` ends in `:WHATSAPP`, and the count of SMS rows per (recipient, transition) exactly equals the SMS rows in the EXPECT matrix (a WhatsApp body smuggled through the SMS workflow would show up as a surplus SMS row).
- Until W1 is deployed on the target server, keep the warn branch but change its text to reference this plan item (no false green).

---

## 4. Execution order (for the implementing model)

Work in this order — each phase ends with a verify command that must pass before moving on. Never claim a phase done without pasting the passing output.

**Phase 1 — runnable-now unit/contract tests (no production-code dependency):**
1. DDH-1 (splitter golden round-trip) — the single highest-value missing test.
   - Verify: `cd utilities/default-data-handler && mvn -q test`
2. PGR-2 (drift guard), PGR-1 (resolver edges, skipping the W3-blocked sub-case, including the two pinning twins), PGR-3 (cache semantics + staleness pin), PGR-4 pin.
   - Verify: `cd backend/pgr-services && mvn -q test` (must show the pre-existing 32 notification tests + new ones, 0 failures)
3. NB-3 items 1+3 (idempotency pin + upsert-key contract), NB-4 item 1 (failure pin), NB-5 (controllers/redaction), NB-6 (consent matrix), NB-7 (envelope negatives), NB-8 (consumer wiring).
   - Verify: `cd backend/novu-bridge && mvn -q test`
4. CFG-1 (UUID-fixture checker) and CFG-2 item 1 (happy-path dual write).
   - Verify: `cd configurator && npm test && npm run build`

**Phase 2 — tests coupled to findings workstreams (implement in the same PR as the workstream, or immediately after it merges):**
5. With **W1**: NB-1 (incl. deleting `BaileysProviderStrategyTest` and the `whatsappEvent_routesToBaileys_notNovu` test), NB-2. Then flip E2E-5 on the next deploy.
6. With **W2**: NB-3 item 2, NB-4 items 2–3 (and delete/flip their pinning twins).
7. With **W3**: PGR-1 item 4 (per-channel contact filter; flip the pin).
8. With **W4**: rewrite PGR-3 item 3 from staleness-pin to TTL test; simplify E2E-4's restart step.
9. With **W5**: CFG-2 items 2–5.

**Phase 3 — E2E (server-side, after Phase 1 merges; E2E-5 after W1 deploys):**
10. E2E-0 port → run once in non-live mode to confirm parity with the current script (APPLY/ASSIGN/RESOLVE all green, WhatsApp still warn).
11. E2E-1, E2E-2, E2E-4 in one pass; then E2E-3 with `VERIFY_NOVU=1`.
12. LIVE mode dry-run once the owner supplies `<LME_PHONE>`/`<LME_EMAIL>`/`<GRO_PHONE>`/`<GRO_EMAIL>`: `LIVE_DELIVERY=1` with the §1 matrix; the CITIZEN legs (`+919415787824` / `contact@theflywheel.in`) are verifiable immediately.

**Final full-suite gate (all must pass, in one session):**
```bash
cd utilities/default-data-handler && mvn -q test
cd ../../backend/pgr-services      && mvn -q test
cd ../novu-bridge                  && mvn -q test
cd ../../configurator              && npm test && npm run build
# on the target server:
E2E_EMP_USER=... E2E_EMP_PASS=... node local-setup/tests/e2e/notifications/e2e-role-notifications.js
```
Expected end-state counts (Phase 1+2 complete): pgr-services ≥ 32+~14, novu-bridge ≥ 6+~20 (Baileys' 4 deleted, ~20 added), default-data-handler ≥ 5, configurator ≥ 11+~9 vitest, E2E exit code 0 with **zero warnings** (the WhatsApp warn branch is gone post-W1).
