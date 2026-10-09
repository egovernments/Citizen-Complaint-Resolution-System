package org.egov.novubridge.service;

import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.novubridge.service.account.NovuAccount;
import org.egov.novubridge.web.models.Contact;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpMethod;
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
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** Every Novu call made for a tenant account carries THAT account's key, and only shared-account config applies to shared. */
class NovuClientAccountTest {

    private static final NovuAccount ACME = new NovuAccount("acme", "org-acme", "env-acme", "acme-key");

    private RestTemplate restTemplate;
    private NovuClient novuClient;

    @BeforeEach
    @SuppressWarnings({"unchecked", "rawtypes"})
    void setUp() {
        restTemplate = mock(RestTemplate.class);
        NovuBridgeConfiguration config = new NovuBridgeConfiguration();
        config.setNovuBaseUrl("http://novu:3000");
        config.setNovuApiKey("shared-key");
        config.setNovuWorkflowSms("complaints-sms");
        config.setNovuWorkflowWhatsapp("complaints-whatsapp");
        config.setWhatsappIntegrationId("twilio-whatsapp-shared");
        config.setIdentifyCacheTtlMs(300_000L);
        novuClient = new NovuClient(restTemplate, config);
        when(restTemplate.exchange(anyString(), any(HttpMethod.class), any(), eq(Map.class)))
                .thenReturn((ResponseEntity) ResponseEntity.ok(Map.of("data", List.of())));
    }

    @SuppressWarnings({"unchecked", "rawtypes"})
    private List<HttpEntity> entities() {
        ArgumentCaptor<HttpEntity> entity = ArgumentCaptor.forClass(HttpEntity.class);
        verify(restTemplate, atLeastOnce()).exchange(anyString(), any(HttpMethod.class), entity.capture(), eq(Map.class));
        return entity.getAllValues();
    }

    @Test
    void aTenantAccountsCallsAuthenticateWithItsOwnKey_neverTheSharedOne() {
        novuClient.listIntegrations(ACME);
        novuClient.createIntegration(ACME, "Jasmin", "jasmin-a", "jasmin", "sms", Map.of("baseUrl", "http://gw"), true);
        novuClient.deleteIntegration(ACME, "i1");
        novuClient.listWorkflows(ACME);
        novuClient.notificationsByTransaction(ACME, "otp-1");

        for (HttpEntity<?> entity : entities()) {
            assertEquals("ApiKey acme-key", entity.getHeaders().getFirst("Authorization"));
        }
    }

    @Test
    void theLegacyMethods_stillUseTheSharedKey() {
        novuClient.listIntegrations();
        assertEquals("ApiKey shared-key", entities().get(0).getHeaders().getFirst("Authorization"));
    }

    @Test
    @SuppressWarnings("unchecked")
    void theDeploymentsWhatsappPin_isNotAppliedInATenantOrganization() {
        novuClient.identifyThenTrigger(ACME, "acme:u1", Contact.builder().phone("+254712345678").build(), "WHATSAPP",
                "body", null, "txn-1", Map.of(), null, null, null);
        Map<String, Object> trigger = (Map<String, Object>) entities().get(1).getBody();
        assertFalse(trigger.containsKey("overrides"), String.valueOf(trigger));

        novuClient.identifyThenTrigger("ke:u1", Contact.builder().phone("+254712345678").build(), "WHATSAPP",
                "body", null, "txn-2", Map.of(), null, null, null);
        Map<String, Object> shared = (Map<String, Object>) entities().get(3).getBody();
        assertTrue(String.valueOf(shared.get("overrides")).contains("twilio-whatsapp-shared"), String.valueOf(shared));
    }

    @Test
    void identify_isCachedPerAccount_soTheSameSubscriberIsCreatedInEachOrganization() {
        Contact contact = Contact.builder().phone("+254712345678").build();
        novuClient.identify("sub-1", contact);
        novuClient.identify(ACME, "sub-1", contact);
        novuClient.identify(ACME, "sub-1", contact);

        verify(restTemplate, times(2)).exchange(eq("http://novu:3000/v1/subscribers"), eq(HttpMethod.POST), any(), eq(Map.class));
    }

    @Test
    void notificationsByTransaction_encodesTheId() {
        novuClient.notificationsByTransaction(ACME, "otp a&b");
        verify(restTemplate).exchange(eq("http://novu:3000/v1/notifications?page=0&limit=10&transactionId=otp+a%26b"),
                eq(HttpMethod.GET), any(), eq(Map.class));
    }
}
