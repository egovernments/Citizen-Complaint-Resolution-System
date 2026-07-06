package org.egov.novubridge.web.controllers;

import lombok.extern.slf4j.Slf4j;
import org.egov.novubridge.repository.DispatchLogRepository;
import org.egov.novubridge.service.NovuClient;
import org.egov.novubridge.service.provider.NovuProviderStrategy;
import org.egov.novubridge.service.provider.NovuProviderStrategyFactory;
import org.egov.novubridge.util.PiiMask;
import org.egov.novubridge.web.models.DispatchLogEntry;
import org.egov.novubridge.web.models.ProviderCreateResponse;
import org.egov.novubridge.web.models.ResolvedProvider;
import org.egov.novubridge.web.models.ResolvedTemplate;
import org.egov.tracer.model.CustomException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.util.StringUtils;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Self-service provider management for the configurator's Notification Providers
 * screen. Sits alongside {@link IntegrationController} and {@code DispatchController}
 * under the same {@code /novu-adapter/v1} namespace, behind the same
 * {@link org.egov.novubridge.web.filters.ProxyAuthFilter} EMPLOYEE+role gate.
 *
 * <p><b>Secrets stay server-side.</b> Novu is the provider/credential store; this
 * service holds only the Novu ApiKey (never exposed to the keyless SPA). Operator
 * credentials entered in the UI POST straight through to Novu over TLS via
 * {@link NovuClient#createIntegration}; they are never persisted here, never logged
 * (only credential key names are), and never echoed back — every response is built
 * by the shared {@link IntegrationProjection} ALLOWLIST (no {@code credentials} key
 * in any shape ever leaves). There is deliberately NO endpoint that returns a raw
 * provider secret or the Novu key.
 *
 * <p>Every {@code /providers/test-send} writes one {@code nb_dispatch_log} row
 * tagged {@code TEST} (event_name/template_key = {@code "TEST"}) with a masked
 * recipient, so live tests are auditable and separable from real traffic.
 */
@RestController
@RequestMapping("/novu-adapter/v1")
@Slf4j
public class ProviderController {

    private static final String NOVU_CHANNEL_SMS = "sms";
    private static final String NOVU_CHANNEL_EMAIL = "email";
    private static final String WORKFLOW_SMS = "complaints-sms";
    private static final String WORKFLOW_EMAIL = "complaints-email";

    private final NovuClient novuClient;
    private final NovuProviderStrategyFactory strategyFactory;
    private final DispatchLogRepository dispatchLogRepository;

    public ProviderController(NovuClient novuClient,
                              NovuProviderStrategyFactory strategyFactory,
                              DispatchLogRepository dispatchLogRepository) {
        this.novuClient = novuClient;
        this.strategyFactory = strategyFactory;
        this.dispatchLogRepository = dispatchLogRepository;
    }

    // ---- POST /providers -------------------------------------------------

    /**
     * Create a Novu provider integration from operator-entered credentials.
     * {@code WHATSAPP} maps to the Twilio {@code sms} Novu channel (WhatsApp is the
     * Twilio SMS integration used with a {@code whatsapp:} sender, not a separate
     * Novu channel). Returns the created integration via the ALLOWLIST projection —
     * never any {@code credentials}.
     */
    @PostMapping("/providers")
    public ResponseEntity<ProviderCreateResponse> createProvider(@RequestBody Map<String, Object> body) {
        String channel = str(body.get("channel"));
        String providerId = str(body.get("providerId"));
        String name = str(body.get("name"));
        String identifier = str(body.get("identifier"));
        Map<String, Object> credentials = asMap(body.get("credentials"));

        if (!StringUtils.hasText(providerId)) {
            throw new CustomException("NB_INVALID_PROVIDER", "providerId is required");
        }
        String novuChannel = toNovuChannel(channel);

        NovuClient.NovuResponse novuResponse =
                novuClient.createIntegration(name, identifier, providerId, novuChannel, credentials);
        Map<String, Object> created = extractCreatedIntegration(novuResponse.getResponse());
        Map<String, Object> projected = IntegrationProjection.project(created);

        return new ResponseEntity<>(
                ProviderCreateResponse.builder().data(projected).build(), HttpStatus.OK);
    }

    // ---- GET /providers/templates ---------------------------------------

    /**
     * Read-only discovery of Novu workflows (delivery shells). Lists
     * {@code {workflowId, name}} — does NOT call Twilio. {@code channel} /
     * {@code providerId} are accepted for symmetry with the UI but the discovery
     * lists all workflows.
     */
    @GetMapping("/providers/templates")
    public ResponseEntity<Map<String, Object>> templates(
            @RequestParam(required = false) String channel,
            @RequestParam(required = false) String providerId) {
        NovuClient.NovuResponse novuResponse = novuClient.listWorkflows();
        List<Map<String, Object>> workflows = extractWorkflows(novuResponse.getResponse());
        List<Map<String, Object>> data = new ArrayList<>(workflows.size());
        for (Map<String, Object> wf : workflows) {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("workflowId", wf.get("workflowId"));
            row.put("name", wf.get("name"));
            data.add(row);
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("data", data);
        out.put("total", data.size());
        return ResponseEntity.ok(out);
    }

    /**
     * Novu {@code GET /v2/workflows} nests the list at {@code data.workflows}
     * (unlike {@code /v1/integrations} whose list is {@code data} directly).
     * Tolerant of both plus a bare {@code workflows} key.
     */
    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> extractWorkflows(Map<String, Object> response) {
        if (response == null) {
            return List.of();
        }
        Object data = response.get("data");
        if (data instanceof Map && ((Map<String, Object>) data).get("workflows") instanceof List) {
            return (List<Map<String, Object>>) ((Map<String, Object>) data).get("workflows");
        }
        if (data instanceof List) {
            return (List<Map<String, Object>>) data;
        }
        if (response.get("workflows") instanceof List) {
            return (List<Map<String, Object>>) response.get("workflows");
        }
        return List.of();
    }

    // ---- POST /providers/verify -----------------------------------------

    /**
     * Verify connectivity of a configured integration by matching it in
     * {@code GET /v1/integrations} — by {@code integrationId} (matches Novu
     * {@code _id} or {@code identifier}), or by {@code channel}+{@code providerId}.
     * Returns {@code {ok, active, detail}}.
     */
    @PostMapping("/providers/verify")
    public ResponseEntity<Map<String, Object>> verify(@RequestBody Map<String, Object> body) {
        String integrationId = str(body.get("integrationId"));
        String channel = str(body.get("channel"));
        String providerId = str(body.get("providerId"));

        NovuClient.NovuResponse novuResponse = novuClient.listIntegrations();
        List<Map<String, Object>> integrations = IntegrationProjection.extractList(novuResponse.getResponse());

        String novuChannel = StringUtils.hasText(channel) ? toNovuChannel(channel) : null;
        Map<String, Object> match = null;
        for (Map<String, Object> i : integrations) {
            if (StringUtils.hasText(integrationId)) {
                if (integrationId.equals(str(i.get("_id"))) || integrationId.equals(str(i.get("identifier")))) {
                    match = i;
                    break;
                }
            } else if (novuChannel != null && StringUtils.hasText(providerId)) {
                if (novuChannel.equalsIgnoreCase(str(i.get("channel")))
                        && providerId.equalsIgnoreCase(str(i.get("providerId")))) {
                    match = i;
                    break;
                }
            }
        }

        Map<String, Object> out = new LinkedHashMap<>();
        if (match == null) {
            out.put("ok", false);
            out.put("active", false);
            out.put("detail", "no matching integration found");
        } else {
            boolean active = Boolean.TRUE.equals(match.get("active"));
            out.put("ok", active);
            out.put("active", active);
            out.put("detail", active ? "integration active" : "integration inactive");
        }
        return ResponseEntity.ok(out);
    }

    // ---- POST /providers/test-send --------------------------------------

    /**
     * Send a live test message through Novu. SMS/EMAIL trigger the per-channel
     * workflow with a {@code {body, subject}} payload. WHATSAPP rides the Twilio SMS
     * integration: {@code to.phone = "whatsapp:+<E164>"} plus
     * {@code overrides.providers.twilio} built by {@link org.egov.novubridge.service.provider.TwilioProviderStrategy}
     * for an approved {@code contentSid}. The recipient-derived {@code subscriberId}
     * is stable (no clock/random) so a repeated test is reproducible. Writes one
     * {@code TEST}-tagged {@code nb_dispatch_log} row with a masked recipient.
     */
    @PostMapping("/providers/test-send")
    public ResponseEntity<Map<String, Object>> testSend(@RequestBody Map<String, Object> body) {
        String channel = str(body.get("channel"));
        Map<String, Object> to = asMap(body.get("to"));
        String phone = to != null ? str(to.get("phone")) : null;
        String email = to != null ? str(to.get("email")) : null;
        String workflowId = str(body.get("workflowId"));
        String bodyText = str(body.get("body"));
        String subject = str(body.get("subject"));
        String contentSid = str(body.get("contentSid"));
        List<Object> variables = asList(body.get("variables"));
        String txnInput = str(body.get("transactionId"));

        String upperChannel = channel == null ? "" : channel.toUpperCase();
        String recipient = StringUtils.hasText(phone) ? phone : email;

        // Stable, reproducible subscriberId — derived from the transactionId input
        // when supplied, else the recipient; NO clock/random so a re-test is idempotent.
        String seed = StringUtils.hasText(txnInput) ? txnInput
                : (recipient != null ? recipient : upperChannel);
        String subscriberId = "nb-test-" + stableId(seed);
        String transactionId = StringUtils.hasText(txnInput) ? txnInput : subscriberId;

        Map<String, Object> payload = new HashMap<>();
        if (bodyText != null) {
            payload.put("body", bodyText);
        }
        if (subject != null) {
            payload.put("subject", subject);
        }

        NovuClient.NovuResponse novuResponse;
        if ("WHATSAPP".equals(upperChannel)) {
            String phoneArg = "whatsapp:+" + digitsOnly(phone);
            Map<String, Object> overrides = buildWhatsappOverrides(contentSid, variables);
            String workflow = StringUtils.hasText(workflowId) ? workflowId : WORKFLOW_SMS;
            novuResponse = novuClient.trigger(workflow, subscriberId, phoneArg, payload,
                    transactionId, overrides, null);
        } else {
            String workflow = StringUtils.hasText(workflowId) ? workflowId
                    : ("EMAIL".equals(upperChannel) ? WORKFLOW_EMAIL : WORKFLOW_SMS);
            novuResponse = novuClient.trigger(workflow, subscriberId, phone, payload,
                    transactionId, null, null);
        }

        int novuStatus = novuResponse.getStatusCode() != null ? novuResponse.getStatusCode() : 0;
        boolean ok = novuStatus >= 200 && novuStatus < 300;
        writeTestLog(upperChannel, recipient, transactionId, novuStatus, ok);

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("ok", ok);
        out.put("novuStatus", novuStatus);
        out.put("transactionId", transactionId);
        return ResponseEntity.ok(out);
    }

    // ---- helpers ---------------------------------------------------------

    /** SMS and WHATSAPP → Novu {@code sms}; EMAIL → {@code email}. */
    private static String toNovuChannel(String channel) {
        if (!StringUtils.hasText(channel)) {
            throw new CustomException("NB_INVALID_CHANNEL", "channel is required");
        }
        switch (channel.toUpperCase()) {
            case "SMS":
            case "WHATSAPP":
                return NOVU_CHANNEL_SMS;
            case "EMAIL":
                return NOVU_CHANNEL_EMAIL;
            default:
                throw new CustomException("NB_INVALID_CHANNEL", "Unsupported channel: " + channel);
        }
    }

    /** Novu create returns {@code {data:{...}}} (or bare object); unwrap defensively. */
    @SuppressWarnings("unchecked")
    private static Map<String, Object> extractCreatedIntegration(Map<String, Object> body) {
        if (body == null) {
            return new LinkedHashMap<>();
        }
        Object data = body.get("data");
        if (data instanceof Map) {
            return (Map<String, Object>) data;
        }
        return body;
    }

    /**
     * The exact {@code {providers:{twilio:{...}}}} override envelope
     * {@link org.egov.novubridge.service.provider.TwilioProviderStrategy} produces
     * for a content template (contentSid + contentVariables). No credentials/sender
     * are set — those live in the Novu integration.
     */
    private Map<String, Object> buildWhatsappOverrides(String contentSid, List<Object> variables) {
        ResolvedProvider provider = ResolvedProvider.builder()
                .providerName("twilio")
                .channel("whatsapp")
                .build();
        ResolvedTemplate template = ResolvedTemplate.builder()
                .contentSid(contentSid)
                .build();

        NovuProviderStrategy strategy = strategyFactory.getStrategy(provider);
        Map<String, Object> providerConfig = strategy.buildProviderConfig(
                provider, template, toContentVariables(variables));

        Map<String, Object> providers = new HashMap<>();
        providers.put(provider.getProviderName().toLowerCase(), providerConfig);
        Map<String, Object> overrides = new HashMap<>();
        overrides.put("providers", providers);
        return overrides;
    }

    /** Positional variables → Twilio 1-based contentVariables map ({@code {"1":..,"2":..}}). */
    private static Map<String, String> toContentVariables(List<Object> variables) {
        if (variables == null || variables.isEmpty()) {
            return null;
        }
        Map<String, String> cv = new LinkedHashMap<>();
        for (int i = 0; i < variables.size(); i++) {
            Object v = variables.get(i);
            cv.put(String.valueOf(i + 1), v == null ? "" : v.toString());
        }
        return cv;
    }

    private void writeTestLog(String channel, String recipient, String transactionId,
                              int novuStatus, boolean ok) {
        long now = System.currentTimeMillis();
        Map<String, Object> providerResponse = new HashMap<>();
        providerResponse.put("test", true);
        providerResponse.put("novuStatus", novuStatus);
        DispatchLogEntry entry = DispatchLogEntry.builder()
                .id(UUID.randomUUID())
                .eventId(UUID.randomUUID().toString())
                .transactionId(transactionId)
                .module("notifications")
                .eventName("TEST")
                .tenantId("TEST")
                .channel(StringUtils.hasText(channel) ? channel : "UNKNOWN")
                .recipientValue(recipient != null ? PiiMask.mask(recipient) : "unknown")
                .templateKey("TEST")
                .status(ok ? "SENT" : "FAILED")
                .attemptCount(1)
                .providerResponse(providerResponse)
                .createdTime(now)
                .lastModifiedTime(now)
                .build();
        dispatchLogRepository.upsert(entry);
    }

    /** First 16 hex chars of SHA-256(seed) — deterministic, no clock/random. */
    private static String stableId(String seed) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] digest = md.digest(seed.getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder();
            for (int i = 0; i < 8 && i < digest.length; i++) {
                sb.append(String.format("%02x", digest[i]));
            }
            return sb.toString();
        } catch (Exception e) {
            return Integer.toHexString(seed.hashCode());
        }
    }

    private static String digitsOnly(String value) {
        return value == null ? "" : value.replaceAll("\\D", "");
    }

    private static String str(Object value) {
        return value == null ? null : value.toString();
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> asMap(Object value) {
        return value instanceof Map ? (Map<String, Object>) value : null;
    }

    @SuppressWarnings("unchecked")
    private static List<Object> asList(Object value) {
        return value instanceof List ? (List<Object>) value : null;
    }
}
