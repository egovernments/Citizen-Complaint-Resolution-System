package org.egov.novubridge.web.controllers;

import org.egov.common.contract.request.RequestInfo;
import org.egov.novubridge.repository.DispatchLogRepository;
import org.egov.novubridge.service.DispatchPipelineService;
import org.egov.novubridge.service.resolution.ActorRecipientResolver;
import org.egov.novubridge.service.resolution.EventRecipientsResolver;
import org.egov.novubridge.service.resolution.NotificationResolver;
import org.egov.novubridge.service.resolution.PlaceholderResolver;
import org.egov.novubridge.service.resolution.TemplateRenderer;
import org.egov.novubridge.service.resolution.config.ConfigSourceReport;
import org.egov.novubridge.service.resolution.config.NotificationConfigRepository;
import org.egov.novubridge.service.resolution.config.NotificationConfigRows.CatalogueRow;
import org.egov.novubridge.service.resolution.config.NotificationConfigRows.ProviderTemplateRow;
import org.egov.novubridge.service.resolution.config.NotificationConfigRows.RoutingRow;
import org.egov.novubridge.service.resolution.config.NotificationConfigRows.TemplateRow;
import org.egov.novubridge.util.ResponseInfoFactory;
import org.egov.novubridge.web.filters.ProxyAuthFilter;
import org.egov.novubridge.web.models.ActorRef;
import org.egov.novubridge.web.models.ThinEvent;
import org.egov.novubridge.web.models.ThinEventResolveRequest;
import org.egov.novubridge.web.models.ThinEventResolveResponse;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

import java.util.Collections;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;

/**
 * {@code POST /novu-adapter/v1/dispatch/_resolve} — "what WOULD this event send, and why".
 *
 * <p>The property that makes it worth having is the one asserted hardest here: it writes no ledger
 * row and calls no provider. An operator has to be able to point it at a production tenant with
 * real config and real role pools and learn something, without a single message going out.
 */
class DispatchResolveControllerTest {

    private static final String EVENT = "COMPLAINTS.WORKFLOW.ASSIGN.PENDINGATLME";

    private final DispatchPipelineService pipeline = mock(DispatchPipelineService.class);
    private final DispatchLogRepository ledger = mock(DispatchLogRepository.class);

    private DispatchController controller(List<RoutingRow> routing, List<TemplateRow> templates) {
        NotificationConfigRepository repository = new NotificationConfigRepository() {
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
                return Collections.emptyList();
            }

            @Override
            public ConfigSourceReport describe(String tenantId) {
                return new ConfigSourceReport(tenantId, tenantId);
            }
        };
        ActorRecipientResolver actors = new ActorRecipientResolver(null);
        NotificationResolver resolver = new NotificationResolver(repository,
                List.of(actors, new EventRecipientsResolver(actors)),
                (tenantId, requestInfo) -> Collections.emptyMap(),
                new PlaceholderResolver(null), new TemplateRenderer("en_IN"),
                pipeline, ledger, "en_IN", 1000);
        return new DispatchController(pipeline, resolver, new ResponseInfoFactory());
    }

    private static ThinEventResolveRequest request() {
        return ThinEventResolveRequest.builder()
                .requestInfo(new RequestInfo())
                .event(ThinEvent.builder()
                        .kind(ThinEvent.KIND).eventId("evt-1")
                        .eventType("COMPLAINTS_WORKFLOW_TRANSITIONED").module("Complaints")
                        .eventName(EVENT).entityType("COMPLAINT").entityId("PGR-001")
                        .tenantId("ke.bomet").transactionSeed("PGR-001:ASSIGN:PENDINGATLME")
                        .actors(Map.of("assignee", ActorRef.builder().userId("emp-1").type("EMPLOYEE")
                                .name("Jane").phone("+254700000001").build()))
                        .data(Map.of("id", "PGR-001"))
                        .build())
                .build();
    }

    @Test
    @DisplayName("it returns the envelopes the event would produce — and sends nothing, and writes no row")
    void itResolvesWithoutSendingOrWriting() {
        ResponseEntity<ThinEventResolveResponse> response = controller(
                List.of(new RoutingRow("Complaints", EVENT, "ACTOR:assignee", "SMS", true)),
                List.of(new TemplateRow("Complaints", EVENT, "ACTOR:assignee", "SMS", "en_IN",
                        null, "Complaint {id} is yours.", true)))
                .resolve(request());

        assertEquals(HttpStatus.OK, response.getStatusCode());
        ThinEventResolveResponse body = response.getBody();
        assertEquals(1, body.getEnvelopes().size());
        assertEquals("Complaint PGR-001 is yours.", body.getEnvelopes().get(0).getRenderedBody());
        assertEquals("PGR-001:ASSIGN:PENDINGATLME:ke.bomet:emp-1:SMS",
                body.getEnvelopes().get(0).getTransactionId());

        verifyNoInteractions(pipeline);
        verifyNoInteractions(ledger);
    }

    @Test
    @DisplayName("when it would send nothing it says WHY, which is the whole point of the endpoint")
    void itExplainsSilence() {
        ThinEventResolveResponse body = controller(Collections.emptyList(), Collections.emptyList())
                .resolve(request()).getBody();

        assertTrue(body.getEnvelopes().isEmpty());
        assertEquals("NB_NO_ROUTING", body.getTerminalCode());
        assertFalse(body.getDiagnostics().isEmpty());
        assertTrue(body.getDiagnostics().get(0).contains(EVENT),
                "the diagnostic must name the event that found no routing");
        verifyNoInteractions(ledger);
    }

    @Test
    @DisplayName("a per-recipient skip is a diagnostic too, not an absence to be guessed at")
    void aPerRecipientSkipIsExplained() {
        ThinEventResolveResponse body = controller(
                // The assignee has a phone and no email; the row routes EMAIL.
                List.of(new RoutingRow("Complaints", EVENT, "ACTOR:assignee", "EMAIL", true)),
                List.of(new TemplateRow("Complaints", EVENT, "ACTOR:assignee", "EMAIL", "en_IN",
                        null, "body", true)))
                .resolve(request()).getBody();

        assertTrue(body.getEnvelopes().isEmpty());
        assertTrue(body.getDiagnostics().stream().anyMatch(d -> d.contains("NB_CONTACT_MISSING")),
                "an operator asking 'why did nobody get the email' must be told, not left to infer");
        verifyNoInteractions(ledger);
    }

    @Test
    @DisplayName("the endpoint is on the ADMIN tier, because it returns recipient PII for a whole role")
    void itIsAdminOnly() {
        assertTrue(ProxyAuthFilter.isAdminOnly("/novu-adapter/v1/dispatch/_resolve"),
                "it expands role pools and answers with filled contact blocks — broader than the "
                        + "Logs screen's read tier should hand out");
        assertFalse(ProxyAuthFilter.isAdminOnly("/novu-adapter/v1/dispatch/_validate"),
                "the pre-rendered diagnostics stay where they were");
        assertFalse(ProxyAuthFilter.isAdminOnly("/novu-adapter/v1/config/source"),
                "the config-source report carries counts and schema codes, never row content");
    }
}
