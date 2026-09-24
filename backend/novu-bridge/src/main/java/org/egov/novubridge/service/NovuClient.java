package org.egov.novubridge.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.novubridge.util.PiiMask;
import org.egov.novubridge.web.models.Contact;
import org.egov.tracer.model.CustomException;
import org.egov.novubridge.util.ServiceUrl;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import org.springframework.web.client.RestTemplate;

import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@Service
@Slf4j
public class NovuClient {

    private static final ObjectMapper CONTENT_VAR_MAPPER = new ObjectMapper();

    private final RestTemplate restTemplate;
    private final NovuBridgeConfiguration config;
    /** subscriberId -> epoch ms of the last successful identify; skips redundant upserts within the TTL. */
    private final Map<String, Long> identifiedAt = new ConcurrentHashMap<>();

    public NovuClient(RestTemplate restTemplate, NovuBridgeConfiguration config) {
        this.restTemplate = restTemplate;
        this.config = config;
    }

    /**
     * Upsert the subscriber, then trigger the channel's workflow with the pre-rendered body.
     *
     * @param integrationIdentifier the Novu integration the tenant pinned for this channel; blank = Novu's primary
     * @param providerType          catalog type of that integration, so a gateway needing its own body (Ozeki) gets it
     */
    public NovuResponse identifyThenTrigger(String subscriberId, Contact contact, String channel,
                                            String renderedBody, String renderedSubject,
                                            String transactionId, Map<String, Object> data,
                                            String templateId, Map<String, Object> contentVariables,
                                            String integrationIdentifier, String providerType) {
        // Channel-scoped subscriber: SMS wants "+E164" and WhatsApp "whatsapp:+E164" in the same
        // phone field; one shared subscriber would let the two legs clobber each other.
        String scopedSubscriberId = StringUtils.hasText(channel) ? subscriberId + ":" + channel : subscriberId;
        identify(scopedSubscriberId, contact);

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

        Map<String, Object> overrides = StringUtils.hasText(templateId)
                ? buildProviderTemplateOverrides(templateId, contentVariables) : null;
        overrides = applyWhatsappIntegrationOverride(overrides, channel);
        // The tenant's pick wins over the deployment-wide WhatsApp pin: it is more specific and needs no redeploy.
        overrides = applyIntegrationOverride(overrides, channel, integrationIdentifier);
        overrides = applyGatewayBody(overrides, providerType, transactionId, phone, renderedBody);
        return trigger(config.getNovuWorkflowId(channel), scopedSubscriberId, phone, email, payload,
                transactionId, overrides);
    }

    /**
     * Pin a trigger to one named integration. Novu keys overrides by its own channel name, so
     * WhatsApp (which rides Novu's {@code sms} channel) pins under {@code sms}. Blank is a no-op.
     */
    public static Map<String, Object> applyIntegrationOverride(Map<String, Object> overrides,
                                                               String channel, String integrationIdentifier) {
        if (!StringUtils.hasText(integrationIdentifier)) {
            return overrides;
        }
        Map<String, Object> merged = overrides == null ? new HashMap<>() : overrides;
        Map<String, Object> channelOverride = new HashMap<>();
        channelOverride.put("integrationIdentifier", integrationIdentifier);
        merged.put("EMAIL".equalsIgnoreCase(channel) ? "email" : "sms", channelOverride);
        return merged;
    }

    /**
     * Ozeki's API wants {@code {messages:[{message_id, to_address, text}]}}, which generic-sms
     * cannot express. Novu deep-merges {@code _passthrough.body} verbatim (no key-casing), but only
     * under the Novu provider id ({@code generic-sms}), and never templates it, so {@code text}
     * must already be rendered. SMSCountry needs nothing here: its adapter does the translating.
     */
    public static Map<String, Object> applyGatewayBody(Map<String, Object> overrides, String providerType,
                                                       String transactionId, String toAddress, String text) {
        if (!"ozeki".equalsIgnoreCase(providerType == null ? "" : providerType.trim())) {
            return overrides;
        }
        Map<String, Object> message = new LinkedHashMap<>();
        message.put("message_id", transactionId);
        message.put("to_address", toAddress);
        message.put("text", text);

        Map<String, Object> merged = overrides == null ? new HashMap<>() : overrides;
        @SuppressWarnings("unchecked")
        Map<String, Object> providers = merged.get("providers") instanceof Map
                ? (Map<String, Object>) merged.get("providers") : new HashMap<>();
        providers.put("generic-sms", Map.of("_passthrough", Map.of("body",
                Map.of("messages", List.of(message)))));
        merged.put("providers", providers);
        return merged;
    }

    /**
     * Without an explicit integration override Novu picks the PRIMARY sms integration, so a
     * WhatsApp send would go out through the plain-SMS Twilio sender and be rejected. No-op
     * unless {@code novu.bridge.integration.id.whatsapp} is set.
     */
    public Map<String, Object> applyWhatsappIntegrationOverride(Map<String, Object> overrides, String channel) {
        if (!"WHATSAPP".equalsIgnoreCase(channel) || !StringUtils.hasText(config.getWhatsappIntegrationId())) {
            return overrides;
        }
        if (overrides == null) {
            overrides = new HashMap<>();
        }
        Map<String, Object> smsOverride = new HashMap<>();
        smsOverride.put("integrationIdentifier", config.getWhatsappIntegrationId());
        overrides.put("sms", smsOverride);
        return overrides;
    }

    /** Twilio approved-Content-template envelope; {@code contentVariables} must be a JSON string. */
    public static Map<String, Object> buildProviderTemplateOverrides(String contentSid,
                                                                     Map<String, ?> contentVariables) {
        Map<String, Object> body = new HashMap<>();
        body.put("contentSid", contentSid);
        if (contentVariables != null && !contentVariables.isEmpty()) {
            try {
                body.put("contentVariables", CONTENT_VAR_MAPPER.writeValueAsString(contentVariables));
            } catch (Exception e) {
                throw new CustomException("NB_TWILIO_CONTENT_VARS_SERIALIZE",
                        "Failed to serialize contentVariables for Twilio: " + e.getMessage());
            }
        }
        // Mutable all the way down: applyGatewayBody may add to "providers" later.
        Map<String, Object> passthrough = new HashMap<>();
        passthrough.put("body", body);
        Map<String, Object> twilio = new HashMap<>();
        twilio.put("_passthrough", passthrough);
        Map<String, Object> providers = new HashMap<>();
        providers.put("twilio", twilio);
        Map<String, Object> overrides = new HashMap<>();
        overrides.put("providers", providers);
        return overrides;
    }

    /** Upsert a Novu subscriber. Non-fatal: a missing profile degrades tracking, not delivery. */
    public void identify(String subscriberId, Contact contact) {
        if (!StringUtils.hasText(subscriberId) || recentlyIdentified(subscriberId)) {
            return;
        }
        try {
            Map<String, Object> body = new HashMap<>();
            body.put("subscriberId", subscriberId);
            if (contact != null) {
                putIfText(body, "phone", contact.getPhone());
                putIfText(body, "email", contact.getEmail());
                if (StringUtils.hasText(contact.getName())) {
                    String[] parts = contact.getName().trim().split("\\s+", 2);
                    body.put("firstName", parts[0]);
                    if (parts.length > 1) {
                        body.put("lastName", parts[1]);
                    }
                }
                putIfText(body, "locale", contact.getLocale());
                Map<String, Object> subData = new HashMap<>();
                putIfText(subData, "role", contact.getType());
                putIfText(subData, "userId", contact.getUserId());
                if (!subData.isEmpty()) {
                    body.put("data", subData);
                }
            }
            // subscriberId falls back to tenantId:phone for a recipient with no uuid.
            log.info("Novu identify (upsert) subscriberId={}", PiiMask.maskEmbedded(subscriberId));
            send(HttpMethod.POST, "/v1/subscribers", body);
            identifiedAt.put(subscriberId, System.currentTimeMillis());
        } catch (Exception e) {
            log.warn("Novu identify failed for subscriberId={} (continuing to trigger): {}",
                    PiiMask.maskEmbedded(subscriberId), e.getMessage());
        }
    }

    private boolean recentlyIdentified(String subscriberId) {
        Long ts = identifiedAt.get(subscriberId);
        if (ts == null) {
            return false;
        }
        long ttl = config.getIdentifyCacheTtlMs() != null ? config.getIdentifyCacheTtlMs() : 0L;
        if (System.currentTimeMillis() - ts > ttl) {
            identifiedAt.remove(subscriberId);
            return false;
        }
        return true;
    }

    /**
     * Trigger one workflow for one subscriber. Phone AND email always ride in {@code to} when known:
     * the subscriber profile from {@link #identify} is best-effort, so it cannot be relied on to
     * hold the address.
     *
     * @param overrides provider/integration overrides, or null/empty for none
     */
    public NovuResponse trigger(String workflowId, String subscriberId, String phone, String email,
                                Map<String, Object> payload, String transactionId, Map<String, Object> overrides) {
        Map<String, Object> to = new HashMap<>();
        to.put("subscriberId", subscriberId);
        putIfText(to, "phone", phone);
        putIfText(to, "email", email);
        Map<String, Object> request = new HashMap<>();
        request.put("name", workflowId);
        request.put("to", to);
        request.put("payload", payload);
        putIfText(request, "transactionId", transactionId);
        boolean hasOverrides = overrides != null && !overrides.isEmpty();
        if (hasOverrides) {
            request.put("overrides", overrides);
        }
        // Never log the request (recipient + message text) or headers (ApiKey); the ids can embed a phone.
        log.info("Novu trigger workflowId={} subscriberId={} channel-phone={} txn={} overrides={}",
                workflowId, PiiMask.maskEmbedded(subscriberId), PiiMask.mask(phone),
                PiiMask.maskEmbedded(transactionId), hasOverrides);
        return exchange(HttpMethod.POST, "/v1/events/trigger", request, "NB_NOVU_TRIGGER_FAILED", "triggering Novu event");
    }

    /** {@code GET /v1/integrations}. The raw body carries provider credentials: callers must redact. */
    public NovuResponse listIntegrations() {
        return exchange(HttpMethod.GET, "/v1/integrations", null, "NB_NOVU_INTEGRATIONS_FAILED", "listing Novu integrations");
    }

    public NovuResponse createIntegration(String name, String identifier, String providerId,
                                          String channel, Map<String, Object> credentials) {
        return createIntegration(name, identifier, providerId, channel, credentials, true);
    }

    /**
     * {@code POST /v1/integrations}. Credentials pass straight through to Novu and are never
     * logged (key names only). An inactive integration is stored but never selected by Novu.
     */
    public NovuResponse createIntegration(String name, String identifier, String providerId,
                                          String channel, Map<String, Object> credentials, boolean active) {
        Map<String, Object> body = new HashMap<>();
        body.put("name", name);
        putIfText(body, "identifier", identifier);
        body.put("providerId", providerId);
        body.put("channel", channel);
        body.put("active", active);
        body.put("check", false);
        body.put("credentials", credentials != null ? credentials : new HashMap<>());
        log.info("Novu create integration name={} identifier={} providerId={} channel={} credentialKeys={}",
                name, identifier, providerId, channel, credentials != null ? credentials.keySet() : "none");
        return exchange(HttpMethod.POST, "/v1/integrations", body, "NB_NOVU_INTEGRATION_CREATE_FAILED",
                "creating Novu integration");
    }

    /**
     * {@code PUT /v1/integrations/{id}} with only the changed fields. Novu REPLACES the credential
     * set wholesale, so {@code credentials} must be complete (that is the rotation path).
     */
    public NovuResponse updateIntegration(String integrationId, String name,
                                          Map<String, Object> credentials, Boolean active) {
        Map<String, Object> body = new HashMap<>();
        putIfText(body, "name", name);
        if (credentials != null) {
            body.put("credentials", credentials);
        }
        if (active != null) {
            body.put("active", active);
        }
        body.put("check", false);
        log.info("Novu update integration id={} name={} active={} credentialKeys={}",
                integrationId, name, active, credentials != null ? credentials.keySet() : "unchanged");
        return exchange(HttpMethod.PUT, "/v1/integrations/" + integrationId, body,
                "NB_NOVU_INTEGRATION_UPDATE_FAILED", "updating Novu integration");
    }

    /** Destroys the integration and its credentials; callers must first check no tenant routes through it. */
    public NovuResponse deleteIntegration(String integrationId) {
        log.info("Novu delete integration id={}", integrationId);
        return exchange(HttpMethod.DELETE, "/v1/integrations/" + integrationId, null,
                "NB_NOVU_INTEGRATION_DELETE_FAILED", "deleting Novu integration");
    }

    public NovuResponse listWorkflows() {
        return exchange(HttpMethod.GET, "/v2/workflows?limit=100&page=0", null, "NB_NOVU_WORKFLOWS_FAILED",
                "listing Novu workflows");
    }

    /** One Novu call with the server-side ApiKey. The error message never includes the request body (secrets). */
    @SuppressWarnings({"unchecked", "rawtypes"})
    private NovuResponse exchange(HttpMethod method, String path, Object body, String errorCode, String action) {
        try {
            ResponseEntity<Map> response = send(method, path, body);
            return NovuResponse.builder()
                    .statusCode(response.getStatusCode().value())
                    .response(response.getBody())
                    .build();
        } catch (Exception e) {
            log.error("Novu {} {} failed", method, path, e);
            throw new CustomException(errorCode, "Failed " + action + ": " + e.getMessage());
        }
    }

    @SuppressWarnings("rawtypes")
    private ResponseEntity<Map> send(HttpMethod method, String path, Object body) {
        HttpHeaders headers = new HttpHeaders();
        headers.set("Authorization", "ApiKey " + config.getNovuApiKey());
        headers.setContentType(MediaType.APPLICATION_JSON);
        HttpEntity<?> entity = body == null ? new HttpEntity<>(headers) : new HttpEntity<>(body, headers);
        return restTemplate.exchange(ServiceUrl.join(config.getNovuBaseUrl(), path), method, entity, Map.class);
    }

    private static void putIfText(Map<String, Object> map, String key, String value) {
        if (StringUtils.hasText(value)) {
            map.put(key, value);
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
