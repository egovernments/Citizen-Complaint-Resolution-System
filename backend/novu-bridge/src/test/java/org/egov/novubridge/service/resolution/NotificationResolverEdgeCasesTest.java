package org.egov.novubridge.service.resolution;

import org.egov.novubridge.repository.DispatchLogRepository;
import org.egov.novubridge.service.DispatchPipelineService;
import org.egov.novubridge.service.resolution.config.ConfigSourceReport;
import org.egov.novubridge.service.resolution.config.NotificationConfigRepository;
import org.egov.novubridge.service.resolution.config.NotificationConfigRows.CatalogueRow;
import org.egov.novubridge.service.resolution.config.NotificationConfigRows.ProviderTemplateRow;
import org.egov.novubridge.service.resolution.config.NotificationConfigRows.RoutingRow;
import org.egov.novubridge.service.resolution.config.NotificationConfigRows.TemplateRow;
import org.egov.novubridge.web.models.ActorRef;
import org.egov.novubridge.web.models.DispatchLogEntry;
import org.egov.novubridge.web.models.DispatchResult;
import org.egov.novubridge.web.models.NotificationEvent;
import org.egov.novubridge.web.models.ThinEvent;
import org.egov.tracer.model.CustomException;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;

/**
 * The fan-out's edge cases — the ones that regress silently.
 *
 * <p>Every case here has a twin in {@code pgr-services}'
 * {@code NotificationResolverEdgeCasesTest}, which stays where it is until the producer cutover
 * deletes the code it covers. They are not duplicates: that suite pins the behaviour of the code
 * being replaced, this one pins the behaviour of the code replacing it, and until T8 lands both
 * are live.
 *
 * <p>What makes these the cases worth writing down is that each one FAILS QUIETLY when it breaks.
 * A dedupe that stops working sends a person two messages and nothing looks wrong. A poisoned
 * memo turns one directory blip into a three-channel outage for one event. A contact gate that
 * stops gating produces a {@code SENT} row for a message nobody received.
 */
class NotificationResolverEdgeCasesTest {

    private static final String EVENT = "COMPLAINTS.WORKFLOW.ASSIGN.PENDINGATLME";

    // ---- harness -----------------------------------------------------------

    private static final class Run {
        final List<NotificationEvent> envelopes = new ArrayList<>();
        final List<DispatchLogEntry> rows = new ArrayList<>();
    }

    private Run resolve(List<RoutingRow> routing, List<TemplateRow> templates,
                        List<RecipientResolver> resolvers, ThinEvent event) {
        return resolve(routing, templates, resolvers, event, 1000, Collections.emptyMap());
    }

    private Run resolve(List<RoutingRow> routing, List<TemplateRow> templates,
                        List<RecipientResolver> resolvers, ThinEvent event, int cap,
                        Map<String, String> preferredLocales) {
        Run run = new Run();
        DispatchPipelineService pipeline = mock(DispatchPipelineService.class);
        doAnswer(invocation -> {
            run.envelopes.add(invocation.getArgument(0));
            return DispatchResult.builder().valid(true).build();
        }).when(pipeline).process(any(NotificationEvent.class), anyBoolean(), any(), anyString());
        DispatchLogRepository ledger = mock(DispatchLogRepository.class);
        doAnswer(invocation -> {
            run.rows.add(invocation.getArgument(0));
            return null;
        }).when(ledger).upsert(any(DispatchLogEntry.class));

        new NotificationResolver(repository(routing, templates, Collections.emptyList()), resolvers,
                (tenantId, requestInfo) -> preferredLocales, new PlaceholderResolver(null),
                new TemplateRenderer("en_IN"), pipeline, ledger, "en_IN", cap)
                .resolve(event, true);
        return run;
    }

    private static NotificationConfigRepository repository(List<RoutingRow> routing,
                                                           List<TemplateRow> templates,
                                                           List<ProviderTemplateRow> providerTemplates) {
        return new NotificationConfigRepository() {
            @Override
            public List<RoutingRow> routing(String tenantId) {
                return routing;
            }

            @Override
            public List<TemplateRow> templates(String tenantId) {
                return templates;
            }

            @Override
            public List<ProviderTemplateRow> providerTemplates(String tenantId) {
                return providerTemplates;
            }

            @Override
            public List<CatalogueRow> catalogue(String tenantId) {
                return Collections.emptyList();
            }

            @Override
            public ConfigSourceReport describe(String tenantId) {
                return new ConfigSourceReport(tenantId, tenantId);
            }
        };
    }

    private static ThinEvent event() {
        return eventBuilder().build();
    }

    /** The same event with nobody named — the pipe chain's fall-through case. */
    private static ThinEvent eventWithNoActors() {
        return eventBuilder().actors(Collections.emptyMap()).build();
    }

    private static ThinEvent.ThinEventBuilder eventBuilder() {
        return ThinEvent.builder()
                .kind(ThinEvent.KIND).eventId("evt-1").eventType("COMPLAINTS_WORKFLOW_TRANSITIONED")
                .module("Complaints").eventName(EVENT).entityType("COMPLAINT").entityId("PGR-001")
                .tenantId("ke.bomet").transactionSeed("PGR-001:ASSIGN:PENDINGATLME")
                .actors(Map.of("assignee", ActorRef.builder().userId("emp-1").type("EMPLOYEE")
                        .name("Jane").phone("+254700000001").email("jane@example.org").build()))
                .data(Map.of("id", "PGR-001"));
    }

    private static TemplateRow template(String audience, String channel, String locale, String body) {
        return new TemplateRow("Complaints", EVENT, audience, channel, locale, null, body, true);
    }

    private static RecipientResolver role(String code, Recipient... holders) {
        return new RecipientResolver() {
            @Override
            public String scheme() {
                return AudienceRef.ROLE;
            }

            @Override
            public List<Recipient> resolve(AudienceRef ref, ResolutionContext ctx) {
                return code.equals(ref.value()) ? List.of(holders) : Collections.emptyList();
            }
        };
    }

    private static ActorRecipientResolver actorResolver() {
        return new ActorRecipientResolver(null);
    }

    // ---- dedupe ------------------------------------------------------------

    @Test
    @DisplayName("a person holding two notified roles gets ONE message per channel")
    void twoRolesOneMessagePerChannel() {
        Recipient shared = new Recipient("emp-9", "GRO", "Shared", "+254700000009", "s@example.org", null);
        Run run = resolve(
                List.of(new RoutingRow("Complaints", EVENT, "ROLE:GRO", "SMS", true),
                        new RoutingRow("Complaints", EVENT, "ROLE:PGR_LME", "SMS", true),
                        new RoutingRow("Complaints", EVENT, "ROLE:GRO", "EMAIL", true),
                        new RoutingRow("Complaints", EVENT, "ROLE:PGR_LME", "EMAIL", true)),
                List.of(template("ROLE:GRO", "SMS", "en_IN", "gro sms"),
                        template("ROLE:PGR_LME", "SMS", "en_IN", "lme sms"),
                        template("ROLE:GRO", "EMAIL", "en_IN", "gro email"),
                        template("ROLE:PGR_LME", "EMAIL", "en_IN", "lme email")),
                List.of(new RecipientResolver() {
                    @Override
                    public String scheme() {
                        return AudienceRef.ROLE;
                    }

                    @Override
                    public List<Recipient> resolve(AudienceRef ref, ResolutionContext ctx) {
                        return List.of(shared);   // the same person holds both roles
                    }
                }),
                event());

        assertEquals(2, run.envelopes.size(),
                "the dedupe key is (channel, subscriberKey) and the AUDIENCE is deliberately not in "
                        + "it: one SMS and one EMAIL, not two of each");
        assertEquals("gro sms", run.envelopes.get(0).getRenderedBody(),
                "the FIRST routing row to reach them wins, which is master order");
        assertEquals("gro email", run.envelopes.get(1).getRenderedBody());
    }

    @Test
    @DisplayName("a missing template on the first row does NOT suppress the second row for the same person")
    void aMissingTemplateDoesNotConsumeTheDedupeKey() {
        Recipient shared = new Recipient("emp-9", "GRO", "Shared", "+254700000009", null, null);
        Run run = resolve(
                List.of(new RoutingRow("Complaints", EVENT, "ROLE:GRO", "SMS", true),
                        new RoutingRow("Complaints", EVENT, "ROLE:PGR_LME", "SMS", true)),
                // Only the SECOND row has a template.
                List.of(template("ROLE:PGR_LME", "SMS", "en_IN", "lme sms")),
                List.of(new RecipientResolver() {
                    @Override
                    public String scheme() {
                        return AudienceRef.ROLE;
                    }

                    @Override
                    public List<Recipient> resolve(AudienceRef ref, ResolutionContext ctx) {
                        return List.of(shared);
                    }
                }),
                event());

        assertEquals(1, run.envelopes.size(), "the key is consumed only after a SUCCESSFUL hand-off");
        assertEquals("lme sms", run.envelopes.get(0).getRenderedBody());
        assertEquals(1, run.rows.size(), "and the first row's failure is visible");
        assertEquals("NB_NO_TEMPLATE", run.rows.get(0).getLastErrorCode());
        assertEquals("SMS", run.rows.get(0).getChannel(),
                "by now the box knows which channel it could not render for");
    }

    // ---- the contact gate --------------------------------------------------

    @Test
    @DisplayName("a phone-only recipient on an EMAIL row is skipped per channel, not per person")
    void phoneOnlyOnAnEmailRow() {
        Recipient phoneOnly = new Recipient("emp-2", "GRO", "Phone Only", "+254700000002", null, null);
        Run run = resolve(
                List.of(new RoutingRow("Complaints", EVENT, "ROLE:GRO", "SMS", true),
                        new RoutingRow("Complaints", EVENT, "ROLE:GRO", "EMAIL", true)),
                List.of(template("ROLE:GRO", "SMS", "en_IN", "sms"),
                        template("ROLE:GRO", "EMAIL", "en_IN", "email")),
                List.of(role("GRO", phoneOnly)), event());

        assertEquals(1, run.envelopes.size(), "the SMS still goes");
        assertEquals("SMS", run.envelopes.get(0).getChannel());
        assertEquals(1, run.rows.size());
        assertEquals("NB_CONTACT_MISSING", run.rows.get(0).getLastErrorCode());
        assertEquals("EMAIL", run.rows.get(0).getChannel());
    }

    @Test
    @DisplayName("a holder with no contact at all is dropped, and the rest of the pool is notified")
    void aContactlessHolderDoesNotStopTheRest() {
        Run run = resolve(
                List.of(new RoutingRow("Complaints", EVENT, "ROLE:GRO", "SMS", true)),
                List.of(template("ROLE:GRO", "SMS", "en_IN", "sms")),
                List.of(role("GRO",
                        new Recipient("emp-3", "GRO", "Silent", null, null, null),
                        new Recipient("emp-4", "GRO", "Reachable", "+254700000004", null, null))),
                event());

        assertEquals(1, run.envelopes.size());
        assertEquals("ke.bomet:emp-4", run.envelopes.get(0).getSubscriberId());
        assertEquals(1, run.rows.size(), "the unreachable holder is written down, not dropped silently");
        assertEquals("NB_CONTACT_MISSING", run.rows.get(0).getLastErrorCode());
    }

    // ---- audiences ---------------------------------------------------------

    @Test
    @DisplayName("a role with zero holders emits nothing and does not disturb the other rows")
    void aZeroHolderRoleDoesNotAffectOthers() {
        Run run = resolve(
                List.of(new RoutingRow("Complaints", EVENT, "ROLE:NOBODY", "SMS", true),
                        new RoutingRow("Complaints", EVENT, "ACTOR:assignee", "SMS", true)),
                List.of(template("ACTOR:assignee", "SMS", "en_IN", "to the assignee")),
                List.of(actorResolver(), role("GRO")), event());

        assertEquals(1, run.envelopes.size());
        assertEquals("to the assignee", run.envelopes.get(0).getRenderedBody());
    }

    @Test
    @DisplayName("the pipe chain: ACTOR:assignee|ROLE:X takes the assignee when there is one")
    void thePipeChainPrefersTheNamedActor() {
        Run run = resolve(
                List.of(new RoutingRow("Complaints", EVENT, "ACTOR:assignee|ROLE:PGR_LME", "SMS", true)),
                List.of(template("ACTOR:assignee|ROLE:PGR_LME", "SMS", "en_IN", "chained")),
                List.of(actorResolver(), role("PGR_LME",
                        new Recipient("lme-1", "PGR_LME", "Pool", "+254700000011", null, null))),
                event());

        assertEquals(1, run.envelopes.size(), "the pool is not searched when the actor answered");
        assertEquals("ke.bomet:emp-1", run.envelopes.get(0).getSubscriberId());
        assertEquals("EMPLOYEE", run.envelopes.get(0).getContact().getType(),
                "the contact says EMPLOYEE while the template stays under the chain's own key");
        assertEquals(EVENT + ".ACTOR:assignee|ROLE:PGR_LME.SMS.en_IN",
                run.envelopes.get(0).getTemplateKey());
    }

    @Test
    @DisplayName("the pipe chain falls through to the pool when the actor is not named")
    void thePipeChainFallsThroughToThePool() {
        Run run = resolve(
                List.of(new RoutingRow("Complaints", EVENT, "ACTOR:assignee|ROLE:PGR_LME", "SMS", true)),
                List.of(template("ACTOR:assignee|ROLE:PGR_LME", "SMS", "en_IN", "chained")),
                List.of(actorResolver(), role("PGR_LME",
                        new Recipient("lme-1", "PGR_LME", "Pool A", "+254700000011", null, null),
                        new Recipient("lme-2", "PGR_LME", "Pool B", "+254700000012", null, null))),
                eventWithNoActors());

        assertEquals(2, run.envelopes.size(),
                "notifying the whole pool beats notifying nobody, which is what assigneeOnly always meant");
        assertEquals("PGR_LME", run.envelopes.get(0).getContact().getType());
    }

    @Test
    @DisplayName("AUTO_ESCALATE and SYSTEM are dropped at routing, as pseudo-audiences always were")
    void pseudoAudiencesAreDropped() {
        Run run = resolve(
                List.of(new RoutingRow("Complaints", EVENT, "AUTO_ESCALATE", "SMS", true),
                        new RoutingRow("Complaints", EVENT, "SYSTEM", "SMS", true)),
                List.of(template("ACTOR:assignee", "SMS", "en_IN", "body")),
                List.of(actorResolver()), event());

        assertTrue(run.envelopes.isEmpty());
        assertEquals(1, run.rows.size());
        assertEquals("NB_NO_ROUTING", run.rows.get(0).getLastErrorCode(),
                "every row was dropped, so as far as the event is concerned nothing routed");
    }

    @Test
    @DisplayName("a routing row on a channel the box cannot deliver is dropped, and the valid one is kept")
    void anUnknownChannelIsDroppedAndTheRestKept() {
        Run run = resolve(
                List.of(new RoutingRow("Complaints", EVENT, "ACTOR:assignee", "PUSH", true),
                        new RoutingRow("Complaints", EVENT, "ACTOR:assignee", "SMS", true)),
                List.of(template("ACTOR:assignee", "SMS", "en_IN", "sms")),
                List.of(actorResolver()), event());

        assertEquals(1, run.envelopes.size());
        assertEquals("SMS", run.envelopes.get(0).getChannel());
    }

    @Test
    @DisplayName("an inactive routing row is ignored")
    void anInactiveRowIsIgnored() {
        Run run = resolve(
                List.of(new RoutingRow("Complaints", EVENT, "ACTOR:assignee", "SMS", false)),
                List.of(template("ACTOR:assignee", "SMS", "en_IN", "sms")),
                List.of(actorResolver()), event());
        assertTrue(run.envelopes.isEmpty());
        assertEquals("NB_NO_ROUTING", run.rows.get(0).getLastErrorCode());
    }

    // ---- failure isolation --------------------------------------------------

    @Test
    @DisplayName("a resolver that THROWS does not poison the memo — the next row tries again")
    void aFailedAudienceDoesNotPoisonTheMemo() {
        AtomicInteger attempts = new AtomicInteger();
        RecipientResolver flaky = new RecipientResolver() {
            @Override
            public String scheme() {
                return AudienceRef.ROLE;
            }

            @Override
            public List<Recipient> resolve(AudienceRef ref, ResolutionContext ctx) {
                if (attempts.incrementAndGet() == 1) {
                    throw new IllegalStateException("egov-user blipped");
                }
                return List.of(new Recipient("emp-5", "GRO", "Later", "+254700000005", null, null));
            }
        };
        Run run = resolve(
                List.of(new RoutingRow("Complaints", EVENT, "ROLE:GRO", "SMS", true),
                        new RoutingRow("Complaints", EVENT, "ROLE:GRO", "WHATSAPP", true)),
                List.of(template("ROLE:GRO", "SMS", "en_IN", "sms"),
                        template("ROLE:GRO", "WHATSAPP", "en_IN", "whatsapp")),
                List.of(flaky), event());

        assertEquals(2, attempts.get(), "the failure was not cached");
        assertEquals(1, run.envelopes.size(), "the second row got its recipients and sent");
        assertEquals("WHATSAPP", run.envelopes.get(0).getChannel());
    }

    // ---- the cap -----------------------------------------------------------

    @Test
    @DisplayName("over the fan-out cap NOTHING is delivered — half a fan-out is worse than none")
    void overTheCapNothingIsDelivered() {
        List<Recipient> pool = new ArrayList<>();
        for (int i = 0; i < 5; i++) {
            pool.add(new Recipient("emp-" + i, "GRO", "H" + i, "+25470000000" + i, null, null));
        }
        Run run = resolve(
                List.of(new RoutingRow("Complaints", EVENT, "ROLE:GRO", "SMS", true)),
                List.of(template("ROLE:GRO", "SMS", "en_IN", "sms")),
                List.of(role("GRO", pool.toArray(new Recipient[0]))), event(), 3, Collections.emptyMap());

        assertTrue(run.envelopes.isEmpty(), "nobody is messaged, because nobody could tell which half went");
        assertEquals(1, run.rows.size());
        assertEquals("NB_RECIPIENT_LIMIT_EXCEEDED", run.rows.get(0).getLastErrorCode());
        assertEquals("NONE", run.rows.get(0).getChannel());
        assertTrue(run.rows.get(0).getLastErrorMessage().contains("5"),
                "the row must say how big the fan-out was, or an operator cannot size the cap");
    }

    // ---- locale ------------------------------------------------------------

    @Test
    @DisplayName("each recipient renders in their own preferred language; the rest get the default")
    void perRecipientLocale() {
        Run run = resolve(
                List.of(new RoutingRow("Complaints", EVENT, "ROLE:GRO", "SMS", true)),
                List.of(template("ROLE:GRO", "SMS", "en_IN", "english"),
                        template("ROLE:GRO", "SMS", "hi_IN", "hindi")),
                List.of(role("GRO",
                        new Recipient("emp-en", "GRO", "En", "+254700000021", null, null),
                        new Recipient("emp-hi", "GRO", "Hi", "+254700000022", null, null))),
                event(), 1000, Map.of("emp-hi", "hi_IN"));

        assertEquals(2, run.envelopes.size());
        assertEquals("english", run.envelopes.get(0).getRenderedBody());
        assertEquals("hindi", run.envelopes.get(1).getRenderedBody());
        assertEquals("hi_IN", run.envelopes.get(1).getContact().getLocale());
        assertEquals(EVENT + ".ROLE:GRO.SMS.hi_IN", run.envelopes.get(1).getTemplateKey());
    }

    @Test
    @DisplayName("a preferred locale with no template falls back to the default — and contact.locale does NOT")
    void theLocaleFallbackKeepsThePreferenceOnTheWire() {
        Run run = resolve(
                List.of(new RoutingRow("Complaints", EVENT, "ROLE:GRO", "SMS", true)),
                List.of(template("ROLE:GRO", "SMS", "en_IN", "english")),
                List.of(role("GRO", new Recipient("emp-fr", "GRO", "Fr", "+254700000023", null, null))),
                event(), 1000, Map.of("emp-fr", "fr_FR"));

        assertEquals("english", run.envelopes.get(0).getRenderedBody());
        assertEquals("fr_FR", run.envelopes.get(0).getContact().getLocale(),
                "contact.locale reports the PREFERENCE; it is not a claim about what was rendered");
        assertEquals(EVENT + ".ROLE:GRO.SMS.en_IN", run.envelopes.get(0).getTemplateKey(),
                "templateKey is the only field that says what was actually rendered");
    }

    // ---- per-EVENT placeholder localization ---------------------------------

    @Test
    @DisplayName("placeholder values are localized ONCE PER EVENT, and two locales share one set")
    void placeholderValuesAreLocalizedOncePerEvent() {
        // A locale-AWARE localization provider, which is the only kind that can see the
        // difference: the golden fixture's world is keyed by module alone, so it cannot.
        LocalizationProvider byLocale = (tenantId, locale, modules, code, requestInfo) ->
                "CS_COMMON_PENDINGATLME".equals(code)
                        ? ("hi_IN".equals(locale) ? "<hindi status>" : "<english status>")
                        : null;

        List<NotificationEvent> envelopes = new ArrayList<>();
        DispatchPipelineService pipeline = mock(DispatchPipelineService.class);
        doAnswer(invocation -> {
            envelopes.add(invocation.getArgument(0));
            return DispatchResult.builder().valid(true).build();
        }).when(pipeline).process(any(NotificationEvent.class), anyBoolean(), any(), anyString());

        ThinEvent event = eventBuilder()
                // The producer's OWN request was in Hindi, so that is the language its placeholder
                // values were built in — and under the thin contract, the language the box
                // resolves its localization codes in.
                .localizationLocale("hi_IN")
                .data(Map.of("id", "PGR-001"))
                .localized(Map.of("status", List.of("CS_COMMON_PENDINGATLME")))
                .localizationModules(List.of("rainmaker-pgr"))
                .build();

        new NotificationResolver(
                repository(List.of(new RoutingRow("Complaints", EVENT, "ROLE:GRO", "SMS", true)),
                        List.of(template("ROLE:GRO", "SMS", "en_IN", "english template: {status}"),
                                template("ROLE:GRO", "SMS", "hi_IN", "hindi template: {status}")),
                        Collections.emptyList()),
                List.of(role("GRO",
                        new Recipient("emp-en", "GRO", "En", "+254700000031", null, null),
                        new Recipient("emp-hi", "GRO", "Hi", "+254700000032", null, null))),
                (tenantId, requestInfo) -> Map.of("emp-hi", "hi_IN"),
                new PlaceholderResolver(byLocale), new TemplateRenderer("en_IN"),
                pipeline, mock(DispatchLogRepository.class), "en_IN", 1000)
                .resolve(event, true);

        assertEquals(2, envelopes.size());
        assertEquals("english template: <hindi status>", envelopes.get(0).getRenderedBody(),
                "the TEMPLATE is per recipient and the VALUES are per event: this recipient reads "
                        + "English and still gets the event's Hindi substituted value");
        assertEquals("hindi template: <hindi status>", envelopes.get(1).getRenderedBody(),
                "both recipients share ONE set of substituted values");

        // Reproducing this is what makes the cutover a move rather than a change. Localizing per
        // recipient is a real improvement and a separate, deliberate decision; acquiring it by
        // accident while relocating code is how a port ships a difference nobody agreed to.
    }

    @Test
    @DisplayName("with no localizationLocale the event's values are resolved in the deployment default")
    void theLocalizationLocaleDefaults() {
        LocalizationProvider byLocale = (tenantId, locale, modules, code, requestInfo) ->
                "CS_COMMON_PENDINGATLME".equals(code) ? "<" + locale + ">" : null;

        List<NotificationEvent> envelopes = new ArrayList<>();
        DispatchPipelineService pipeline = mock(DispatchPipelineService.class);
        doAnswer(invocation -> {
            envelopes.add(invocation.getArgument(0));
            return DispatchResult.builder().valid(true).build();
        }).when(pipeline).process(any(NotificationEvent.class), anyBoolean(), any(), anyString());

        new NotificationResolver(
                repository(List.of(new RoutingRow("Complaints", EVENT, "ROLE:GRO", "SMS", true)),
                        List.of(template("ROLE:GRO", "SMS", "en_IN", "{status}")),
                        Collections.emptyList()),
                List.of(role("GRO", new Recipient("emp-1", "GRO", "X", "+254700000033", null, null))),
                (tenantId, requestInfo) -> Map.of("emp-1", "fr_FR"),
                new PlaceholderResolver(byLocale), new TemplateRenderer("en_IN"),
                pipeline, mock(DispatchLogRepository.class), "en_IN", 1000)
                .resolve(eventBuilder().localized(Map.of("status", List.of("CS_COMMON_PENDINGATLME")))
                        .build(), true);

        assertEquals("<en_IN>", envelopes.get(0).getRenderedBody(),
                "not <fr_FR>: the recipient's preference chooses the TEMPLATE, never the language "
                        + "the event's placeholder values were resolved in");
    }

    // ---- the catalogue ------------------------------------------------------

    @Test
    @DisplayName("an uncatalogued event is REJECTED and thrown, so the DLQ keeps the payload")
    void anUncataloguedEventIsRejected() {
        List<DispatchLogEntry> rows = new ArrayList<>();
        DispatchLogRepository ledger = mock(DispatchLogRepository.class);
        doAnswer(invocation -> {
            rows.add(invocation.getArgument(0));
            return null;
        }).when(ledger).upsert(any(DispatchLogEntry.class));

        NotificationConfigRepository withCatalogue = new NotificationConfigRepository() {
            @Override
            public List<RoutingRow> routing(String tenantId) {
                return List.of(new RoutingRow("Complaints", EVENT, "ACTOR:assignee", "SMS", true));
            }

            @Override
            public List<TemplateRow> templates(String tenantId) {
                return List.of(template("ACTOR:assignee", "SMS", "en_IN", "body"));
            }

            @Override
            public List<ProviderTemplateRow> providerTemplates(String tenantId) {
                return Collections.emptyList();
            }

            @Override
            public List<CatalogueRow> catalogue(String tenantId) {
                return List.of(new CatalogueRow("Complaints", "SOMETHING.ELSE", "COMPLAINT",
                        "Else", List.of(), true));
            }

            @Override
            public ConfigSourceReport describe(String tenantId) {
                return new ConfigSourceReport(tenantId, tenantId);
            }
        };
        NotificationResolver resolver = new NotificationResolver(withCatalogue,
                List.of(actorResolver()), (t, r) -> Collections.emptyMap(),
                new PlaceholderResolver(null), new TemplateRenderer("en_IN"),
                mock(DispatchPipelineService.class), ledger, "en_IN", 1000);

        CustomException thrown = assertThrows(CustomException.class, () -> resolver.resolve(event(), true));
        assertEquals("NB_EVENT_NOT_IN_CATALOGUE", thrown.getCode());
        assertEquals(1, rows.size(), "the rejection is written down BEFORE it is thrown");
        assertEquals("REJECTED", rows.get(0).getStatus());
    }

    @Test
    @DisplayName("a tenant with NO catalogue at all is exempt — that is a server the seeder has not reached")
    void anEmptyCatalogueIsNotAVeto() {
        Run run = resolve(
                List.of(new RoutingRow("Complaints", EVENT, "ACTOR:assignee", "SMS", true)),
                List.of(template("ACTOR:assignee", "SMS", "en_IN", "body")),
                List.of(actorResolver()), event());
        assertEquals(1, run.envelopes.size(),
                "refusing every event on an un-copied tenant would turn a no-manual-migration "
                        + "upgrade into a notification outage");
    }

    // ---- minting ------------------------------------------------------------

    @Test
    @DisplayName("the envelope's transactionId keeps all six segments, in order")
    void theTransactionIdShapeIsIntact() {
        Run run = resolve(
                List.of(new RoutingRow("Complaints", EVENT, "ACTOR:assignee", "SMS", true)),
                List.of(template("ACTOR:assignee", "SMS", "en_IN", "body")),
                List.of(actorResolver()), event());

        NotificationEvent envelope = run.envelopes.get(0);
        assertEquals("PGR-001:ASSIGN:PENDINGATLME:ke.bomet:emp-1:SMS", envelope.getTransactionId());
        assertEquals(6, envelope.getTransactionId().split(":").length,
                "the e2e harness parses six colon-separated parts and reads parts[len-2] as the uuid");
        assertEquals("ke.bomet:emp-1", envelope.getSubscriberId());
        assertNull(envelope.getSubject(), "SMS carries no subject");
    }

    @Test
    @DisplayName("an EMAIL with no template subject falls back to \"Complaint <id>\"")
    void theEmailSubjectFallsBack() {
        Run run = resolve(
                List.of(new RoutingRow("Complaints", EVENT, "ACTOR:assignee", "EMAIL", true)),
                List.of(template("ACTOR:assignee", "EMAIL", "en_IN", "body")),
                List.of(actorResolver()), event());
        assertEquals("Complaint PGR-001", run.envelopes.get(0).getSubject(),
                "Novu's email step rejects a blank subject and drops the whole send");
    }

    @Test
    @DisplayName("a recipient with neither uuid nor phone is dropped silently — no key, no row")
    void aRecipientWithNoKeyIsDropped() {
        Run run = resolve(
                List.of(new RoutingRow("Complaints", EVENT, "ROLE:GRO", "EMAIL", true)),
                List.of(template("ROLE:GRO", "EMAIL", "en_IN", "body")),
                List.of(role("GRO", new Recipient(null, "GRO", "Email only, no uuid", null,
                        "nobody@example.org", null))), event());

        assertTrue(run.envelopes.isEmpty());
        assertTrue(run.rows.isEmpty(),
                "there is no subscriber id to address a row to, and inventing one would make two "
                        + "different people share a row");
    }
}
