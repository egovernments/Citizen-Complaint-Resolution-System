package org.egov.novubridge.service.account;

import lombok.extern.slf4j.Slf4j;
import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.novubridge.config.TenantAccountsConfiguration;
import org.egov.novubridge.util.ServiceUrl;
import org.egov.novubridge.util.Values;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import org.springframework.web.client.HttpStatusCodeException;
import org.springframework.web.client.RestTemplate;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * The Novu calls that need a USER session rather than an environment API key: an API key belongs
 * to one environment of one organization and cannot create organizations. Verified against the
 * stock self-hosted Novu 2.3.0 API:
 * <ul>
 *   <li>{@code POST /v1/auth/login {email,password}} answers {@code {data:{token}}};</li>
 *   <li>{@code GET /v1/organizations} lists the user's organizations;</li>
 *   <li>{@code POST /v1/organizations {name}} creates one with the user as its admin, plus its
 *       Development and Production environments, each with an API key ({@code CreateOrganization});
 *       per-tenant ENVIRONMENTS are not an option: {@code POST /v1/environments} is a paid
 *       feature ({@code MANAGE_ENVIRONMENTS}) and answers 402 on a self-hosted (FREE) organization;</li>
 *   <li>{@code POST /v1/auth/organizations/{id}/switch} answers a token scoped to that organization;</li>
 *   <li>{@code GET /v1/environments} lists its environments with their API keys inline;</li>
 *   <li>{@code POST /v1/environments/api-keys/regenerate} with {@code Novu-Environment-Id} replaces
 *       that environment's key (the deprovision path: the old key stops working).</li>
 * </ul>
 * Nothing here logs a token, a password or a key.
 */
@Slf4j
@Component
public class NovuPlatformClient {

    static final String ENVIRONMENT_HEADER = "Novu-Environment-Id";

    private final RestTemplate restTemplate;
    private final NovuBridgeConfiguration config;
    private final TenantAccountsConfiguration accounts;

    public NovuPlatformClient(RestTemplate restTemplate, NovuBridgeConfiguration config,
                              TenantAccountsConfiguration accounts) {
        this.restTemplate = restTemplate;
        this.config = config;
        this.accounts = accounts;
    }

    public record Organization(String id, String name) {
    }

    public record Environment(String id, String name, String apiKey) {
    }

    /** A user session JWT for the platform admin. */
    public String login() {
        if (!StringUtils.hasText(accounts.getAdminEmail()) || !StringUtils.hasText(accounts.getAdminPassword())) {
            throw new AccountException(HttpStatus.SERVICE_UNAVAILABLE, "NB_TENANT_ACCOUNTS_MISCONFIGURED",
                    "novu.bridge.tenant.accounts.admin.email/password are not set: the bridge cannot sign in to Novu "
                            + "to manage tenant organizations");
        }
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("email", accounts.getAdminEmail().trim());
        body.put("password", accounts.getAdminPassword());
        Map<String, Object> response = call(HttpMethod.POST, "/v1/auth/login", null, null, body, "signing in to Novu");
        String token = Values.str(Values.unwrapData(response).get("token"));
        if (!StringUtils.hasText(token)) {
            throw new AccountException(HttpStatus.BAD_GATEWAY, "NB_NOVU_PLATFORM_LOGIN_FAILED",
                    "Novu answered the platform admin login without a token");
        }
        return token;
    }

    public List<Organization> organizations(String token) {
        Object data = call(HttpMethod.GET, "/v1/organizations", token, null, null, "listing Novu organizations").get("data");
        List<Organization> out = new ArrayList<>();
        List<Object> rows = Values.asList(data);
        if (rows == null) {
            throw new AccountException(HttpStatus.BAD_GATEWAY, "NB_NOVU_PLATFORM_FAILED",
                    "Novu listed organizations without a data list");
        }
        for (Object row : rows) {
            Map<String, Object> org = Values.asMap(row);
            if (org != null && StringUtils.hasText(Values.str(org.get("_id")))) {
                out.add(new Organization(Values.str(org.get("_id")), Values.str(org.get("name"))));
            }
        }
        return out;
    }

    public Organization createOrganization(String token, String name) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("name", name);
        Map<String, Object> org = Values.unwrapData(call(HttpMethod.POST, "/v1/organizations", token, null, body,
                "creating a Novu organization"));
        String id = Values.str(org.get("_id"));
        if (!StringUtils.hasText(id)) {
            throw new AccountException(HttpStatus.BAD_GATEWAY, "NB_NOVU_PLATFORM_FAILED",
                    "Novu created an organization but returned no id");
        }
        log.info("Novu organization created: id={} name={}", id, name);
        return new Organization(id, Values.str(org.get("name")));
    }

    /** A token scoped to {@code organizationId}; the platform admin must be a member (it created it). */
    public String switchOrganization(String token, String organizationId) {
        Map<String, Object> response = call(HttpMethod.POST, "/v1/auth/organizations/" + organizationId + "/switch",
                token, null, null, "switching to the tenant's Novu organization");
        Object data = response.get("data");
        String scoped = data instanceof String text ? text : Values.str(Values.unwrapData(response).get("token"));
        if (!StringUtils.hasText(scoped)) {
            throw new AccountException(HttpStatus.BAD_GATEWAY, "NB_NOVU_PLATFORM_FAILED",
                    "Novu switched organization without returning a token");
        }
        return scoped;
    }

    public List<Environment> environments(String organizationToken) {
        List<Object> rows = Values.asList(call(HttpMethod.GET, "/v1/environments", organizationToken, null, null,
                "listing the organization's Novu environments").get("data"));
        if (rows == null) {
            throw new AccountException(HttpStatus.BAD_GATEWAY, "NB_NOVU_PLATFORM_FAILED",
                    "Novu listed environments without a data list");
        }
        List<Environment> out = new ArrayList<>();
        for (Object row : rows) {
            Map<String, Object> env = Values.asMap(row);
            if (env == null) {
                continue;
            }
            String key = null;
            List<Object> keys = Values.asList(env.get("apiKeys"));
            if (keys != null && !keys.isEmpty() && Values.asMap(keys.get(0)) != null) {
                key = Values.str(Values.asMap(keys.get(0)).get("key"));
            }
            out.add(new Environment(Values.str(env.get("_id")), Values.str(env.get("name")), key));
        }
        return out;
    }

    /** Replaces the environment's API key; the previous key stops authenticating. The new one is not returned. */
    public void regenerateApiKey(String organizationToken, String environmentId) {
        call(HttpMethod.POST, "/v1/environments/api-keys/regenerate", organizationToken, environmentId, null,
                "regenerating the environment's API key");
    }

    @SuppressWarnings({"rawtypes", "unchecked"})
    private Map<String, Object> call(HttpMethod method, String path, String token, String environmentId,
                                     Object body, String action) {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        if (token != null) {
            headers.setBearerAuth(token);
        }
        if (environmentId != null) {
            headers.set(ENVIRONMENT_HEADER, environmentId);
        }
        HttpEntity<?> entity = body == null ? new HttpEntity<>(headers) : new HttpEntity<>(body, headers);
        try {
            ResponseEntity<Map> response = restTemplate.exchange(ServiceUrl.join(config.getNovuBaseUrl(), path),
                    method, entity, Map.class);
            return response.getBody() == null ? new LinkedHashMap<>() : (Map<String, Object>) response.getBody();
        } catch (HttpStatusCodeException e) {
            // The body of a 4xx from login names no secret; the request body is never echoed.
            log.warn("Novu platform call failed while {}: {} {}", action, e.getStatusCode().value(), path);
            if (e.getStatusCode().value() == 401 || e.getStatusCode().value() == 403
                    || ("/v1/auth/login".equals(path) && e.getStatusCode().value() == 400)) {
                throw new AccountException(HttpStatus.BAD_GATEWAY, "NB_NOVU_PLATFORM_LOGIN_FAILED",
                        "Novu refused the platform admin while " + action + " (HTTP " + e.getStatusCode().value()
                                + "): check novu.bridge.tenant.accounts.admin.email/password", e);
            }
            throw new AccountException(HttpStatus.BAD_GATEWAY, "NB_NOVU_PLATFORM_FAILED",
                    "Novu answered HTTP " + e.getStatusCode().value() + " while " + action, e);
        } catch (AccountException e) {
            throw e;
        } catch (Exception e) {
            log.warn("Novu platform call failed while {}: {}", action, e.getMessage());
            throw new AccountException(HttpStatus.SERVICE_UNAVAILABLE, "NB_NOVU_UNAVAILABLE",
                    "Novu could not be reached while " + action + ": " + e.getMessage(), e);
        }
    }
}
