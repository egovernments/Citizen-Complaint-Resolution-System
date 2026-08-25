package org.egov.novubridge.service;

import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.novubridge.repository.DispatchLogRepository;
import org.egov.novubridge.web.models.ComplaintsDomainEvent;
import org.egov.novubridge.web.models.Contact;
import org.egov.novubridge.web.models.DispatchResult;
import org.egov.novubridge.web.models.Stakeholder;
import org.egov.novubridge.web.models.WorkflowInfo;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * NOVU_BRIDGE_DIRECT_CHANNELS: per-channel bypass of Novu entirely. Only channels
 * named in {@code novu.bridge.direct.channels} route to {@link DirectDeliveryService};
 * every other channel (and WHATSAPP always, regardless of what's listed) keeps
 * going through {@link NovuClient} exactly as before. Covers both the PGR
 * pass-through path ({@code process()}) and the OTP path ({@code processOtp()}).
 */
class DispatchPipelineDirectModeTest {

    private EnvelopeValidator envelopeValidator;
    private PreferenceServiceClient preferenceServiceClient;
    private NovuClient novuClient;
    private DispatchLogRepository dispatchLogRepository;
    private NovuBridgeConfiguration config;
    private MdmsServiceClient mdmsServiceClient;
    private DirectDeliveryService directDeliveryService;

    private DispatchPipelineService service;

    @BeforeEach
    void setUp() {
        envelopeValidator = new EnvelopeValidator();
        preferenceServiceClient = mock(PreferenceServiceClient.class);
        novuClient = mock(NovuClient.class);
        dispatchLogRepository = mock(DispatchLogRepository.class);
        config = new NovuBridgeConfiguration();
        config.setChannel("SMS");
        config.setDefaultLocale("en_IN");
        config.setChannelsEnabled(List.of("SMS", "EMAIL", "WHATSAPP"));
        // processOtp() reads this directly (unlike identifyThenTrigger's workflow-id
        // resolution, which lives inside the mocked NovuClient) — must be set or the
        // real call passes null, which the anyString() stub matcher below won't match.
        config.setNovuWorkflowSms("complaints-sms");
        mdmsServiceClient = mock(MdmsServiceClient.class);
        directDeliveryService = mock(DirectDeliveryService.class);

        when(preferenceServiceClient.isChannelAllowed(anyString(), any(), any(), anyString())).thenReturn(true);
        when(novuClient.identifyThenTrigger(anyString(), any(), anyString(), anyString(), any(), anyString(), any(), any(), any()))
                .thenReturn(NovuClient.NovuResponse.builder().statusCode(201).response(Map.of()).build());
        when(novuClient.trigger(anyString(), anyString(), anyString(), any(), anyString(), any()))
                .thenReturn(NovuClient.NovuResponse.builder().statusCode(201).response(Map.of()).build());
        when(directDeliveryService.sendSms(anyString(), anyString(), anyString()))
                .thenReturn(NovuClient.NovuResponse.builder().statusCode(200).response(Map.of()).build());
        when(directDeliveryService.sendEmail(anyString(), anyString(), anyString(), anyString()))
                .thenReturn(NovuClient.NovuResponse.builder().statusCode(200).response(Map.of()).build());

        service = new DispatchPipelineService(envelopeValidator, preferenceServiceClient, novuClient,
                dispatchLogRepository, config, mdmsServiceClient, directDeliveryService);
    }

    private ComplaintsDomainEvent smsEvent() {
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

    private ComplaintsDomainEvent emailEvent() {
        ComplaintsDomainEvent event = smsEvent();
        event.setChannel("EMAIL");
        event.setSubject("Your complaint PGR-001");
        event.setTransactionId("PGR-001:ASSIGN:PENDINGATLME:ke.bomet:uuid-123:EMAIL");
        return event;
    }

    private ComplaintsDomainEvent whatsappEvent() {
        ComplaintsDomainEvent event = smsEvent();
        event.setChannel("WHATSAPP");
        event.setTransactionId("PGR-001:ASSIGN:PENDINGATLME:ke.bomet:uuid-123:WHATSAPP");
        event.setTemplateId("HX00000000000000000000000000000000");
        return event;
    }

    private ComplaintsDomainEvent otpEvent() {
        Map<String, Object> data = new HashMap<>();
        data.put("otp", "123456");
        return ComplaintsDomainEvent.builder()
                .eventId("evt-otp-1").eventType("OTP_SEND")
                .eventName("OTP.SEND").module("OTP").tenantId("ke.bomet")
                // No contact/renderedBody (pre-account) — EnvelopeValidator's legacy branch
                // requires a workflow.toState instead.
                .workflow(WorkflowInfo.builder().action("OTP").toState("SENT").build())
                .stakeholders(List.of(Stakeholder.builder().mobile("+254712345678").build()))
                .transactionId("otp-txn-1")
                .data(data)
                .build();
    }

    @Test
    void smsDirect_routesToDirectDeliveryService_neverTouchesNovu() {
        config.setDirectChannels(List.of("SMS"));

        DispatchResult result = service.process(smsEvent(), true, null);

        assertTrue(result.getNovuTriggered());
        verify(directDeliveryService).sendSms(eq("+254712345678"),
                eq("Dear Jane, your complaint PGR-001 is assigned."),
                eq("PGR-001:ASSIGN:PENDINGATLME:ke.bomet:uuid-123:SMS"));
        verifyNoInteractions(novuClient);
    }

    @Test
    void emailDirect_routesToDirectDeliveryService_neverTouchesNovu() {
        config.setDirectChannels(List.of("EMAIL"));

        DispatchResult result = service.process(emailEvent(), true, null);

        assertTrue(result.getNovuTriggered());
        verify(directDeliveryService).sendEmail(eq("jane@example.com"), eq("Your complaint PGR-001"),
                eq("Dear Jane, your complaint PGR-001 is assigned."),
                eq("PGR-001:ASSIGN:PENDINGATLME:ke.bomet:uuid-123:EMAIL"));
        verifyNoInteractions(novuClient);
    }

    @Test
    void smsNotInDirectList_defaultBehavior_stillRoutesToNovu() {
        // config.directChannels left at its default (empty) — zero behavior change.
        DispatchResult result = service.process(smsEvent(), true, null);

        assertTrue(result.getNovuTriggered());
        verify(novuClient).identifyThenTrigger(anyString(), any(), eq("SMS"), anyString(), any(), anyString(), any(), any(), any());
        verifyNoInteractions(directDeliveryService);
    }

    @Test
    void emailNotInDirectList_whenOnlySmsIsDirect_stillRoutesToNovu() {
        // Mixed mode: SMS direct, EMAIL via Novu — proves the two channels are independently steerable.
        config.setDirectChannels(List.of("SMS"));

        DispatchResult result = service.process(emailEvent(), true, null);

        assertTrue(result.getNovuTriggered());
        verify(novuClient).identifyThenTrigger(anyString(), any(), eq("EMAIL"), anyString(), any(), anyString(), any(), any(), any());
        verifyNoInteractions(directDeliveryService);
    }

    @Test
    void whatsapp_neverGoesDirect_evenWhenListedInDirectChannels() {
        config.setDirectChannels(List.of("SMS", "EMAIL", "WHATSAPP"));

        DispatchResult result = service.process(whatsappEvent(), true, null);

        assertTrue(result.getNovuTriggered());
        verify(novuClient).identifyThenTrigger(anyString(), any(), eq("WHATSAPP"), anyString(), any(), anyString(), any(), any(), any());
        verifyNoInteractions(directDeliveryService);
    }

    @Test
    void otpEvent_smsDirect_routesToDirectDeliveryService_neverTouchesNovu() {
        config.setDirectChannels(List.of("SMS"));

        DispatchResult result = service.process(otpEvent(), true, null);

        assertTrue(result.getNovuTriggered());
        verify(directDeliveryService).sendSms(eq("+254712345678"), anyString(), eq("otp-txn-1"));
        verifyNoInteractions(novuClient);
    }

    @Test
    void otpEvent_default_stillRoutesToNovuTrigger() {
        DispatchResult result = service.process(otpEvent(), true, null);

        assertTrue(result.getNovuTriggered());
        verify(novuClient).trigger(anyString(), anyString(), eq("+254712345678"), any(), eq("otp-txn-1"), any());
        verifyNoInteractions(directDeliveryService);
    }
}
