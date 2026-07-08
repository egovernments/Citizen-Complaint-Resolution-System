package org.egov.novubridge.web.controllers;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.egov.novubridge.repository.DispatchLogRepository;
import org.egov.novubridge.service.NovuClient;
import org.egov.novubridge.service.provider.GenericProviderStrategy;
import org.egov.novubridge.service.provider.NovuProviderStrategyFactory;
import org.egov.novubridge.service.provider.TwilioProviderStrategy;
import org.egov.novubridge.web.models.DispatchLogEntry;
import org.egov.novubridge.web.models.ProviderCreateResponse;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.ArgumentMatchers.nullable;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Happy-path coverage of the four {@code /novu-adapter/v1/providers} endpoints
 * (mock {@link NovuClient}, real strategy factory) plus the invariant that
 * operator {@code credentials} never appear in the {@code POST /providers}
 * response — the ALLOWLIST projection drops them.
 */
class ProviderControllerTest {

    private NovuClient novuClient;
    private DispatchLogRepository dispatchLogRepository;
    private ProviderController controller;
    private final ObjectMapper mapper = new ObjectMapper();

    @BeforeEach
    void setUp() {
        novuClient = mock(NovuClient.class);
        dispatchLogRepository = mock(DispatchLogRepository.class);
        GenericProviderStrategy generic = new GenericProviderStrategy();
        TwilioProviderStrategy twilio = new TwilioProviderStrategy();
        NovuProviderStrategyFactory factory =
                new NovuProviderStrategyFactory(List.of(twilio, generic), generic);
        controller = new ProviderController(novuClient, factory, dispatchLogRepository);
    }

    private NovuClient.NovuResponse novuResp(int status, Map<String, Object> body) {
        return NovuClient.NovuResponse.builder().statusCode(status).response(body).build();
    }

    // ---- POST /providers -------------------------------------------------

    @Test
    void createProvider_returnsAllowlistProjection_neverCredentials() throws Exception {
        Map<String, Object> created = new LinkedHashMap<>();
        created.put("_id", "i1");
        created.put("providerId", "twilio");
        created.put("channel", "sms");
        created.put("name", "Twilio SMS");
        created.put("identifier", "twilio-sms");
        created.put("active", true);
        created.put("credentials", Map.of("token", "SECRET", "accountSid", "SECRET"));
        when(novuClient.createIntegration(nullable(String.class), nullable(String.class),
                anyString(), anyString(), nullable(Map.class)))
                .thenReturn(novuResp(201, Map.of("data", created)));

        Map<String, Object> req = new LinkedHashMap<>();
        req.put("channel", "SMS");
        req.put("providerId", "twilio");
        req.put("name", "Twilio SMS");
        req.put("credentials", Map.of("token", "SECRET", "accountSid", "SECRET"));

        ProviderCreateResponse body = controller.createProvider(req).getBody();
        Map<String, Object> data = body.getData();

        assertEquals("i1", data.get("_id"));
        assertEquals("twilio", data.get("providerId"));
        assertEquals("sms", data.get("channel"));
        assertEquals("Twilio SMS", data.get("name"));
        assertFalse(data.containsKey("credentials"), "credentials must never be echoed back");

        String json = mapper.writeValueAsString(body);
        assertFalse(json.contains("SECRET"), "no secret may appear anywhere in the response: " + json);
    }

    @Test
    void createProvider_mapsWhatsappToNovuSmsChannel_andMarksIdentifier() {
        when(novuClient.createIntegration(nullable(String.class), nullable(String.class),
                anyString(), anyString(), nullable(Map.class)))
                .thenReturn(novuResp(201, Map.of("data", Map.of("_id", "i2", "providerId", "twilio"))));

        Map<String, Object> req = new LinkedHashMap<>();
        req.put("channel", "WHATSAPP");
        req.put("providerId", "twilio");
        req.put("name", "Twilio WhatsApp");
        req.put("credentials", Map.of("from", "whatsapp:+14155238886"));

        controller.createProvider(req);

        ArgumentCaptor<String> identifier = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<String> channel = ArgumentCaptor.forClass(String.class);
        verify(novuClient).createIntegration(nullable(String.class), identifier.capture(),
                eq("twilio"), channel.capture(), nullable(Map.class));
        assertEquals("sms", channel.getValue(), "WHATSAPP maps to the Twilio Novu sms channel");
        assertTrue(identifier.getValue().startsWith("whatsapp-"),
                "blank identifier must default to a whatsapp- marker so the UI can derive the channel back");
    }

    @Test
    void createProvider_whatsappKeepsOperatorIdentifier() {
        when(novuClient.createIntegration(nullable(String.class), nullable(String.class),
                anyString(), anyString(), nullable(Map.class)))
                .thenReturn(novuResp(201, Map.of("data", Map.of("_id", "i3", "providerId", "twilio"))));

        Map<String, Object> req = new LinkedHashMap<>();
        req.put("channel", "WHATSAPP");
        req.put("providerId", "twilio");
        req.put("name", "Twilio WhatsApp");
        req.put("identifier", "my-wa-sender");
        req.put("credentials", Map.of("from", "whatsapp:+14155238886"));

        controller.createProvider(req);

        verify(novuClient).createIntegration(nullable(String.class), eq("my-wa-sender"),
                eq("twilio"), anyString(), nullable(Map.class));
    }

    // ---- GET /providers/templates ---------------------------------------

    @Test
    void templates_projectsWorkflowIdAndName() {
        Map<String, Object> wf = new LinkedHashMap<>();
        wf.put("workflowId", "complaints-sms");
        wf.put("name", "Complaints SMS");
        wf.put("steps", List.of(Map.of("type", "sms")));
        when(novuClient.listWorkflows()).thenReturn(novuResp(200, Map.of("data", List.of(wf))));

        Map<String, Object> out = controller.templates("SMS", "twilio").getBody();

        assertEquals(1, out.get("total"));
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> data = (List<Map<String, Object>>) out.get("data");
        assertEquals("complaints-sms", data.get(0).get("workflowId"));
        assertEquals("Complaints SMS", data.get(0).get("name"));
        assertFalse(data.get(0).containsKey("steps"), "only workflowId+name+channels are surfaced");
    }

    @Test
    void templates_filtersByChannelStepTypes() {
        Map<String, Object> sms = new LinkedHashMap<>();
        sms.put("workflowId", "complaints-sms");
        sms.put("name", "Complaints SMS");
        sms.put("stepTypeOverviews", List.of("sms"));
        Map<String, Object> email = new LinkedHashMap<>();
        email.put("workflowId", "complaints-email");
        email.put("name", "Complaints Email");
        email.put("stepTypeOverviews", List.of("email"));
        when(novuClient.listWorkflows()).thenReturn(novuResp(200,
                Map.of("data", Map.of("workflows", List.of(sms, email)))));

        Map<String, Object> out = controller.templates("EMAIL", null).getBody();

        assertEquals(1, out.get("total"), "EMAIL filter must drop the sms-step workflow");
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> data = (List<Map<String, Object>>) out.get("data");
        assertEquals("complaints-email", data.get(0).get("workflowId"));
        assertEquals(List.of("email"), data.get(0).get("channels"));

        // WHATSAPP rides the Twilio sms integration → sms-step workflows.
        Map<String, Object> wa = controller.templates("WHATSAPP", null).getBody();
        assertEquals(1, wa.get("total"));
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> waData = (List<Map<String, Object>>) wa.get("data");
        assertEquals("complaints-sms", waData.get(0).get("workflowId"));
    }

    // ---- POST /providers/verify -----------------------------------------

    @Test
    void verify_matchesByChannelAndProvider_returnsActive() {
        Map<String, Object> integ = new LinkedHashMap<>();
        integ.put("_id", "i1");
        integ.put("providerId", "twilio");
        integ.put("channel", "sms");
        integ.put("active", true);
        when(novuClient.listIntegrations()).thenReturn(novuResp(200, Map.of("data", List.of(integ))));

        Map<String, Object> req = new LinkedHashMap<>();
        req.put("channel", "WHATSAPP"); // maps to sms → matches the Twilio sms integration
        req.put("providerId", "twilio");

        Map<String, Object> out = controller.verify(req).getBody();
        assertEquals(true, out.get("ok"));
        assertEquals(true, out.get("active"));
        assertEquals("integration active", out.get("detail"));
    }

    @Test
    void verify_noMatch_returnsNotOk() {
        when(novuClient.listIntegrations()).thenReturn(novuResp(200, Map.of("data", List.of())));

        Map<String, Object> req = new LinkedHashMap<>();
        req.put("integrationId", "does-not-exist");

        Map<String, Object> out = controller.verify(req).getBody();
        assertEquals(false, out.get("ok"));
        assertEquals(false, out.get("active"));
        assertEquals("no matching integration found", out.get("detail"));
    }

    // ---- POST /providers/test-send --------------------------------------

    @Test
    void testSend_sms_triggersSmsWorkflow_writesTestLog() {
        when(novuClient.trigger(anyString(), anyString(), nullable(String.class),
                nullable(String.class), anyMap(), anyString()))
                .thenReturn(novuResp(201, Map.of("acknowledged", true)));

        Map<String, Object> req = new LinkedHashMap<>();
        req.put("channel", "SMS");
        req.put("to", Map.of("phone", "+15550100"));
        req.put("body", "hello");

        Map<String, Object> out = controller.testSend(req).getBody();
        assertEquals(true, out.get("ok"));
        assertEquals(201, out.get("novuStatus"));
        assertTrue(((String) out.get("transactionId")).startsWith("nb-test-"));

        ArgumentCaptor<String> phone = ArgumentCaptor.forClass(String.class);
        verify(novuClient).trigger(eq("complaints-sms"), anyString(), phone.capture(),
                nullable(String.class), anyMap(), anyString());
        assertEquals("+15550100", phone.getValue());

        ArgumentCaptor<DispatchLogEntry> logged = ArgumentCaptor.forClass(DispatchLogEntry.class);
        verify(dispatchLogRepository).upsert(logged.capture());
        DispatchLogEntry entry = logged.getValue();
        assertEquals("TEST", entry.getEventName());
        assertEquals("TEST", entry.getTemplateKey());
        assertEquals("SMS", entry.getChannel());
        assertEquals("SENT", entry.getStatus());
        assertTrue(entry.getRecipientValue().contains("***"), "recipient must be masked");
        assertFalse(entry.getRecipientValue().contains("15550100"), "raw number must not leak");
    }

    @Test
    void testSend_whatsapp_prefixesPhone_andBuildsTwilioContentOverrides() {
        when(novuClient.trigger(anyString(), anyString(), nullable(String.class), anyMap(),
                anyString(), nullable(Map.class), nullable(String.class)))
                .thenReturn(novuResp(201, Map.of("acknowledged", true)));

        Map<String, Object> req = new LinkedHashMap<>();
        req.put("channel", "WHATSAPP");
        req.put("to", Map.of("phone", "+14155550123"));
        req.put("contentSid", "HX1234567890abcdef1234567890abcdef");
        req.put("variables", List.of("CMP-1", "ASSIGNED"));

        Map<String, Object> out = controller.testSend(req).getBody();
        assertEquals(true, out.get("ok"));

        ArgumentCaptor<String> phone = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<Map> overrides = ArgumentCaptor.forClass(Map.class);
        verify(novuClient).trigger(eq("complaints-sms"), anyString(), phone.capture(), anyMap(),
                anyString(), overrides.capture(), isNull());

        assertEquals("whatsapp:+14155550123", phone.getValue());

        @SuppressWarnings("unchecked")
        Map<String, Object> providers = (Map<String, Object>) overrides.getValue().get("providers");
        @SuppressWarnings("unchecked")
        Map<String, Object> twilio = (Map<String, Object>) providers.get("twilio");
        @SuppressWarnings("unchecked")
        Map<String, Object> passthrough = (Map<String, Object>) twilio.get("_passthrough");
        @SuppressWarnings("unchecked")
        Map<String, Object> body = (Map<String, Object>) passthrough.get("body");
        assertEquals("HX1234567890abcdef1234567890abcdef", body.get("contentSid"));
        assertEquals("{\"1\":\"CMP-1\",\"2\":\"ASSIGNED\"}", body.get("contentVariables"));

        verify(dispatchLogRepository).upsert(any(DispatchLogEntry.class));
    }

    @Test
    void testSend_subscriberIdIsStable_reproducibleAcrossCalls() {
        when(novuClient.trigger(anyString(), anyString(), nullable(String.class),
                nullable(String.class), anyMap(), anyString()))
                .thenReturn(novuResp(201, Map.of()));

        Map<String, Object> req = new LinkedHashMap<>();
        req.put("channel", "SMS");
        req.put("to", Map.of("phone", "+15550100"));

        String txn1 = (String) controller.testSend(req).getBody().get("transactionId");
        String txn2 = (String) controller.testSend(req).getBody().get("transactionId");
        assertEquals(txn1, txn2, "same recipient must yield a reproducible transactionId (no clock/random)");
    }

    @Test
    void testSend_email_passesRecipientEmailToNovu() {
        when(novuClient.trigger(anyString(), anyString(), nullable(String.class),
                nullable(String.class), anyMap(), anyString()))
                .thenReturn(novuResp(201, Map.of("acknowledged", true)));

        Map<String, Object> req = new LinkedHashMap<>();
        req.put("channel", "EMAIL");
        req.put("to", Map.of("email", "operator@example.com"));
        req.put("subject", "test");
        req.put("body", "hello");

        Map<String, Object> out = controller.testSend(req).getBody();
        assertEquals(true, out.get("ok"));

        // to.email MUST reach Novu — the synthetic nb-test-* subscriber has no
        // stored email, so dropping it makes the email step silently deliver nothing.
        ArgumentCaptor<String> email = ArgumentCaptor.forClass(String.class);
        verify(novuClient).trigger(eq("complaints-email"), anyString(), nullable(String.class),
                email.capture(), anyMap(), anyString());
        assertEquals("operator@example.com", email.getValue());
    }
}
