package org.egov.novubridge.service;

import org.egov.novubridge.service.policy.ChannelPolicyClient;
import org.egov.novubridge.service.provider.ProviderAvailability;

import org.egov.novubridge.service.delivery.DeliveryProviderRegistry;
import org.egov.novubridge.service.delivery.NovuDeliveryProvider;
import org.egov.novubridge.web.models.DispatchLogEntry;
import org.mockito.ArgumentCaptor;

import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.novubridge.repository.DispatchLogRepository;
import org.egov.novubridge.web.models.ComplaintsDomainEvent;
import org.egov.novubridge.web.models.Contact;
import org.egov.tracer.model.CustomException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.times;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.mockito.Mockito.verifyNoInteractions;

/**
 * NB-7: envelope negatives driven through the REAL {@link EnvelopeValidator} via
 * {@code process()}. Every invalid mutation of the valid pre-rendered event throws
 * a {@link CustomException} ({@code NB_INVALID_EVENT}) BEFORE any provider call, and leaves
 * exactly one {@code REJECTED} dispatch-log row carrying the code so the rejection is visible. The one legacy-shape mutation that clears the recipient
 * yields {@code NB_SUBSCRIBER_ID_MISSING} from the post-validator guard.
 */
class EnvelopePipelineNegativesTest {

    private EnvelopeValidator envelopeValidator;
    private PreferenceServiceClient preferenceServiceClient;
    private NovuClient novuClient;
    private DispatchLogRepository dispatchLogRepository;
    private NovuBridgeConfiguration config;

    private DispatchPipelineService service;

    @BeforeEach
    void setUp() {
        envelopeValidator = new EnvelopeValidator(); // real
        preferenceServiceClient = mock(PreferenceServiceClient.class);
        novuClient = mock(NovuClient.class);
        dispatchLogRepository = mock(DispatchLogRepository.class);
        config = new NovuBridgeConfiguration();
        config.setDefaultLocale("en_IN");
        config.setChannelsEnabled(List.of("SMS", "EMAIL"));
        service = new DispatchPipelineService(envelopeValidator, preferenceServiceClient,
                new DeliveryProviderRegistry(config, new ChannelPolicyClient(null, config), new NovuDeliveryProvider(novuClient, config), null),
                new ChannelPolicyClient(null, config), dispatchLogRepository, config,
                new ProviderAvailability(novuClient, config));
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
        // Validation must fail before delivery — but the rejection itself is written down.
        verifyNoInteractions(novuClient);
        ArgumentCaptor<DispatchLogEntry> row = ArgumentCaptor.forClass(DispatchLogEntry.class);
        verify(dispatchLogRepository, times(1)).upsert(row.capture());
        assertEquals("REJECTED", row.getValue().getStatus());
        assertEquals(expectedCode, row.getValue().getLastErrorCode());
        assertNotNull(row.getValue().getTransactionId(), "a REJECTED row still needs its NOT NULL key");
        assertNotNull(row.getValue().getRecipientValue());
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
    void unknownEventType_isRejectedAsUnsupported_notGuessed() {
        ComplaintsDomainEvent event = validEvent();
        event.setEventType("SOMETHING_NEW");
        assertRejected(event, "NB_UNSUPPORTED_EVENT_TYPE");
    }

    @Test
    void futureSchemaVersion_isRejected() {
        ComplaintsDomainEvent event = validEvent();
        event.setSchemaVersion("2");
        assertRejected(event, "NB_UNSUPPORTED_SCHEMA_VERSION");
    }

    @Test
    void schemaVersionOne_orAbsent_isAccepted() {
        ComplaintsDomainEvent versioned = validEvent();
        versioned.setSchemaVersion("1");
        assertDoesNotThrow(() -> envelopeValidator.validate(versioned));
        assertDoesNotThrow(() -> envelopeValidator.validate(validEvent()));
    }

    @Test
    void coreSmsEvent_withThePreRenderedShape_isAccepted() {
        // A second producer registers a type; it does NOT get a special envelope.
        ComplaintsDomainEvent otp = validEvent();
        otp.setEventType("CORE_SMS");
        otp.setEventName("CORE.SMS.OTP");
        otp.setModule("CORE");
        otp.setContact(Contact.builder().type("CITIZEN").phone("+254712345678").build());
        otp.setSubscriberId("ke:+254712345678");
        otp.setRenderedBody("DIGIT: Your one-time login code is 123456.");
        assertDoesNotThrow(() -> envelopeValidator.validate(otp));
    }

    @Test
    void contactMayBeAbsent_butSubscriberAndBodyMayNot() {
        ComplaintsDomainEvent event = validEvent();
        event.setContact(null);
        assertDoesNotThrow(() -> envelopeValidator.validate(event));
        event.setRenderedBody(null);
        assertRejected(event, "NB_INVALID_EVENT");
    }
}
