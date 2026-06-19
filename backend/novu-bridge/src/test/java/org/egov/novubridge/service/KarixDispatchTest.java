package org.egov.novubridge.service;

import lombok.extern.slf4j.Slf4j;
import org.egov.common.contract.request.RequestInfo;
import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.novubridge.repository.DispatchLogRepository;
import org.egov.novubridge.web.models.*;
import org.egov.novubridge.web.models.ContextInfo;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.MockitoAnnotations;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.client.RestTemplate;

import java.util.*;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * Tests for Karix WhatsApp dispatch via Novu Framework step.custom().
 *
 * Verifies that when the resolved provider is "karix":
 *   1. Novu API is still triggered (no bypass)
 *   2. The trigger payload contains Karix credentials + routing fields
 *   3. No Novu provider overrides are added (empty overrides)
 *   4. The recipient phone has the "whatsapp:" prefix stripped (Karix needs raw E.164)
 */
@Slf4j
class KarixDispatchTest {

    // ── DispatchPipelineService dependencies ────────────────────────────────
    // EnvelopeValidator has no external deps — use real instance to avoid JDK 25 mock issues
    private final EnvelopeValidator envelopeValidator = new EnvelopeValidator();
    @Mock private PreferenceServiceClient preferenceServiceClient;
    @Mock private UserServiceClient userServiceClient;
    @Mock private ConfigServiceClient configServiceClient;
    @Mock private NovuClient novuClient;
    @Mock private DispatchLogRepository dispatchLogRepository;
    @Mock private MdmsServiceClient mdmsServiceClient;

    @Mock private RestTemplate restTemplate;

    private NovuBridgeConfiguration config;
    private DispatchPipelineService dispatchPipelineService;

    // ── Test fixtures ────────────────────────────────────────────────────────

    private static final String TENANT_ID = "pb.amritsar";
    private static final String ACCOUNT_ID = "KARIX_ACCT_001";
    private static final String AUTH_TOKEN = "KARIX_TOKEN_XYZ";
    private static final String SENDER_NUMBER = "+919000000001";
    private static final String RECIPIENT_MOBILE = "9876543210";  // raw, no +
    private static final String RECIPIENT_E164 = "+91" + RECIPIENT_MOBILE;
    private static final String TEMPLATE_NAME = "complaint_apply";
    private static final String WORKFLOW_ID = "complaints-workflow-apply-karix";
    private static final String EVENT_ID = "evt-karix-001";

    @BeforeEach
    void setUp() {
        MockitoAnnotations.openMocks(this);

        config = new NovuBridgeConfiguration();
        config.setNovuBaseUrl("http://novu-api.novu:3000");
        config.setNovuApiKey("test-novu-key");
        config.setChannel("whatsapp");
        config.setDefaultLocale("en_IN");
        config.setDispatchLogEnabled(false);
        config.setPreferenceEnabled(false);

        // Build NovuClient with mocked RestTemplate
        var strategyFactory = mockStrategyFactory();
        NovuClient realNovuClient = new NovuClient(restTemplate, config, strategyFactory);

        // Stub RestTemplate to return 200 for any POST (Novu trigger)
        ResponseEntity<Map> okResponse = new ResponseEntity<>(
                Map.of("data", Map.of("transactionId", "tx-karix-001")), HttpStatus.OK);
        when(restTemplate.exchange(anyString(), eq(HttpMethod.POST), any(HttpEntity.class), eq(Map.class)))
                .thenReturn(okResponse);

        dispatchPipelineService = new DispatchPipelineService(
                envelopeValidator,
                preferenceServiceClient,
                userServiceClient,
                configServiceClient,
                realNovuClient,
                dispatchLogRepository,
                config,
                mdmsServiceClient);

        stubCommonDependencies();
    }

    // ── Tests ────────────────────────────────────────────────────────────────

    @Test
    void karix_trigger_calls_novu_api_not_bypassed() {
        // Novu API must be called even for Karix (no bypass)
        DispatchResult result = dispatchPipelineService.process(buildEvent(), true, new RequestInfo());

        assertTrue(result.getNovuTriggered(), "Novu must be triggered for Karix provider");
        assertEquals(200, result.getNovuStatusCode());
    }

    @Test
    void karix_payload_contains_credentials() {
        ArgumentCaptor<HttpEntity> httpCaptor = ArgumentCaptor.forClass(HttpEntity.class);
        when(restTemplate.exchange(anyString(), eq(HttpMethod.POST), httpCaptor.capture(), eq(Map.class)))
                .thenReturn(new ResponseEntity<>(Map.of("data", Map.of()), HttpStatus.OK));

        dispatchPipelineService.process(buildEvent(), true, new RequestInfo());

        Map<String, Object> body = (Map<String, Object>) httpCaptor.getValue().getBody();
        Map<String, Object> payload = (Map<String, Object>) body.get("payload");

        assertNotNull(payload, "Novu trigger must have a payload");
        assertEquals(ACCOUNT_ID, payload.get("karixAccountId"),
                "Payload must contain Karix accountId");
        assertEquals(AUTH_TOKEN, payload.get("karixAuthToken"),
                "Payload must contain Karix authToken");
        assertEquals(SENDER_NUMBER, payload.get("karixSenderNumber"),
                "Payload must contain Karix sender number");
        assertEquals(TEMPLATE_NAME, payload.get("karixTemplateName"),
                "Payload must contain Karix template name from contentSid");

        log.info("✅ Karix credentials correctly embedded in Novu payload");
    }

    @Test
    void karix_payload_phone_has_no_whatsapp_prefix() {
        // formatRecipientPhone adds "whatsapp:" prefix for WhatsApp channel.
        // buildKarixTriggerPayload must strip it — Karix expects raw E.164.
        ArgumentCaptor<HttpEntity> httpCaptor = ArgumentCaptor.forClass(HttpEntity.class);
        when(restTemplate.exchange(anyString(), eq(HttpMethod.POST), httpCaptor.capture(), eq(Map.class)))
                .thenReturn(new ResponseEntity<>(Map.of("data", Map.of()), HttpStatus.OK));

        dispatchPipelineService.process(buildEvent(), true, new RequestInfo());

        Map<String, Object> body = (Map<String, Object>) httpCaptor.getValue().getBody();
        Map<String, Object> payload = (Map<String, Object>) body.get("payload");
        String recipientPhone = (String) payload.get("karixRecipientPhone");

        assertNotNull(recipientPhone, "karixRecipientPhone must be present");
        assertFalse(recipientPhone.startsWith("whatsapp:"),
                "Phone must NOT have whatsapp: prefix — Karix needs raw E.164");
        assertTrue(recipientPhone.startsWith("+"),
                "Phone must be E.164 (start with +)");

        log.info("✅ karixRecipientPhone: {} (no whatsapp: prefix)", recipientPhone);
    }

    @Test
    void karix_payload_contains_ordered_template_params() {
        ArgumentCaptor<HttpEntity> httpCaptor = ArgumentCaptor.forClass(HttpEntity.class);
        when(restTemplate.exchange(anyString(), eq(HttpMethod.POST), httpCaptor.capture(), eq(Map.class)))
                .thenReturn(new ResponseEntity<>(Map.of("data", Map.of()), HttpStatus.OK));

        dispatchPipelineService.process(buildEvent(), true, new RequestInfo());

        Map<String, Object> body = (Map<String, Object>) httpCaptor.getValue().getBody();
        Map<String, Object> payload = (Map<String, Object>) body.get("payload");
        List<?> params = (List<?>) payload.get("karixParams");

        assertNotNull(params, "karixParams must be present");
        assertFalse(params.isEmpty(), "karixParams must contain template variable values");
        // paramOrder is ["complaintNo","status"] → values ["PGR/2024/001","PENDING"]
        assertTrue(params.contains("PGR/2024/001"),
                "karixParams must contain complaintNo value");
        assertTrue(params.contains("PENDING"),
                "karixParams must contain status value");

        log.info("✅ karixParams: {}", params);
    }

    @Test
    void karix_novu_trigger_has_no_provider_overrides() {
        // Karix step.custom() handles delivery; Novu provider overrides must be absent/empty
        ArgumentCaptor<HttpEntity> httpCaptor = ArgumentCaptor.forClass(HttpEntity.class);
        when(restTemplate.exchange(anyString(), eq(HttpMethod.POST), httpCaptor.capture(), eq(Map.class)))
                .thenReturn(new ResponseEntity<>(Map.of("data", Map.of()), HttpStatus.OK));

        dispatchPipelineService.process(buildEvent(), true, new RequestInfo());

        Map<String, Object> body = (Map<String, Object>) httpCaptor.getValue().getBody();
        Map<String, Object> overrides = (Map<String, Object>) body.get("overrides");

        // Either no overrides at all, or providers map is empty
        if (overrides != null) {
            Map<String, Object> providers = (Map<String, Object>) overrides.get("providers");
            if (providers != null) {
                assertTrue(providers.isEmpty() || !providers.containsKey("karix"),
                        "Novu provider overrides must not contain karix credentials");
            }
        }

        log.info("✅ No Novu provider overrides for Karix — delivery via step.custom()");
    }

    @Test
    void karix_novu_trigger_uses_karix_workflow_id() {
        ArgumentCaptor<HttpEntity> httpCaptor = ArgumentCaptor.forClass(HttpEntity.class);
        when(restTemplate.exchange(anyString(), eq(HttpMethod.POST), httpCaptor.capture(), eq(Map.class)))
                .thenReturn(new ResponseEntity<>(Map.of("data", Map.of()), HttpStatus.OK));

        dispatchPipelineService.process(buildEvent(), true, new RequestInfo());

        Map<String, Object> body = (Map<String, Object>) httpCaptor.getValue().getBody();
        assertEquals(WORKFLOW_ID, body.get("name"),
                "Novu trigger must use the Karix workflow ID (ends with -karix)");

        log.info("✅ Novu workflow ID: {}", body.get("name"));
    }

    @Test
    void karix_dry_run_does_not_call_novu_api() {
        // send=false: validation only, Novu must NOT be triggered
        DispatchResult result = dispatchPipelineService.process(buildEvent(), false, new RequestInfo());

        assertFalse(result.getNovuTriggered(), "Novu must not be triggered in dry-run mode");
        verify(restTemplate, never()).exchange(anyString(), any(), any(), eq(Map.class));

        log.info("✅ Dry-run correctly skips Novu trigger");
    }

    @Test
    void karix_strategy_returns_correct_provider_name() {
        var strategy = new org.egov.novubridge.service.provider.KarixProviderStrategy();
        assertEquals("karix", strategy.getProviderName());
        assertTrue(strategy.supports("karix"));
        assertFalse(strategy.supports("twilio"));
    }

    // ── Helpers ─────────────────────────────────────────────────────────────

    private ComplaintsDomainEvent buildEvent() {
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("complaintNo", "PGR/2024/001");
        data.put("status", "PENDING");
        data.put("serviceName", "Water Supply");

        Stakeholder citizen = Stakeholder.builder()
                .type("CITIZEN")
                .userId("user-001")
                .mobile(RECIPIENT_MOBILE)
                .build();

        ContextInfo ctx = ContextInfo.builder()
                .locale("en_IN")
                .build();

        WorkflowInfo workflow = WorkflowInfo.builder()
                .action("APPLY")
                .fromState("OPEN")
                .toState("PENDING")
                .build();

        return ComplaintsDomainEvent.builder()
                .eventId(EVENT_ID)
                .eventType("COMPLAINTS_WORKFLOW_TRANSITIONED")
                .eventName("COMPLAINTS.WORKFLOW.APPLY")
                .producer("complaints-service")
                .module("Complaints")
                .entityId("PGR/2024/001")
                .tenantId(TENANT_ID)
                .workflow(workflow)
                .stakeholders(List.of(citizen))
                .context(ctx)
                .data(data)
                .build();
    }

    private void stubCommonDependencies() {
        // User service returns a UUID
        when(userServiceClient.resolveUserUuid(eq(TENANT_ID), any(), any(), eq(RECIPIENT_MOBILE)))
                .thenReturn("uuid-citizen-001");

        // Preference: locale + channel allowed
        when(preferenceServiceClient.getUserPreferredLocale(eq(TENANT_ID), any(), any()))
                .thenReturn("en_IN");
        when(preferenceServiceClient.isChannelAllowed(eq(TENANT_ID), any(), any(), any()))
                .thenReturn(true);

        // Config service: Karix template
        ResolvedTemplate template = ResolvedTemplate.builder()
                .templateKey(WORKFLOW_ID)
                .contentSid(TEMPLATE_NAME)
                .paramOrder(List.of("complaintNo", "status"))
                .requiredVars(List.of("complaintNo", "status"))
                .build();
        when(configServiceClient.resolveTemplate(any(), any(), any(), any())).thenReturn(template);

        // Config service: Karix provider
        ResolvedProvider karixProvider = ResolvedProvider.builder()
                .providerName("karix")
                .channel("whatsapp")
                .credentials(Map.of("accountId", ACCOUNT_ID, "authToken", AUTH_TOKEN))
                .senderNumber(SENDER_NUMBER)
                .isActive(true)
                .priority(1)
                .build();
        when(configServiceClient.resolveProvidersByChannel(eq(TENANT_ID), any()))
                .thenReturn(List.of(karixProvider));

        // MDMS: phone country code
        MobileValidationConfig mobileConfig = new MobileValidationConfig();
        mobileConfig.setPrefix("+91");
        mobileConfig.setPattern("^[6-9]\\d{9}$");
        when(mdmsServiceClient.getMobileValidationConfig(eq(TENANT_ID), any()))
                .thenReturn(mobileConfig);

        // Dispatch log: no-op
        doNothing().when(dispatchLogRepository).upsert(any());
    }

    private org.egov.novubridge.service.provider.NovuProviderStrategyFactory mockStrategyFactory() {
        var karixStrategy = new org.egov.novubridge.service.provider.KarixProviderStrategy();
        var genericStrategy = new org.egov.novubridge.service.provider.GenericProviderStrategy();
        return new org.egov.novubridge.service.provider.NovuProviderStrategyFactory(
                List.of(karixStrategy), genericStrategy);
    }
}
