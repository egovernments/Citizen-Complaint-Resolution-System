package org.egov.pgr.onboarding;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestClientResponseException;
import org.springframework.web.client.RestTemplate;

import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * novu-bridge's internal tenant account API (#2203): gives a new workspace its own Novu
 * organization. Machine-to-machine on the internal network with {@code X-Novu-Bridge-Token};
 * Kong never routes that API. Unconfigured (blank URL or token) = per-tenant accounts are not in
 * use here, and the onboarding step is a no-op.
 */
@Component
public class NotificationAccountClient {

    static final String TOKEN_HEADER = "X-Novu-Bridge-Token";
    private static final Pattern TENANT = Pattern.compile("[a-z0-9][a-z0-9_-]{0,63}");

    private final String baseUrl;
    private final String token;
    private final RestTemplate http;
    private final ObjectMapper mapper;

    /** What a provision call came back with. {@code code} is the bridge's NB_* code, or a transport one. */
    public record Outcome(boolean ok, String code, String status, boolean organizationCreated) {
    }

    @Autowired
    public NotificationAccountClient(@Value("${pgr.onboarding.notification-account.url:}") String baseUrl,
                                     @Value("${pgr.onboarding.notification-account.token:}") String token,
                                     @Value("${pgr.onboarding.notification-account.connect-timeout-ms:2000}") int connectTimeoutMs,
                                     @Value("${pgr.onboarding.notification-account.read-timeout-ms:60000}") int readTimeoutMs,
                                     ObjectMapper mapper) {
        this.baseUrl = baseUrl == null ? "" : baseUrl.trim().replaceAll("/+$", "");
        this.token = token == null ? "" : token.trim();
        var factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(connectTimeoutMs);
        factory.setReadTimeout(readTimeoutMs);
        this.http = new RestTemplate(factory);
        this.mapper = mapper;
    }

    /** Test seam: the same client over a given RestTemplate. */
    NotificationAccountClient(String baseUrl, String token, RestTemplate http, ObjectMapper mapper) {
        this.baseUrl = baseUrl == null ? "" : baseUrl.trim().replaceAll("/+$", "");
        this.token = token == null ? "" : token.trim();
        this.http = http;
        this.mapper = mapper;
    }

    public boolean configured() {
        return !baseUrl.isEmpty() && !token.isEmpty();
    }

    /**
     * {@code POST /novu-adapter/v1/tenants/{tenantId}/_provision}: idempotent on the bridge side, so a
     * retry or a resumed saga never creates a second organization. Never throws: the caller decides
     * what a failure means (onboarding goes on without notifications).
     */
    public Outcome provision(String tenantId) {
        if (!configured()) {
            return new Outcome(false, "NOT_CONFIGURED", null, false);
        }
        if (tenantId == null || !TENANT.matcher(tenantId).matches()) {
            return new Outcome(false, "INVALID_TENANT", null, false);
        }
        JsonNode body = post("/novu-adapter/v1/tenants/" + tenantId + "/_provision", null);
        if (body.has("__error")) {
            return new Outcome(false, body.path("__error").asText(), null, false);
        }
        JsonNode data = body.path("data");
        return new Outcome("PROVISIONED".equals(data.path("status").asText()), data.path("status").asText(),
                data.path("status").asText(), data.path("organizationCreated").asBoolean(false));
    }

    /** {@code POST /tenants/_backfill}: per-tenant outcomes keyed by tenant id ("PROVISIONED" or an error code). */
    public Map<String, String> backfill(List<String> tenantIds) {
        var out = new java.util.LinkedHashMap<String, String>();
        if (!configured() || tenantIds.isEmpty()) {
            return out;
        }
        JsonNode body = post("/novu-adapter/v1/tenants/_backfill", Map.of("tenantIds", tenantIds));
        if (body.has("__error")) {
            tenantIds.forEach(t -> out.put(t, body.path("__error").asText()));
            return out;
        }
        for (JsonNode row : body.path("data")) {
            String status = row.path("status").asText();
            out.put(row.path("tenantId").asText(), "ERROR".equals(status) ? row.path("code").asText("ERROR") : status);
        }
        return out;
    }

    private JsonNode post(String path, Object body) {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.set(TOKEN_HEADER, token);
        try {
            String response = http.exchange(baseUrl + path, HttpMethod.POST,
                    new HttpEntity<>(body == null ? Map.of() : body, headers), String.class).getBody();
            return response == null || response.isBlank() ? mapper.createObjectNode() : mapper.readTree(response);
        } catch (RestClientResponseException e) {
            String code = "NOTIFICATION_ACCOUNT_HTTP_" + e.getStatusCode().value();
            try {
                JsonNode error = mapper.readTree(e.getResponseBodyAsString());
                String bridgeCode = error.path("Errors").path(0).path("code").asText("");
                if (!bridgeCode.isBlank()) code = bridgeCode;
            } catch (Exception ignored) {
                // Not the bridge's JSON: keep the HTTP status code.
            }
            return mapper.createObjectNode().put("__error", code);
        } catch (RestClientException e) {
            return mapper.createObjectNode().put("__error", "NOTIFICATION_ACCOUNT_UNAVAILABLE");
        } catch (Exception e) {
            return mapper.createObjectNode().put("__error", "NOTIFICATION_ACCOUNT_INVALID_RESPONSE");
        }
    }
}
