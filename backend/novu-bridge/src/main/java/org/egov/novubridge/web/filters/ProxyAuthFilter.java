package org.egov.novubridge.web.filters;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.extern.slf4j.Slf4j;
import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.novubridge.util.Values;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.util.StringUtils;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Authenticates the configurator endpoints: the opaque DIGIT bearer token is introspected against
 * egov-user {@code /user/_details}; the caller must be an EMPLOYEE with a role from
 * {@code novu.bridge.proxy.allowed.roles}. Credential-bearing, destructive and PII-expanding POSTs
 * additionally need {@code novu.bridge.proxy.admin.roles} (403 {@code NB_ADMIN_ROLE_REQUIRED}).
 * Resolved roles are cached 60s keyed by SHA-256 of the token, never the raw token.
 */
@Slf4j
public class ProxyAuthFilter extends OncePerRequestFilter {

    private static final long CACHE_TTL_MS = 60_000L;
    private static final String BEARER_PREFIX = "Bearer ";
    private static final String NAMESPACE = "/novu-adapter/v1";

    /** Exact paths, not prefixes: every other {@code /providers/*} path stays on the broad allowlist. */
    private static final Set<String> ADMIN_ONLY_PATHS = Set.of(
            NAMESPACE + "/providers",
            NAMESPACE + "/providers/_update",
            NAMESPACE + "/providers/_delete",
            // _resolve answers with filled contact blocks: recipient PII for every holder of a role.
            NAMESPACE + "/dispatch/_resolve");

    private record CachedUser(long expiresAt, Set<String> roles) {
    }

    private final RestTemplate restTemplate;
    private final NovuBridgeConfiguration config;
    private final ConcurrentHashMap<String, CachedUser> validTokenCache = new ConcurrentHashMap<>();

    public ProxyAuthFilter(RestTemplate restTemplate, NovuBridgeConfiguration config) {
        this.restTemplate = restTemplate;
        this.config = config;
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        // CORS preflight must pass unauthenticated.
        if (HttpMethod.OPTIONS.matches(request.getMethod())) {
            return true;
        }
        String path = pathOf(request);
        // Machine callers with their own authentication (receipt secret; adapter credential
        // headers + apiUrl allowlist), and the public contract documents (no tenant data).
        if (path.startsWith("/novu-adapter/v1/receipts")
                || path.startsWith("/novu-adapter/v1/gateways")
                || path.startsWith("/novu-adapter/v1/contract")) {
            return true;
        }
        return !(path.startsWith("/novu-adapter/v1/config")
                || path.startsWith("/novu-adapter/v1/logs")
                || path.startsWith("/novu-adapter/v1/integrations")
                || path.startsWith("/novu-adapter/v1/preferences")
                || path.startsWith("/novu-adapter/v1/providers")
                || path.startsWith("/novu-adapter/v1/dispatch"));
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        // Escape hatch for local dev.
        if (config.getProxyAuthEnabled() == null || !config.getProxyAuthEnabled()) {
            chain.doFilter(request, response);
            return;
        }

        String header = request.getHeader(HttpHeaders.AUTHORIZATION);
        if (header == null || !header.regionMatches(true, 0, BEARER_PREFIX, 0, BEARER_PREFIX.length())) {
            writeError(response, HttpStatus.UNAUTHORIZED, "missing bearer token");
            return;
        }
        String token = header.substring(BEARER_PREFIX.length()).trim();
        if (!StringUtils.hasText(token)) {
            writeError(response, HttpStatus.UNAUTHORIZED, "missing bearer token");
            return;
        }

        long now = System.currentTimeMillis();
        String tokenHash = Values.sha256Hex(token);
        CachedUser cached = validTokenCache.get(tokenHash);
        if (cached != null && cached.expiresAt() > now) {
            if (!adminCheckPasses(request, response, cached.roles())) {
                return;
            }
            chain.doFilter(request, response);
            return;
        }
        // Opportunistic sweep of expired entries.
        validTokenCache.entrySet().removeIf(e -> e.getValue().expiresAt() <= now);

        Map<String, Object> user;
        try {
            user = introspect(token);
        } catch (Exception e) {
            log.warn("Proxy auth: token introspection call failed: {}", e.getMessage());
            writeError(response, HttpStatus.UNAUTHORIZED, "invalid token");
            return;
        }
        if (user == null) {
            writeError(response, HttpStatus.UNAUTHORIZED, "invalid token");
            return;
        }
        Set<String> roles = employeeRoles(user);
        if (roles == null || !isAuthorized(roles)) {
            writeError(response, HttpStatus.FORBIDDEN, "insufficient role");
            return;
        }

        // Cached before the admin decision, so a refused rotation doesn't make every Logs poll re-introspect.
        validTokenCache.put(tokenHash, new CachedUser(now + CACHE_TTL_MS, roles));
        if (!adminCheckPasses(request, response, roles)) {
            return;
        }
        chain.doFilter(request, response);
    }

    /** Writes the 403 itself and returns false when it refuses. */
    private boolean adminCheckPasses(HttpServletRequest request, HttpServletResponse response,
                                     Set<String> roles) throws IOException {
        if (!requiresAdmin(request)) {
            return true;
        }
        if (containsAny(roles, config.getProxyAdminRoles())) {
            return true;
        }
        log.warn("Proxy auth: refusing {} {} — caller holds none of the admin roles {}",
                request.getMethod(), pathOf(request), config.getProxyAdminRoles());
        writeError(response, HttpStatus.FORBIDDEN, "NB_ADMIN_ROLE_REQUIRED",
                "Managing notification providers requires one of these roles: "
                        + String.join(", ", config.getProxyAdminRoles()));
        return false;
    }

    /** Admin roles count for the broad gate too; the default lists don't overlap (ACCOUNT_ADMIN). */
    private boolean isAuthorized(Set<String> roles) {
        return containsAny(roles, config.getProxyAllowedRoles())
                || containsAny(roles, config.getProxyAdminRoles());
    }

    private static boolean requiresAdmin(HttpServletRequest request) {
        if (!HttpMethod.POST.matches(request.getMethod())) {
            return false;
        }
        return isAdminOnly(pathOf(request));
    }

    /** Public so a test can state which endpoints are on the admin tier without re-listing them. */
    public static boolean isAdminOnly(String path) {
        return ADMIN_ONLY_PATHS.contains(normalize(path));
    }

    /** With or without the {@code /novu-bridge} context prefix, depending on the container. */
    private static String pathOf(HttpServletRequest request) {
        String path = request.getServletPath();
        if (!StringUtils.hasText(path)) {
            path = request.getRequestURI();
        }
        return path == null ? "" : path;
    }

    private static String normalize(String path) {
        int at = path.indexOf(NAMESPACE);
        String p = at < 0 ? path : path.substring(at);
        while (p.length() > 1 && p.endsWith("/")) {
            p = p.substring(0, p.length() - 1);
        }
        return p;
    }

    private static boolean containsAny(Set<String> roles, List<String> allowed) {
        if (roles == null || allowed == null) {
            return false;
        }
        for (String candidate : allowed) {
            if (candidate != null && roles.contains(candidate.trim().toUpperCase())) {
                return true;
            }
        }
        return false;
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> introspect(String token) {
        String url = config.getUserHost() + config.getUserDetailsPath() + "?access_token=" + token;
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        ResponseEntity<Map> res = restTemplate.exchange(url, HttpMethod.POST,
                new HttpEntity<>("{}", headers), Map.class);
        if (res.getStatusCode().is2xxSuccessful() && res.getBody() != null) {
            return (Map<String, Object>) res.getBody();
        }
        return null;
    }

    /** Upper-cased role codes, or null when the user is not an EMPLOYEE (whatever roles a citizen carries). */
    @SuppressWarnings("unchecked")
    private static Set<String> employeeRoles(Map<String, Object> user) {
        Object type = user.get("type");
        if (type == null || !"EMPLOYEE".equalsIgnoreCase(type.toString())) {
            return null;
        }
        Object rolesObj = user.get("roles");
        if (!(rolesObj instanceof List)) {
            return null;
        }
        Set<String> codes = new HashSet<>();
        for (Object roleObj : (List<Object>) rolesObj) {
            if (roleObj instanceof Map) {
                Object code = ((Map<String, Object>) roleObj).get("code");
                if (code != null && StringUtils.hasText(code.toString())) {
                    codes.add(code.toString().trim().toUpperCase());
                }
            }
        }
        return codes;
    }

    private void writeError(HttpServletResponse response, HttpStatus status, String message) throws IOException {
        response.setStatus(status.value());
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.getWriter().write("{\"error\":\"" + message + "\"}");
    }

    /** Adds the controllers' {@code Errors:[{code,message}]} shape, keeping the flat {@code error} key. */
    private void writeError(HttpServletResponse response, HttpStatus status, String code, String message)
            throws IOException {
        response.setStatus(status.value());
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.getWriter().write("{\"error\":\"" + message + "\","
                + "\"code\":\"" + code + "\","
                + "\"Errors\":[{\"code\":\"" + code + "\",\"message\":\"" + message + "\"}]}");
    }
}
