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
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;

/**
 * <b>Prove the seam, do not assert it.</b>
 *
 * <p>The whole resolution stage runs here with hand-written, in-memory implementations of every
 * SPI, no DIGIT service reachable, no MDMS, no Spring context, and a full set of envelopes comes
 * out. That is the claim "another product can use this box" reduced to something a build can
 * check — and the design said plainly that if this test were hard to write, the seam would be
 * fake.
 *
 * <p>Read it as the onboarding guide it is: a module with no notification code supplies a config
 * repository (four lists), a directory resolver for whatever it calls a group, a locale source and
 * a localization source. It writes no routing logic, no fan-out, no dedupe, no rendering, no
 * gating and no ledger code — those are the box's, and they behave here exactly as they do for
 * PGR.
 */
class StaticRecipientResolverTest {

    private static final String EVENT = "XYZ.LICENCE.RENEWED";

    // ---- a second product's world, in full --------------------------------

    /** Its directory calls them GROUPs, not roles. The box does not care. */
    private static final class GroupResolver implements RecipientResolver {
        @Override
        public String scheme() {
            return "GROUP";
        }

        @Override
        public List<Recipient> resolve(AudienceRef ref, ResolutionContext ctx) {
            if (!"LICENCE_OFFICERS".equals(ref.value())) {
                return Collections.emptyList();
            }
            return List.of(
                    new Recipient("officer-1", "LICENCE_OFFICER", "Ada Nwosu", "+2348012345678",
                            "ada@example.org", null),
                    // Email-only: reachable on EMAIL, contact-gated off SMS, with a row to say so.
                    new Recipient("officer-2", "LICENCE_OFFICER", "Bem Iorwuese", null,
                            "bem@example.org", null));
        }
    }

    private static NotificationConfigRepository config() {
        List<RoutingRow> routing = List.of(
                new RoutingRow("XYZ", EVENT, "ACTOR:holder", "SMS", true),
                new RoutingRow("XYZ", EVENT, "GROUP:LICENCE_OFFICERS", "SMS", true),
                new RoutingRow("XYZ", EVENT, "GROUP:LICENCE_OFFICERS", "EMAIL", true));
        List<TemplateRow> templates = List.of(
                new TemplateRow("XYZ", EVENT, "ACTOR:holder", "SMS", "en_IN", null,
                        "Licence {licence_no} is renewed until {valid_until}.", true),
                new TemplateRow("XYZ", EVENT, "GROUP:LICENCE_OFFICERS", "SMS", "en_IN", null,
                        "{trade_name}: {licence_no} renewed.", true),
                new TemplateRow("XYZ", EVENT, "GROUP:LICENCE_OFFICERS", "EMAIL", "en_IN",
                        "Renewal: {licence_no}", "{trade_name} renewed {licence_no}.", true),
                // The holder's own language, to prove per-recipient locale needs no DIGIT either.
                new TemplateRow("XYZ", EVENT, "ACTOR:holder", "SMS", "sw_KE", null,
                        "Leseni {licence_no} imesasishwa hadi {valid_until}.", true));
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
                return Collections.emptyList();
            }

            @Override
            public List<CatalogueRow> catalogue(String tenantId) {
                return List.of(new CatalogueRow("XYZ", EVENT, "LICENCE", "Licence renewed",
                        List.of(), true));
            }

            @Override
            public ConfigSourceReport describe(String tenantId) {
                return new ConfigSourceReport(tenantId, tenantId);
            }
        };
    }

    private static ThinEvent event() {
        return ThinEvent.builder()
                .kind(ThinEvent.KIND)
                .eventId("11111111-2222-3333-4444-555555555555")
                .eventType("XYZ_LICENCE_EVENT")
                .module("XYZ")
                .eventName(EVENT)
                .entityType("LICENCE")
                .entityId("XYZ-LIC-2026-0042")
                .tenantId("ke.bomet")
                .transactionSeed("XYZ-LIC-2026-0042:RENEWED")
                .actors(Map.of("holder", ActorRef.builder()
                        .userId("holder-9")
                        .type("CITIZEN")
                        .name("Amina Otieno")
                        .phone("+254700111222")
                        .locale("sw_KE")
                        .build()))
                .data(Map.of("licence_no", "XYZ-LIC-2026-0042", "trade_name", "Otieno Hardware"))
                .localized(Map.of("valid_until", "XYZ_VALID_UNTIL_2027"))
                .build();
    }

    private static final class Run {
        final List<NotificationEvent> envelopes = new ArrayList<>();
        final List<DispatchLogEntry> rows = new ArrayList<>();
    }

    private Run run() {
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

        // No hydrator is supplied at all: this product's actors carry their own contact, which is
        // the documented form for a recipient the box cannot look up.
        ActorRecipientResolver actors = new ActorRecipientResolver(null);
        NotificationResolver resolver = new NotificationResolver(
                config(),
                List.of(actors, new EventRecipientsResolver(actors), new GroupResolver()),
                (tenantId, requestInfo) -> Collections.emptyMap(),
                new PlaceholderResolver((tenantId, locale, modules, code, requestInfo) ->
                        "XYZ_VALID_UNTIL_2027".equals(code) ? "31/12/2027" : null),
                new TemplateRenderer("en_IN"),
                pipeline, ledger, "en_IN", 1000);
        resolver.resolve(event(), true);
        return run;
    }

    // ---- the assertions ----------------------------------------------------

    @Test
    @DisplayName("the whole stage runs with no DIGIT service reachable and produces a full envelope set")
    void theStageRunsWithoutDigit() {
        Run run = run();
        assertEquals(4, run.envelopes.size(),
                "holder SMS; officer-1 on SMS and EMAIL; officer-2 on EMAIL only — the email-only "
                        + "officer is contact-gated off the SMS row rather than phantom-sent");

        NotificationEvent holder = envelope(run, "ke.bomet:holder-9", "SMS");
        assertEquals("Leseni XYZ-LIC-2026-0042 imesasishwa hadi 31/12/2027.", holder.getRenderedBody(),
                "the actor's own locale override chose the sw_KE template, and the localization "
                        + "provider filled {valid_until} — neither needed a DIGIT service");
        assertEquals("XYZ-LIC-2026-0042:RENEWED:ke.bomet:holder-9:SMS", holder.getTransactionId());
        assertEquals("XYZ.LICENCE.RENEWED.ACTOR:holder.SMS.sw_KE", holder.getTemplateKey());
        assertEquals("XYZ", holder.getModule());
        assertEquals("XYZ-LIC-2026-0042", holder.getEntityId());
        assertNull(holder.getSubject(), "SMS carries no subject");
    }

    @Test
    @DisplayName("routing, rendering, the contact gate and the ledger all behave exactly as they do for PGR")
    void theBoxBehavesIdenticallyForASecondProduct() {
        Run run = run();

        NotificationEvent email = envelope(run, "ke.bomet:officer-2", "EMAIL");
        assertEquals("Renewal: XYZ-LIC-2026-0042", email.getSubject(),
                "the EMAIL subject is rendered from the same row as the body");
        assertEquals("Otieno Hardware renewed XYZ-LIC-2026-0042.", email.getRenderedBody());

        // The email-only officer on the SMS row: skipped, and written down.
        assertTrue(run.envelopes.stream().noneMatch(e ->
                        "SMS".equals(e.getChannel()) && e.getSubscriberId().endsWith("officer-2")),
                "an officer with no phone must not be phantom-sent an SMS");
        assertEquals(1, run.rows.size(), "and the skip is a visible row, not a log line");
        assertEquals("NB_CONTACT_MISSING", run.rows.get(0).getLastErrorCode());
        assertEquals("SMS", run.rows.get(0).getChannel());
        assertEquals("RESOLVED", run.rows.get(0).getSourcePath());
    }

    @Test
    @DisplayName("an unresolved placeholder keeps its braces, here as anywhere else")
    void anUnresolvedPlaceholderKeepsItsBraces() {
        Run run = run();
        NotificationEvent officerSms = envelope(run, "ke.bomet:officer-1", "SMS");
        assertEquals("Otieno Hardware: XYZ-LIC-2026-0042 renewed.", officerSms.getRenderedBody());
    }

    @Test
    @DisplayName("an audience whose scheme nothing answers for is a row, never a guess")
    void anUnknownSchemeIsNeverGuessed() {
        Run run = new Run();
        DispatchLogRepository ledger = mock(DispatchLogRepository.class);
        doAnswer(invocation -> {
            run.rows.add(invocation.getArgument(0));
            return null;
        }).when(ledger).upsert(any(DispatchLogEntry.class));

        NotificationConfigRepository onlyUnknown = new NotificationConfigRepository() {
            @Override
            public List<RoutingRow> routing(String tenantId) {
                return List.of(new RoutingRow("XYZ", EVENT, "DEPARTMENT:PLANNING", "SMS", true));
            }

            @Override
            public List<TemplateRow> templates(String tenantId) {
                return Collections.emptyList();
            }

            @Override
            public List<ProviderTemplateRow> providerTemplates(String tenantId) {
                return Collections.emptyList();
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
        ActorRecipientResolver actors = new ActorRecipientResolver(null);
        NotificationResolver resolver = new NotificationResolver(onlyUnknown,
                List.of(actors, new EventRecipientsResolver(actors)),
                (tenantId, requestInfo) -> Collections.emptyMap(),
                new PlaceholderResolver(null), new TemplateRenderer("en_IN"),
                mock(DispatchPipelineService.class), ledger, "en_IN", 1000);

        ResolutionOutcome outcome = resolver.resolve(event(), true);
        assertTrue(outcome.getEnvelopes().isEmpty());
        assertEquals("NB_UNKNOWN_AUDIENCE_SCHEME", outcome.getTerminalCode());
        assertEquals(1, run.rows.size());
        assertEquals("NONE", run.rows.get(0).getChannel());
        assertTrue(run.rows.get(0).getLastErrorMessage().contains("DEPARTMENT"),
                "the row must name the scheme nobody answered for");
    }

    private static NotificationEvent envelope(Run run, String subscriberId, String channel) {
        return run.envelopes.stream()
                .filter(e -> subscriberId.equals(e.getSubscriberId()) && channel.equals(e.getChannel()))
                .findFirst()
                .orElseThrow(() -> new AssertionError("no " + channel + " envelope for " + subscriberId
                        + "; got " + run.envelopes.stream()
                        .map(e -> e.getChannel() + " " + e.getSubscriberId()).toList()));
    }
}
