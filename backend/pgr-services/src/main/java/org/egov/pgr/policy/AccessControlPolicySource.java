package org.egov.pgr.policy;

import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.egov.pgr.config.PGRConfiguration;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.web.client.RestTemplateBuilder;
import org.springframework.context.annotation.Lazy;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestTemplate;

import java.net.URI;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;

/**
 * Role-scoped policy transport backed by egov-accesscontrol's MDMS action endpoint.
 *
 * <p>This component is intentionally only a source. {@link AccessPolicyRegistry} remains an
 * explicitly constructed, non-Spring type, so registering this bean does not activate policy
 * evaluation or change any request path.
 *
 * <p>The request deliberately omits {@code RequestInfo}: the endpoint requires only tenant and
 * roles, and forwarding caller identity through the shared tracing client would expose more data
 * than policy discovery needs. It also deliberately omits the {@code enabled} filter and preserves
 * the returned value. The current ABAC document (action 2008) is disabled as a navigation action,
 * but remains the role-mapped policy source of truth.
 */
@Component
@Lazy
public class AccessControlPolicySource implements AccessPolicySource {

    private static final TypeReference<LinkedHashMap<String, Object>> DOCUMENT_TYPE =
            new TypeReference<>() { };

    private final RestTemplate restTemplate;
    private final ObjectMapper objectMapper;
    private final URI endpoint;
    private final String actionMaster;

    @Autowired
    public AccessControlPolicySource(RestTemplateBuilder restTemplateBuilder,
                                     ObjectMapper objectMapper,
                                     PGRConfiguration config) {
        this(buildClient(restTemplateBuilder,
                        config.getAccessControlConnectTimeoutMillis(),
                        config.getAccessControlReadTimeoutMillis()),
                objectMapper,
                endpoint(config.getAccessControlHost(), config.getAccessControlActionsMdmsGetPath()),
                requiredUnpadded(config.getAccessControlActionsMaster(), "action master"));
    }

    AccessControlPolicySource(RestTemplate restTemplate, ObjectMapper objectMapper,
                              URI endpoint, String actionMaster) {
        this.restTemplate = Objects.requireNonNull(restTemplate, "restTemplate");
        this.objectMapper = Objects.requireNonNull(objectMapper, "objectMapper").copy()
                .enable(JsonParser.Feature.STRICT_DUPLICATE_DETECTION);
        this.endpoint = Objects.requireNonNull(endpoint, "endpoint");
        this.actionMaster = requiredUnpadded(actionMaster, "action master");
    }

    @Override
    public List<PolicyAction> findActions(String tenantId, String method, String url,
                                          List<String> roleCodes) {
        String exactTenant = requiredUnpadded(tenantId, "tenantId");
        String exactMethod = requiredUnpadded(method, "method");
        String exactUrl = requiredUnpadded(url, "url");
        if (!exactMethod.equals(exactMethod.toUpperCase(Locale.ROOT)))
            throw new IllegalArgumentException("method must be canonical uppercase");
        List<String> exactRoleCodes = requireCanonicalRoles(roleCodes);

        Map<String, Object> request = new LinkedHashMap<>();
        request.put("roleCodes", exactRoleCodes);
        request.put("tenantId", exactTenant);
        request.put("actionMaster", actionMaster);

        String responseBody = restTemplate.postForObject(endpoint, request, String.class);
        return parseResponse(responseBody, exactMethod, exactUrl);
    }

    List<PolicyAction> parseResponse(String responseBody, String method, String url) {
        JsonNode response;
        try {
            response = responseBody == null ? null : objectMapper.readTree(responseBody);
        } catch (JsonProcessingException e) {
            throw new MalformedPolicySourceResponseException(
                    "access-control response must contain valid JSON without duplicate keys", e);
        }
        return parseActions(response, method, url);
    }

    List<PolicyAction> parseActions(JsonNode response, String method, String url) {
        if (response == null || !response.isObject())
            throw new MalformedPolicySourceResponseException(
                    "access-control response must be a JSON object");
        JsonNode actions = response.get("actions");
        if (actions == null || !actions.isArray())
            throw new MalformedPolicySourceResponseException(
                    "access-control response must contain an actions array");

        List<PolicyAction> matches = new ArrayList<>();
        for (int index = 0; index < actions.size(); index++) {
            JsonNode action = actions.get(index);
            if (!action.isObject())
                throw invalidAction(index, "must be a JSON object");

            JsonNode methodNode = action.get("method");
            if (methodNode == null || methodNode.isNull())
                continue; // Ignore legacy non-policy actions, including their default/blank URLs.

            // The endpoint returns every role-visible action. An unrelated service's malformed
            // policy metadata must not deny this URL, while a candidate for this exact URL is
            // validated strictly below.
            JsonNode urlNode = action.get("url");
            if (urlNode != null && urlNode.isTextual() && !url.equals(urlNode.textValue()))
                continue;
            String actionUrl = requiredText(action, "url", index);

            if (!methodNode.isTextual())
                throw invalidAction(index, "method must be a string when present");
            String actionMethod;
            try {
                actionMethod = requiredUnpadded(methodNode.textValue(), "method");
            } catch (IllegalArgumentException e) {
                throw invalidAction(index, e.getMessage());
            }
            if (!actionMethod.equals(actionMethod.toUpperCase(Locale.ROOT)))
                throw invalidAction(index, "method must be canonical uppercase");

            if (!method.equals(actionMethod) || !url.equals(actionUrl))
                continue;

            Map<String, Object> document;
            try {
                document = objectMapper.convertValue(action, DOCUMENT_TYPE);
            } catch (IllegalArgumentException e) {
                throw new MalformedPolicySourceResponseException(
                        "invalid access-control actions[" + index + "]: cannot preserve JSON document", e);
            }
            matches.add(new PolicyAction(actionMethod, actionUrl, document));
        }
        return List.copyOf(matches);
    }

    private static String requiredText(JsonNode action, String field, int index) {
        JsonNode value = action.get(field);
        if (value == null || !value.isTextual())
            throw invalidAction(index, field + " must be a string");
        try {
            return requiredUnpadded(value.textValue(), "actions[" + index + "]." + field);
        } catch (IllegalArgumentException e) {
            throw invalidAction(index, e.getMessage());
        }
    }

    private static MalformedPolicySourceResponseException invalidAction(int index, String detail) {
        return new MalformedPolicySourceResponseException(
                "invalid access-control actions[" + index + "]: " + detail);
    }

    private static List<String> requireCanonicalRoles(List<String> roleCodes) {
        if (roleCodes == null || roleCodes.isEmpty())
            throw new IllegalArgumentException("roleCodes must not be empty");
        List<String> exact = List.copyOf(roleCodes);
        for (String code : exact)
            requiredUnpadded(code, "role code");

        List<String> canonical = exact.stream().distinct().sorted().toList();
        if (!exact.equals(canonical))
            throw new IllegalArgumentException("roleCodes must be sorted and distinct");
        return exact;
    }

    private static RestTemplate buildClient(RestTemplateBuilder builder,
                                            Long connectTimeoutMillis,
                                            Long readTimeoutMillis) {
        Objects.requireNonNull(builder, "restTemplateBuilder");
        return builder
                .setConnectTimeout(positiveTimeout(connectTimeoutMillis, "connect timeout"))
                .setReadTimeout(positiveTimeout(readTimeoutMillis, "read timeout"))
                .build();
    }

    private static Duration positiveTimeout(Long millis, String name) {
        if (millis == null || millis <= 0)
            throw new IllegalArgumentException(name + " must be positive");
        return Duration.ofMillis(millis);
    }

    private static URI endpoint(String host, String path) {
        String exactHost = requiredUnpadded(host, "access-control host");
        String exactPath = requiredUnpadded(path, "access-control path");
        String joined = exactHost.replaceAll("/+$", "") + "/" + exactPath.replaceFirst("^/+", "");
        URI endpoint = URI.create(joined);
        if (!endpoint.isAbsolute() || endpoint.getHost() == null
                || !("http".equalsIgnoreCase(endpoint.getScheme())
                || "https".equalsIgnoreCase(endpoint.getScheme())))
            throw new IllegalArgumentException("access-control endpoint must be an absolute HTTP(S) URI");
        return endpoint;
    }

    private static String requiredUnpadded(String value, String name) {
        if (value == null || value.isBlank() || !value.equals(value.trim()))
            throw new IllegalArgumentException(name + " must not be blank or padded");
        return value;
    }
}
