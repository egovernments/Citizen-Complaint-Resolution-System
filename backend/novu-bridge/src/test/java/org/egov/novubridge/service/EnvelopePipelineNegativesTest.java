package org.egov.novubridge.service;

import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.novubridge.repository.DispatchLogRepository;
import org.egov.novubridge.web.models.ComplaintsDomainEvent;
import org.egov.novubridge.web.models.Contact;
import org.egov.novubridge.web.models.WorkflowInfo;
import org.egov.tracer.model.CustomException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;

/**
 * NB-7: envelope negatives driven through the REAL {@link EnvelopeValidator} via
 * {@code process()}. Every invalid mutation of the valid pre-rendered event throws
 * a {@link CustomException} ({@code NB_INVALID_EVENT}) BEFORE any provider call or
 * dispatch-log write. The one legacy-shape mutation that clears the recipient
 * yields {@code NB_SUBSCRIBER_ID_MISSING} from the post-validator guard.
 */
class EnvelopePipelineNegativesTest {

    private EnvelopeValidator envelopeValidator;
    private PreferenceServiceClient preferenceServiceClient;
    private NovuClient novuClient;
    private DispatchLogRepository dispatchLogRepository;
    private NovuBridgeConfiguration config;
    private MdmsServiceClient mdmsServiceClient;

    private DispatchPipelineService service;

    @BeforeEach
    void setUp() {
        envelopeValidator = new EnvelopeValidator(); // real
        preferenceServiceClient = mock(PreferenceServiceClient.class);
        novuClient = mock(NovuClient.class);
        dispatchLogRepository = mock(DispatchLogRepository.class);
        config = new NovuBridgeConfiguration();
        config.setChannel("SMS");
        config.setDefaultLocale("en_IN");
        config.setChannelsEnabled(List.of("SMS", "EMAIL"));
        mdmsServiceClient = mock(MdmsServiceClient.class);
        service = new DispatchPipelineService(envelopeValidator, preferenceServiceClient, novuClient,
                dispatchLogRepository, config, mdmsServiceClient);
    }

    private ComplaintsDomainEvent validEvent() {
        Contact contact = Contact.builder()
                .userId("uuid-123").type("CITIZEN").name("Jane Doe")
                .phone("+254712345678").email("jane@example.com").locale("en_IN")
                .build();
        Map<String, Object> data = new HashMap<>();
        data.put("complaintNo", "PGR-001");
        return ComplaintsDomainEvent.builder()
                .eventId("evt-1").eventType("COMPLAINTS_WORKFLOW_TRANSITIONED")
                .eventName("COMPLAINTS.WORKFLOW.ASSIGN").module("Complaints")
                .entityType("COMPLAINT").entityId("PGR-001").tenantId("ke.bomet")
                .channel("SMS").subscriberId("ke.bomet:uuid-123").contact(contact)
                .renderedBody("Dear Jane, your complaint PGR-001 is assigned.")
                .transactionId("PGR-001:ASSIGN:PENDINGATLME:ke.bomet:uuid-123:SMS")
                .data(data)
                .build();
    }

    private void assertRejected(ComplaintsDomainEvent event, String expectedCode) {
        CustomException ex = assertThrows(CustomException.class, () -> service.process(event, true, null));
        assertEquals(expectedCode, ex.getCode());
        // Validation must fail before delivery and before any dispatch-log write.
        verifyNoInteractions(novuClient);
        verify(dispatchLogRepository, never()).upsert(any());
    }

    @Test
    void blankRenderedBody_withContactPresent_isInvalid() {
        ComplaintsDomainEvent event = validEvent();
        event.setRenderedBody("   ");
        assertRejected(event, "NB_INVALID_EVENT");
    }

    @Test
    void blankSubscriberId_isInvalid() {
        ComplaintsDomainEvent event = validEvent();
        event.setSubscriberId("  ");
        assertRejected(event, "NB_INVALID_EVENT");
    }

    @Test
    void blankChannel_isInvalid() {
        ComplaintsDomainEvent event = validEvent();
        event.setChannel("");
        assertRejected(event, "NB_INVALID_EVENT");
    }

    @Test
    void blankTenantId_isInvalid() {
        ComplaintsDomainEvent event = validEvent();
        event.setTenantId("");
        assertRejected(event, "NB_INVALID_EVENT");
    }

    @Test
    void nullContact_blankBody_noWorkflow_isInvalid() {
        ComplaintsDomainEvent event = validEvent();
        event.setContact(null);
        event.setRenderedBody(null);
        event.setWorkflow(null);   // legacy path needs workflow.toState
        assertRejected(event, "NB_INVALID_EVENT");
    }

    @Test
    void legacyShape_withWorkflow_butNoRecipient_isSubscriberMissing() {
        // Passes envelope validation (legacy event carries workflow.toState) but the
        // derived subscriberId is blank → the post-validator guard rejects it.
        ComplaintsDomainEvent event = validEvent();
        event.setContact(null);
        event.setRenderedBody(null);
        event.setSubscriberId(null);
        event.setWorkflow(WorkflowInfo.builder().action("ASSIGN").toState("PENDINGATLME").build());
        assertRejected(event, "NB_SUBSCRIBER_ID_MISSING");
    }

    @Test
    void validEvent_asControl_doesNotThrow() {
        // Sanity: the un-mutated event is genuinely valid (guards against a false-green
        // suite where every event happens to be rejected for an unrelated reason).
        org.mockito.Mockito.when(preferenceServiceClient.isChannelAllowed(anyString(), any(), any(), anyString()))
                .thenReturn(true);
        org.mockito.Mockito.when(novuClient.identifyThenTrigger(anyString(), any(), anyString(), anyString(), any(), anyString(), any()))
                .thenReturn(NovuClient.NovuResponse.builder().statusCode(201).response(Map.of()).build());
        org.junit.jupiter.api.Assertions.assertDoesNotThrow(() -> service.process(validEvent(), true, null));
    }
}
