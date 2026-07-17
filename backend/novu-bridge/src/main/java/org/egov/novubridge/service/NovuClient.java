package org.egov.novubridge.service;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.novubridge.service.provider.OzekiOverridesBuilder;
import org.egov.novubridge.util.PiiMask;
import org.egov.tracer.model.CustomException;
import org.springframework.http.*;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import org.springframework.web.client.RestTemplate;

import org.egov.novubridge.web.models.Contact;

import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@Service
@Slf4j
public class NovuClient {

    private final RestTemplate restTemplate;
    private final NovuBridgeConfiguration config;

    // Hand-rolled subscriberId -> last-identified epoch-ms TTL cache (no guava/caffeine);
    // skips redundant POST /v1/subscribers calls within the configured TTL window.
    private final Map<String, Long> identifiedAt = new ConcurrentHashMap<>();

    public NovuClient(RestTemplate restTemplate, NovuBridgeConfiguration config) {
        this.restTemplate = restTemplate;
        this.config = config;
    }

    /**
     * Upsert a Novu subscriber (identify, D6) then trigger the per-channel
     * workflow with the pre-rendered body. PGR already resolved the recipient,
     * rendered + localized the body, so this is pure pass-through delivery.
     *
     * @param subscriberId    tenantId:userUuid (fallback tenantId:mobile)
     * @param contact         profile resolved by PGR (phone/email/name/locale)
     * @param channel         SMS | WHATSAPP | EMAIL (selects the Novu workflow id)
     * @param renderedBody    final localized message body
     * @param renderedSubject EMAIL subject, else null
     * @param transactionId   stable idempotency key
     * @param data            structured payload echoed alongside body/subject
     */
    public NovuResponse identifyThenTrigger(String subscriberId, Contact contact, String channel,
                                            String renderedBody, String renderedSubject,
                                            String transactionId, Map<String, Object> data) {
        identify(subscriberId, contact);

        String workflowId = config.getNovuWorkflowId(channel);
        String phone = contact != null ? contact.getPhone() : null;
        String email = contact != null ? contact.getEmail() : null;

        Map<String, Object> payload = new HashMap<>();
        if (data != null) {
            payload.putAll(data);
        }
        payload.put("body", renderedBody);
        if (renderedSubject != null) {
            payload.put("subject", renderedSubject);
        }

        // Ozeki delivery (opt-in): reshape the SMS send for an Ozeki gateway
        // behind a generic-sms integration. Overrides are sent raw (Novu never
        // templates them), which is exactly why this envelope can only be built
        // here — the pass-through path is the one place that has the final
        // renderedBody, recipient phone and transactionId together.
        Map<String, Object> overrides = null;
        if ("SMS".equalsIgnoreCase(channel) && config.isOzekiSmsEnabled()) {
            overrides = OzekiOverridesBuilder.build(
                    config.getOzekiIntegrationIdentifier(), transactionId, phone, renderedBody);
        }

        return trigger(workflowId, subscriberId, phone, email, payload, transactionId, overrides);
    }

    /**
     * Upsert (identify) a Novu subscriber by subscriberId. Idempotent and
     * guarded by a short-lived in-memory TTL cache. Identify failures are
     * logged but non-fatal — the trigger still proceeds.
     */
    public void identify(String subscriberId, Contact contact) {
        if (!StringUtils.hasText(subscriberId)) {
            return;
        }
        if (recentlyIdentified(subscriberId)) {
            log.debug("Skipping identify for subscriberId={} (within TTL)", subscriberId);
            return;
        }
        try {
            Map<String, Object> body = new HashMap<>();
            body.put("subscriberId", subscriberId);
            if (contact != null) {
                if (StringUtils.hasText(contact.getPhone())) {
                    body.put("phone", contact.getPhone());
                }
                if (StringUtils.hasText(contact.getEmail())) {
                    body.put("email", contact.getEmail());
                }
                if (StringUtils.hasText(contact.getName())) {
                    String[] parts = contact.getName().trim().split("\\s+", 2);
                    body.put("firstName", parts[0]);
                    if (parts.length > 1) {
                        body.put("lastName", parts[1]);
                    }
                }
                if (StringUtils.hasText(contact.getLocale())) {
                    body.put("locale", contact.getLocale());
                }
                Map<String, Object> subData = new HashMap<>();
                if (StringUtils.hasText(contact.getType())) {
                    subData.put("role", contact.getType());
                }
                if (StringUtils.hasText(contact.getUserId())) {
                    subData.put("userId", contact.getUserId());
                }
                if (!subData.isEmpty()) {
                    body.put("data", subData);
                }
            }

            HttpHeaders headers = new HttpHeaders();
            headers.set("Authorization", "ApiKey " + config.getNovuApiKey());
            headers.setContentType(MediaType.APPLICATION_JSON);

            String url = config.getNovuBaseUrl() + "/v1/subscribers";
            log.info("Novu identify (upsert) subscriberId={} url={}", subscriberId, url);
            restTemplate.exchange(url, HttpMethod.POST, new HttpEntity<>(body, headers), Map.class);
            markIdentified(subscriberId);
        } catch (Exception e) {
            // Non-fatal: a missing profile only degrades tracking, not delivery.
            log.warn("Novu identify failed for subscriberId={} (continuing to trigger): {}",
                    subscriberId, e.getMessage());
        }
    }

    private boolean recentlyIdentified(String subscriberId) {
        Long ts = identifiedAt.get(subscriberId);
        if (ts == null) {
            return false;
        }
        long ttl = config.getIdentifyCacheTtlMs() != null ? config.getIdentifyCacheTtlMs() : 0L;
        if (System.currentTimeMillis() - ts > ttl) {
            identifiedAt.remove(subscriberId); // evict-on-read
            return false;
        }
        return true;
    }

    private void markIdentified(String subscriberId) {
        identifiedAt.put(subscriberId, System.currentTimeMillis());
    }

    /**
     * Trigger a Novu workflow for a single subscriber, routing the rendered
     * body via payload. Used by the pass-through path.
     */
    public NovuResponse trigger(String workflowId, String subscriberId, String phone, String email,
                                Map<String, Object> payload, String transactionId) {
        return trigger(workflowId, subscriberId, phone, email, payload, transactionId, null);
    }

    public NovuResponse trigger(String workflowId, String subscriberId, String phone, String email,
                                Map<String, Object> payload, String transactionId,
                                Map<String, Object> overrides) {
        try {
            Map<String, Object> request = new HashMap<>();
            request.put("name", workflowId);

            Map<String, Object> to = new HashMap<>();
            to.put("subscriberId", subscriberId);
            if (StringUtils.hasText(phone)) {
                to.put("phone", phone);
            }
            if (StringUtils.hasText(email)) {
                to.put("email", email);
            }
            request.put("to", to);
            request.put("payload", payload);
            if (StringUtils.hasText(transactionId)) {
                request.put("transactionId", transactionId);
            }
            if (overrides != null && !overrides.isEmpty()) {
                request.put("overrides", overrides);
            }

            HttpHeaders headers = new HttpHeaders();
            headers.set("Authorization", "ApiKey " + config.getNovuApiKey());
            headers.setContentType(MediaType.APPLICATION_JSON);

            String url = config.getNovuBaseUrl() + "/v1/events/trigger";
            log.info("Novu trigger workflowId={} subscriberId={} channel-phone={} txn={}",
                    workflowId, subscriberId, PiiMask.mask(phone), transactionId);

            ResponseEntity<Map> response = restTemplate.exchange(url, HttpMethod.POST,
                    new HttpEntity<>(request, headers), Map.class);
            return NovuResponse.builder()
                    .statusCode(response.getStatusCodeValue())
                    .response(response.getBody())
                    .build();
        } catch (Exception e) {
            log.error("Novu trigger failed for workflowId={} subscriberId={}", workflowId, subscriberId, e);
            throw new CustomException("NB_NOVU_TRIGGER_FAILED", "Failed triggering Novu event: " + e.getMessage());
        }
    }

    public NovuResponse trigger(String templateKey, String subscriberId, String phone, Map<String, Object> payload,
                                String transactionId, Map<String, Object> overrides, String novuApiKey) {
        try {
            Map<String, Object> request = new HashMap<>();
            request.put("name", templateKey);
            
            Map<String, Object> to = new HashMap<>();
            to.put("subscriberId", subscriberId);
            if (phone != null && !phone.isBlank()) {
                to.put("phone", phone);
            }
            request.put("to", to);
            request.put("payload", payload);
            request.put("transactionId", transactionId);
            
            if (overrides != null && !overrides.isEmpty()) {
                request.put("overrides", overrides);
            }

            String apiKey = (novuApiKey != null && !novuApiKey.isBlank()) ? novuApiKey : config.getNovuApiKey();
            HttpHeaders headers = new HttpHeaders();
            headers.set("Authorization", "ApiKey " + apiKey);
            headers.setContentType(MediaType.APPLICATION_JSON);

            String url = config.getNovuBaseUrl() + "/v1/events/trigger";
            // Masked like the pass-through overload above — never log the raw
            // request (recipient phone + message text) or headers (Novu ApiKey).
            log.info("Novu trigger templateKey={} subscriberId={} channel-phone={} txn={} overrides={}",
                    templateKey, subscriberId, PiiMask.mask(phone), transactionId,
                    overrides != null && !overrides.isEmpty());

            ResponseEntity<Map> response = restTemplate.exchange(url, HttpMethod.POST, new HttpEntity<>(request, headers), Map.class);
            return NovuResponse.builder()
                    .statusCode(response.getStatusCodeValue())
                    .response(response.getBody())
                    .build();
        } catch (Exception e) {
            log.error("Novu trigger failed for templateKey={} subscriberId={}", templateKey, subscriberId, e);
            throw new CustomException("NB_NOVU_TRIGGER_FAILED", "Failed triggering Novu event: " + e.getMessage());
        }
    }

    public NovuResponse trigger(String templateKey, String subscriberId, String phone, Map<String, Object> payload,
                                String transactionId, Map<String, Object> overrides) {
        return trigger(templateKey, subscriberId, phone, payload, transactionId, overrides, null);
    }

    public NovuResponse trigger(String templateKey, String subscriberId, Map<String, Object> payload, String transactionId) {
        return trigger(templateKey, subscriberId, null, payload, transactionId, null, null);
    }

    /**
     * Read the configured provider integrations from Novu ({@code GET /v1/integrations}).
     * The Novu ApiKey is applied server-side here; the returned body is raw and
     * still carries provider {@code credentials}, so callers exposing this to the
     * browser MUST redact secrets first (see the integrations controller). The key
     * itself is never returned — the keyless configurator SPA only ever sees the
     * redacted response.
     *
     * @return the parsed Novu response ({@code data} is the integration list)
     */
    public NovuResponse listIntegrations() {
        try {
            HttpHeaders headers = new HttpHeaders();
            headers.set("Authorization", "ApiKey " + config.getNovuApiKey());
            headers.setContentType(MediaType.APPLICATION_JSON);

            String url = config.getNovuBaseUrl() + "/v1/integrations";
            log.info("Novu list integrations url={}", url);
            ResponseEntity<Map> response = restTemplate.exchange(url, HttpMethod.GET,
                    new HttpEntity<>(headers), Map.class);
            return NovuResponse.builder()
                    .statusCode(response.getStatusCodeValue())
                    .response(response.getBody())
                    .build();
        } catch (Exception e) {
            log.error("Novu list integrations failed", e);
            throw new CustomException("NB_NOVU_INTEGRATIONS_FAILED",
                    "Failed listing Novu integrations: " + e.getMessage());
        }
    }

    /**
     * Create a Novu provider integration ({@code POST /v1/integrations}) with the
     * same payload shape as {@code bootstrap-novu-whatsapp.sh}:
     * {@code {name, identifier, providerId, channel, active:true, check:false, credentials}}.
     * The Novu ApiKey is applied server-side; the operator-entered {@code credentials}
     * POST straight through to Novu over TLS and live only there.
     *
     * <p><b>Secrets never logged.</b> Only the credential <i>key names</i> (never the
     * values) are logged; the full body — including {@code credentials} — is never
     * written to a log line. The returned {@link NovuResponse#getResponse()} is the
     * raw Novu body (the created integration under {@code data}); callers exposing it
     * to the browser MUST allowlist-project it so no {@code credentials} echo back.
     *
     * @param name        human-readable integration name
     * @param identifier  stable integration identifier (optional; Novu generates one if blank)
     * @param providerId  Novu provider id (e.g. {@code twilio}, {@code nodemailer})
     * @param channel     Novu channel (e.g. {@code sms}, {@code email})
     * @param credentials provider credential map (accountSid/token/from, host/user/pass/…)
     * @return the parsed Novu response ({@code data} is the created integration)
     */
    public NovuResponse createIntegration(String name, String identifier, String providerId,
                                          String channel, Map<String, Object> credentials) {
        try {
            Map<String, Object> body = new HashMap<>();
            body.put("name", name);
            if (StringUtils.hasText(identifier)) {
                body.put("identifier", identifier);
            }
            body.put("providerId", providerId);
            body.put("channel", channel);
            body.put("active", true);
            body.put("check", false);
            body.put("credentials", credentials != null ? credentials : new HashMap<>());

            HttpHeaders headers = new HttpHeaders();
            headers.set("Authorization", "ApiKey " + config.getNovuApiKey());
            headers.setContentType(MediaType.APPLICATION_JSON);

            String url = config.getNovuBaseUrl() + "/v1/integrations";
            // Log the credential KEY NAMES only — never the secret values, never the body.
            log.info("Novu create integration name={} identifier={} providerId={} channel={} credentialKeys={} url={}",
                    name, identifier, providerId, channel,
                    credentials != null ? credentials.keySet() : "none", url);

            ResponseEntity<Map> response = restTemplate.exchange(url, HttpMethod.POST,
                    new HttpEntity<>(body, headers), Map.class);
            return NovuResponse.builder()
                    .statusCode(response.getStatusCodeValue())
                    .response(response.getBody())
                    .build();
        } catch (Exception e) {
            // Message deliberately omits the body so a stack trace can never surface a secret.
            log.error("Novu create integration failed for providerId={} channel={}", providerId, channel, e);
            throw new CustomException("NB_NOVU_INTEGRATION_CREATE_FAILED",
                    "Failed creating Novu integration: " + e.getMessage());
        }
    }

    /**
     * Read the configured Novu workflows ({@code GET /v2/workflows?limit=100&page=0}).
     * Used by the read-only "pull templates" discovery on the Notification Providers
     * screen — it lists delivery-shell workflows (workflowId + name); it does NOT
     * call Twilio. The Novu ApiKey is applied server-side.
     *
     * @return the parsed Novu response ({@code data} is the workflow list)
     */
    public NovuResponse listWorkflows() {
        try {
            HttpHeaders headers = new HttpHeaders();
            headers.set("Authorization", "ApiKey " + config.getNovuApiKey());
            headers.setContentType(MediaType.APPLICATION_JSON);

            String url = config.getNovuBaseUrl() + "/v2/workflows?limit=100&page=0";
            log.info("Novu list workflows url={}", url);
            ResponseEntity<Map> response = restTemplate.exchange(url, HttpMethod.GET,
                    new HttpEntity<>(headers), Map.class);
            return NovuResponse.builder()
                    .statusCode(response.getStatusCodeValue())
                    .response(response.getBody())
                    .build();
        } catch (Exception e) {
            log.error("Novu list workflows failed", e);
            throw new CustomException("NB_NOVU_WORKFLOWS_FAILED",
                    "Failed listing Novu workflows: " + e.getMessage());
        }
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class NovuResponse {
        private Integer statusCode;
        private Map<String, Object> response;
    }
}
