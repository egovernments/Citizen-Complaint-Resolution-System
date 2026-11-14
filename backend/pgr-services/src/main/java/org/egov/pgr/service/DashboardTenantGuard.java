package org.egov.pgr.service;

import com.fasterxml.jackson.databind.JsonNode;
import lombok.extern.slf4j.Slf4j;
import org.egov.pgr.config.PGRConfiguration;
import org.egov.pgr.policy.PolicyDrivenScopeResolver;
import org.egov.tracer.model.CustomException;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestTemplate;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.Map;

/**
 * Authorizes the {@code tenantId} a {@code GET /v2/dashboard} caller asks for.
 *
 * <p>The endpoint is a bodyless GET, so no RequestInfo reaches it. The gateway authenticates the
 * token it carries ({@code auth-token} header or {@code access_token} query parameter) and checks
 * the action, but it forwards no identity and never compares the requested tenant with the
 * caller's. This resolves the caller from the same token and applies the search path's own
 * check, {@link PolicyDrivenScopeResolver#isAuthorizedTenant}: the caller's home tenant or a
 * tenant beneath it. A {@code ke} caller asking for {@code kenya} is refused.
 *
 * <p>Fails closed: no token, a token egov-user rejects, or egov-user unreachable all refuse.
 */
@Component
@Slf4j
public class DashboardTenantGuard {

    private final RestTemplate restTemplate;
    private final PGRConfiguration config;

    @Autowired
    public DashboardTenantGuard(RestTemplate restTemplate, PGRConfiguration config) {
        this.restTemplate = restTemplate;
        this.config = config;
    }

    /** @throws CustomException when the caller cannot be identified or is not authorized for the tenant */
    public void requireAuthorizedTenant(String authToken, String requestedTenantId) {
        if (authToken == null || authToken.isBlank())
            throw new CustomException("INVALID_REQUESTINFO", "An auth token is required to read the dashboard");

        String callerTenantId = callerTenantId(authToken);
        if (!PolicyDrivenScopeResolver.isAuthorizedTenant(callerTenantId, requestedTenantId)) {
            log.warn("DashboardTenantGuard: tenantId='{}' is outside the caller's tenant '{}' — refused",
                    requestedTenantId, callerTenantId);
            throw new CustomException("TENANT_NOT_AUTHORIZED",
                    "The caller is not authorized for tenantId " + requestedTenantId);
        }
    }

    private String callerTenantId(String authToken) {
        JsonNode response;
        try {
            response = restTemplate.postForObject(
                    config.getUserHost().replaceAll("/$", "") + "/user/_details?access_token="
                            + URLEncoder.encode(authToken, StandardCharsets.UTF_8),
                    Map.of("RequestInfo", Map.of("authToken", authToken)), JsonNode.class);
        } catch (RestClientException e) {
            log.warn("DashboardTenantGuard: /user/_details failed — refused: {}", e.getMessage());
            throw new CustomException("INVALID_REQUESTINFO", "The auth token could not be verified");
        }
        JsonNode user = response == null ? null : response.has("UserRequest") ? response.get("UserRequest") : response;
        String tenantId = user == null ? null : user.path("tenantId").asText(null);
        if (tenantId == null || tenantId.isBlank())
            throw new CustomException("INVALID_REQUESTINFO", "The auth token could not be verified");
        return tenantId;
    }
}
