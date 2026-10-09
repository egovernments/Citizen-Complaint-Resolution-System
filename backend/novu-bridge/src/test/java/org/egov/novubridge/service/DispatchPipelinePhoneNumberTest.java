package org.egov.novubridge.service;

import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.novubridge.repository.DispatchLogRepository;
import org.egov.novubridge.service.delivery.DeliveryProviderRegistry;
import org.egov.novubridge.service.delivery.NovuDeliveryProvider;
import org.egov.novubridge.service.policy.ChannelPolicyClient;
import org.egov.novubridge.service.provider.ProviderAvailability;
import org.egov.novubridge.web.models.Contact;
import org.egov.novubridge.web.models.DispatchLogEntry;
import org.egov.novubridge.web.models.NotificationEvent;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.client.RestTemplate;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Field finding (dev deployment, 2026-10-07): the citizen of a complaint APPLY reached Novu as
 * {@code 762061507}, the same citizen from ASSIGN on as {@code +254762061507}. Every phone the
 * pipeline hands a provider is E.164, completed with the tenant's own country code.
 */
class DispatchPipelinePhoneNumberTest {

    private NovuClient novuClient;
    private DispatchLogRepository dispatchLogRepository;
    private NovuBridgeConfiguration config;
    private DispatchPipelineService service;

    @BeforeEach
    @SuppressWarnings({"unchecked", "rawtypes"})
    void setUp() {
        novuClient = mock(NovuClient.class);
        dispatchLogRepository = mock(DispatchLogRepository.class);
        PreferenceServiceClient preferences = mock(PreferenceServiceClient.class);
        when(preferences.isChannelAllowed(anyString(), any(), any(), anyString())).thenReturn(true);
        when(novuClient.identifyThenTrigger(anyString(), any(), anyString(), anyString(), any(), anyString(),
                any(), any(), any(), any()))
                .thenReturn(NovuClient.NovuResponse.builder().statusCode(201).response(Map.of("acknowledged", true)).build());

        config = new NovuBridgeConfiguration();
        config.setDefaultLocale("en_IN");
        config.setChannelsEnabled(List.of("SMS"));
        config.setMdmsHost("http://mdms");
        config.setMdmsSearchPath("/mdms-v2/v2/_search");
        config.setNotificationConfigCacheTtlMs(60_000L);

        RestTemplate mdms = mock(RestTemplate.class);
        when(mdms.exchange(anyString(), eq(HttpMethod.POST), any(HttpEntity.class), eq(Map.class))).thenAnswer(inv -> {
            Map<String, Object> body = (Map<String, Object>) ((HttpEntity) inv.getArgument(2)).getBody();
            String tenant = (String) ((Map<String, Object>) body.get("MdmsCriteria")).get("tenantId");
            List<Object> rows = "kworkspace".equals(tenant)
                    ? List.of(Map.of("isActive", true, "data", Map.of("countryCode", "+254", "default", true,
                            "mobileNumberRegex", "^[17][0-9]{8}$")))
                    : List.of();
            return new ResponseEntity(Map.of("mdms", rows), HttpStatus.OK);
        });

        ChannelPolicyClient policy = new ChannelPolicyClient(null, config);
        service = new DispatchPipelineService(new EnvelopeValidator(), preferences,
                new DeliveryProviderRegistry(config, policy, new NovuDeliveryProvider(novuClient), null),
                policy, dispatchLogRepository, config, new ProviderAvailability(novuClient, config),
                new TenantPhoneNumbers(mdms, config));
    }

    private static NotificationEvent sms(String tenant, String phone) {
        return NotificationEvent.builder()
                .eventId("evt-1").eventType("COMPLAINTS_WORKFLOW_TRANSITIONED")
                .eventName("COMPLAINTS.WORKFLOW.APPLY.PENDINGFORASSIGNMENT").module("Complaints")
                .entityType("COMPLAINT").entityId("KW-PGR-1").tenantId(tenant)
                .channel("SMS").subscriberId("uuid-123")
                .contact(Contact.builder().userId("uuid-123").type("CITIZEN").phone(phone).locale("en_IN").build())
                .renderedBody("body")
                .transactionId("KW-PGR-1:APPLY:PENDINGFORASSIGNMENT:t1:uuid-123:SMS")
                .build();
    }

    private Contact sentContact() {
        ArgumentCaptor<Contact> contact = ArgumentCaptor.forClass(Contact.class);
        verify(novuClient).identifyThenTrigger(anyString(), contact.capture(), eq("SMS"), anyString(), any(),
                anyString(), any(), any(), any(), any());
        return contact.getValue();
    }

    private DispatchLogEntry row() {
        ArgumentCaptor<DispatchLogEntry> row = ArgumentCaptor.forClass(DispatchLogEntry.class);
        verify(dispatchLogRepository).upsert(row.capture());
        return row.getValue();
    }

    @Test
    void aNationalNumber_isSentWithTheTenantsCountryCode() {
        NotificationEvent event = sms("kworkspace", "762061507");

        service.process(event, true, null);

        assertEquals("+254762061507", sentContact().getPhone());
        assertEquals("SENT", row().getStatus());
        assertEquals("762061507", event.getContact().getPhone(), "the event itself is not rewritten");
    }

    @Test
    void anInternationalNumber_isSentAsItIs_atAnyTenant() {
        service.process(sms("kworkspace", "+919415787824"), true, null);

        assertEquals("+919415787824", sentContact().getPhone());
    }

    @Test
    void aNationalNumberWithNoKnownCountryCode_isSkippedVisibly_neverSentAsPlusNational() {
        service.process(sms("norule", "762061507"), true, null);

        DispatchLogEntry row = row();
        assertEquals("SKIPPED", row.getStatus());
        assertEquals("NB_CONTACT_INVALID", row.getLastErrorCode());
        assertTrue(row.getLastErrorMessage().contains("norule"), row.getLastErrorMessage());
        assertFalse(row.getLastErrorMessage().contains("762061507"), "the message carries no full phone");
        verify(novuClient, never()).identifyThenTrigger(anyString(), any(), anyString(), anyString(), any(),
                anyString(), any(), any(), any(), any());
    }

    @Test
    void theDeploymentCodeIsTheLastResort() {
        config.setCoreSmsCountryCode("+255");

        service.process(sms("norule", "0712345678"), true, null);

        assertEquals("+255712345678", sentContact().getPhone());
    }
}
