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
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;

/** Internal DIGIT service calls. Credentials and tokens never enter persisted saga data. */
@Component
public class OnboardingProvisionerClient {
    private final RestTemplate http;
    private final ObjectMapper mapper;
    private final Environment env;
    private final Set<String> signupSchemas, signupWorkflows;
    private final PlatformBaseline baselinePacks;
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
        var schemas = new HashSet<String>(); var workflows = new HashSet<String>();
        try { baselinePacks = new PlatformBaseline(mapper); }
        catch (java.io.IOException e) { throw new IllegalStateException("Onboarding baseline unavailable", e); }
        baselinePacks.schemas().forEach(schema -> schemas.add(schema.path("code").asText()));
        baselinePacks.workflows().forEach(workflow -> workflows.add(workflow.path("businessService").asText()));
        this.signupSchemas = Set.copyOf(schemas); this.signupWorkflows = Set.copyOf(workflows);
    }

    @SuppressWarnings("unchecked")
    private synchronized Map<String, Object> requestInfo() {
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

    private String base(String service) {
        String key = "egov." + service + ".host";
        String value = env.getProperty(key, "");
        if (value.isBlank()) throw new OnboardingFailure("ONBOARDING_SERVICE_NOT_CONFIGURED", true);
        return value.replaceAll("/$", "");
    }

    public JsonNode read(String service, String path, Map<String, Object> body) {
        String endpoint = path == null ? "" : path.split("\\?", 2)[0];
        Set<String> reads = Set.of("mdms:/egov-mdms-service/schema/v1/_search", "mdms:/egov-mdms-service/v2/_search",
                "hrms:/egov-hrms/employees/_search", "boundary:/boundary-service/boundary/_search",
                "boundary:/boundary-service/boundary-hierarchy-definition/_search", "boundary:/boundary-service/boundary-relationships/_search",
                "workflow:/egov-workflow-v2/egov-wf/businessservice/_search");
        if (!reads.contains(service + ":" + endpoint) || path.contains("#")) denied();
        var request = new LinkedHashMap<>(body); request.put("RequestInfo", requestInfo());
        return exchange(base(service) + path, request, null);
    }

    /** No generic write: callers need a live signup lease and one of the fixed step actions. */
    public JsonNode write(OnboardingProgress.WriteScope scope, String service, String path, Map<String, Object> body) {
        if (scope == null) denied();
        // Validate the same immutable snapshot that will be sent after remote authorization.
        JsonNode snapshot = mapper.valueToTree(body);
        validateSignupWrite(scope, service, path, snapshot);
        scope.requireLiveLease();
        Map<String,Object> verified = verifiedWriteInfo(); // never cached role claims
        scope.requireLiveLease(); // authorization lookup may have outlived the lease
        Map<String,Object> request = mapper.convertValue(snapshot, new com.fasterxml.jackson.core.type.TypeReference<LinkedHashMap<String,Object>>() {});
        request.put("RequestInfo", verified);
        return exchange(base(service) + path, request, null);
    }

    private Map<String,Object> verifiedWriteInfo() {
        String root = env.getProperty("pgr.onboarding.provisioner.tenant-id", "");
        if (root.isBlank() || root.contains(".")) throw new OnboardingFailure("PROVISIONER_NOT_CONFIGURED", true);
        String token = Objects.toString(requestInfo().get("authToken"), "");
        JsonNode details = exchange(base("user") + "/user/_details?access_token=" + URLEncoder.encode(token, StandardCharsets.UTF_8),
                Map.of("RequestInfo", Map.of("authToken", token)), null);
        JsonNode user = details.has("UserRequest") ? details.path("UserRequest") : details;
        if (!user.isObject() || !user.path("uuid").isTextual() || user.path("uuid").asText().isBlank()
                || !user.path("active").isBoolean() || !user.path("active").booleanValue()
                || !"EMPLOYEE".equals(user.path("type").asText()) || !root.equals(user.path("tenantId").asText())
                || !env.getProperty("pgr.onboarding.provisioner.username", "").equals(user.path("userName").asText())
                || !user.path("roles").isArray()) unauthorized();
        Set<String> roles = new HashSet<>();
        for (JsonNode role : user.path("roles")) if (root.equals(role.path("tenantId").asText())) roles.add(role.path("code").asText());
        if (!roles.containsAll(Set.of("MDMS_ADMIN", "ACCOUNT_ADMIN", "LOC_ADMIN", "HRMS_ADMIN"))) unauthorized();
        return Map.of("apiId", "pgr-onboarding", "authToken", token, "userInfo", mapper.convertValue(user, Map.class), "ts", System.currentTimeMillis());
    }

    private void validateSignupWrite(OnboardingProgress.WriteScope scope, String service, String path, JsonNode body) {
        String tenant = scope.tenant(), step = scope.step();
        if (tenant == null || !tenant.matches("[a-z][a-z0-9]*") || path == null) denied();
        boolean foundation = "TENANT_FOUNDATION".equals(step), baseline = "PLATFORM_BASELINE".equals(step);
        JsonNode payload;
        if ("mdms".equals(service) && "/egov-mdms-service/schema/v1/_create".equals(path) && (foundation || baseline)) {
            payload = body.path("SchemaDefinition"); requireTenant(payload, tenant);
            if (!signupSchemas.contains(payload.path("code").asText()) || foundation && !"tenant.tenants".equals(payload.path("code").asText())) denied();
            return; // JSON schema property definitions are not tenant-bearing request data.
        }
        if ("mdms".equals(service) && (foundation || baseline)) {
            payload = body.path("Mdms"); String schema = payload.path("schemaCode").asText();
            if (!schema.matches("[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+")
                    || !(path.equals("/egov-mdms-service/v2/_create/" + schema) || path.equals("/egov-mdms-service/v2/_update/" + schema))) denied();
            if (!signupSchemas.contains(schema) || foundation && !"tenant.tenants".equals(schema)) denied();
            if (path.contains("/_update/") && !Set.of("tenant.tenants", "common-masters.StateInfo").contains(schema)) denied();
            requireTenant(payload, tenant);
            if ("tenant.tenants".equals(schema) && (!tenant.equals(payload.path("uniqueIdentifier").asText()) || !tenant.equals(payload.path("data").path("code").asText()))) denied();
        } else if ("enc".equals(service) && foundation && "/egov-enc-service/crypto/v1/_generatekey".equals(path)) {
            requireTenant(body, tenant);
        } else if ("localization".equals(service) && baseline && "/localization/messages/v1/_upsert".equals(path)) {
            requireTenant(body, tenant);
            if (!body.path("messages").isArray() || body.path("messages").isEmpty()) denied();
            for (JsonNode message : body.path("messages")) if (!("TENANT_TENANTS_" + tenant.toUpperCase(Locale.ROOT)).equals(message.path("code").asText())
                    && !baselinePacks.isPackMessage(message)) denied(); // only the committed tenant-neutral packs, verbatim
        } else if ("boundary".equals(service) && baseline) {
            if ("/boundary-service/boundary-hierarchy-definition/_create".equals(path)) {
                payload = body.path("BoundaryHierarchy"); requireTenant(payload, tenant);
                if (!OnboardingSteps.WORKSPACE_HIERARCHY.equals(payload.path("hierarchyType").asText())) denied();
            } else if ("/boundary-service/boundary/_create".equals(path)) {
                payload = only(body.path("Boundary")); requireTenant(payload, tenant);
                if (!tenant.equals(payload.path("code").asText())) denied();
            } else if ("/boundary-service/boundary-relationships/_create".equals(path)) {
                payload = body.path("BoundaryRelationship"); requireTenant(payload, tenant);
                if (!tenant.equals(payload.path("code").asText()) || !OnboardingSteps.WORKSPACE_HIERARCHY.equals(payload.path("hierarchyType").asText()) || !"ROOT".equals(payload.path("boundaryType").asText())) denied();
            } else denied();
        } else if ("workflow".equals(service) && baseline && "/egov-workflow-v2/egov-wf/businessservice/_create".equals(path)) {
            payload = only(body.path("BusinessServices")); requireTenant(payload, tenant);
            if (!signupWorkflows.contains(payload.path("businessService").asText())) denied();
        } else if ("hrms".equals(service) && "FOUNDER_HRMS".equals(step) && "/egov-hrms/employees/_create".equals(path)) {
            payload = only(body.path("Employees")); requireTenant(payload, tenant); requireTenant(payload.path("user"), tenant);
            String founder = "FOUNDER_" + scope.signupId().toString().replace("-", "");
            if (!founder.equals(payload.path("code").asText()) || !founder.equals(payload.path("user").path("userName").asText())) denied();
        } else denied();
        requireNestedTenants(body, tenant);
    }

    private JsonNode only(JsonNode array) { if (!array.isArray() || array.size() != 1) denied(); return array.path(0); }
    private void requireTenant(JsonNode node, String tenant) { if (!tenant.equals(node.path("tenantId").asText())) denied(); }
    private void requireNestedTenants(JsonNode node, String tenant) {
        if (node.isObject()) node.fields().forEachRemaining(field -> {
            if ("RequestInfo".equals(field.getKey())) return; // overwritten with the trusted identity
            if ("tenantId".equals(field.getKey()) && (!field.getValue().isTextual() || !tenant.equals(field.getValue().asText()))) denied();
            requireNestedTenants(field.getValue(), tenant);
        });
        else if (node.isArray()) node.forEach(child -> requireNestedTenants(child, tenant));
    }
    private void denied() { throw new OnboardingFailure("SIGNUP_WRITE_SCOPE_DENIED", false); }
    private void unauthorized() { throw new OnboardingFailure("PROVISIONER_AUTHORIZATION_REQUIRED", true); }

    public JsonNode identity(String path, Map<String, Object> body) {
        String token = env.getProperty("pgr.onboarding.identity-bff.token", "");
        String url = env.getProperty("pgr.onboarding.identity-bff.url", "");
        if (token.isBlank() || url.isBlank()) throw new OnboardingFailure("IDENTITY_NOT_CONFIGURED", true);
        return exchange(url.replaceAll("/$", "") + "/internal/identity/v1/" + path, body, token);
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
