package org.egov.pgr.onboarding;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.core.env.Environment;
import org.springframework.http.*;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestClientResponseException;
import org.springframework.web.client.RestTemplate;
import java.util.*;

/** Internal DIGIT service calls. Credentials and tokens never enter persisted saga data. */
@Component
public class OnboardingProvisionerClient {
    private final RestTemplate http;
    private final ObjectMapper mapper;
    private final Environment env;
    private Map<String, Object> login;
    private long expiresAt;

    public OnboardingProvisionerClient(RestTemplate shared, ObjectMapper mapper, Environment env) {
        var factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(2000);
        factory.setReadTimeout(10000);
        this.http = new RestTemplate(shared.getMessageConverters());
        this.http.setRequestFactory(factory);
        this.mapper = mapper;
        this.env = env;
    }

    @SuppressWarnings("unchecked")
    public synchronized Map<String, Object> requestInfo() {
        if (login == null || expiresAt <= System.currentTimeMillis()) {
            String username = env.getProperty("pgr.onboarding.provisioner.username", "");
            String password = env.getProperty("pgr.onboarding.provisioner.password", "");
            if (username.isBlank() || password.isBlank()) throw new OnboardingFailure("PROVISIONER_NOT_CONFIGURED", true);
            var form = new LinkedMultiValueMap<String, String>();
            form.add("username", username); form.add("password", password);
            form.add("grant_type", "password"); form.add("scope", "read"); form.add("userType", "EMPLOYEE");
            form.add("tenantId", env.getRequiredProperty("pgr.onboarding.provisioner.tenant-id"));
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_FORM_URLENCODED);
            headers.setBasicAuth(env.getProperty("pgr.onboarding.provisioner.client-id", "egov-user-client"),
                    env.getProperty("pgr.onboarding.provisioner.client-secret", ""));
            try {
                login = http.postForObject(base("user") + "/user/oauth/token", new HttpEntity<>(form, headers), Map.class);
            } catch (RestClientException e) { throw new OnboardingFailure("PROVISIONER_UNAVAILABLE", true); }
            if (login == null || login.get("access_token") == null || !(login.get("UserRequest") instanceof Map))
                throw new OnboardingFailure("PROVISIONER_UNAVAILABLE", true);
            expiresAt = System.currentTimeMillis() + 60000;
        }
        return Map.of("apiId", "pgr-onboarding", "authToken", login.get("access_token"),
                "userInfo", login.get("UserRequest"), "ts", System.currentTimeMillis());
    }

    public String base(String service) {
        String key = "egov." + service + ".host";
        String value = env.getProperty(key, "");
        if (value.isBlank()) throw new OnboardingFailure("ONBOARDING_SERVICE_NOT_CONFIGURED", true);
        return value.replaceAll("/$", "");
    }

    public JsonNode post(String service, String path, Map<String, Object> body) {
        Map<String, Object> request = new LinkedHashMap<>(body);
        request.put("RequestInfo", requestInfo());
        return exchange(base(service) + path, request, null);
    }

    public JsonNode identity(String path, Map<String, Object> body) {
        String token = env.getProperty("pgr.onboarding.identity-bff.token", "");
        String url = env.getProperty("pgr.onboarding.identity-bff.url", "");
        if (token.isBlank() || url.isBlank()) throw new OnboardingFailure("IDENTITY_NOT_CONFIGURED", true);
        return exchange(url.replaceAll("/$", "") + "/internal/identity/v1/" + path, body, token);
    }

    /** Localization acknowledges cache invalidation with an empty successful response. */
    public void bustLocalizationCache() {
        exchange(base("localization") + "/localization/messages/cache-bust",
                Map.of("RequestInfo", requestInfo()), null, false);
    }

    private JsonNode exchange(String url, Map<String, Object> body, String token) {
        return exchange(url, body, token, true);
    }

    private JsonNode exchange(String url, Map<String, Object> body, String token, boolean requireBody) {
        HttpHeaders headers = new HttpHeaders(); headers.setContentType(MediaType.APPLICATION_JSON);
        if (token != null) headers.setBearerAuth(token);
        try {
            JsonNode response = http.postForObject(url, new HttpEntity<>(body, headers), JsonNode.class);
            if (response == null && requireBody) throw new OnboardingFailure("EMPTY_PROVISIONING_RESPONSE", true);
            return response;
        } catch (RestClientResponseException e) {
            String code = "PROVISIONING_HTTP_" + e.getStatusCode().value();
            try {
                JsonNode error = mapper.readTree(e.getResponseBodyAsString());
                code = error.path("code").asText(error.path("Errors").path(0).path("code").asText(code));
            }
            catch (Exception ignored) { /* Preserve status classification without storing remote PII. */ }
            int status = e.getStatusCode().value();
            if (status == 401) { synchronized (this) { login = null; } }
            throw new OnboardingFailure(code, status >= 500 || status == 401 || status == 403 || status == 429);
        } catch (RestClientException e) { throw new OnboardingFailure("PROVISIONING_UNAVAILABLE", true); }
    }
}
