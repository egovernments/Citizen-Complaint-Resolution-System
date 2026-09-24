package org.egov.novubridge.web.filters;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.extern.slf4j.Slf4j;
import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.novubridge.util.Values;
import org.egov.novubridge.util.ServiceUrl;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.util.StringUtils;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.context.request.RequestAttributes;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Authenticates the configurator endpoints: the opaque DIGIT bearer token is introspected against
 * egov-user {@code /user/_details}; the caller must be an EMPLOYEE with a role from
 * {@code novu.bridge.proxy.allowed.roles}. Credential-bearing, destructive, PII-expanding and
 * message-sending POSTs additionally need a role from {@code novu.bridge.proxy.admin.roles} held
 * at a STATE tenant (403 {@code NB_ADMIN_ROLE_REQUIRED}): providers are deployment-wide, so a
 * city admin must not rotate or delete the one its state sends through. Tenant-scoped reads
 * ({@code /logs}, {@code /config/source}) are limited to the caller's tenants (403
 * {@code NB_TENANT_NOT_ALLOWED}). The resolved {@link Caller} is cached 60s keyed by SHA-256 of
 * the token, never the raw token, and handed to the controllers as a request attribute.
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
            // Both send a real message, of the caller's wording, to any number, through the
            // government sender. _dry-run always: its send flag is in the body, and without it
            // _dry-run is _validate.
            NAMESPACE + "/providers/test-send",
            NAMESPACE + "/dispatch/_dry-run",
            // _resolve answers with filled contact blocks: recipient PII for every holder of a role.
            NAMESPACE + "/dispatch/_resolve");

    /** GETs whose {@code tenantId} query parameter must be one of the caller's tenants. */
    private static final Set<String> TENANT_SCOPED_READS = Set.of(
            NAMESPACE + "/logs",
            NAMESPACE + "/config/source");

    /** Request attribute carrying the {@link Caller}; read it with {@link #currentCaller()}. */
    public static final String CALLER_ATTRIBUTE = ProxyAuthFilter.class.getName() + ".caller";

    /**
     * The authenticated employee, from egov-user {@code /user/_details} (whose role objects carry
     * their own {@code tenantId}).
     *
     * @param scopeTenants      the user's own tenant plus every tenant it holds an allowed or admin role at
     * @param adminStateTenants the state tenants (no dot) at which it holds an admin role
     */
    public record Caller(Set<String> roles, Set<String> scopeTenants, Set<String> adminStateTenants) {

        /** One of its tenants, or, for a state-level caller, a city of that state. Exact, like the SQL. */
        public boolean mayRead(String tenantId) {
            if (!StringUtils.hasText(tenantId)) {
                return false;
            }
            if (scopeTenants.contains(tenantId)) {
                return true;
            }
            int dot = tenantId.indexOf('.');
            return dot > 0 && scopeTenants.contains(tenantId.substring(0, dot));
        }
    }

    /** The current request's caller; null when proxy auth is off (local dev) or outside a request. */
    public static Caller currentCaller() {
        RequestAttributes attributes = RequestContextHolder.getRequestAttributes();
        Object caller = attributes == null ? null
                : attributes.getAttribute(CALLER_ATTRIBUTE, RequestAttributes.SCOPE_REQUEST);
        return caller instanceof Caller c ? c : null;
    }

    private record CachedUser(long expiresAt, Caller caller) {
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
            proceed(request, response, chain, cached.caller());
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
        Caller caller = employee(user);
        if (caller == null || !isAuthorized(caller.roles())) {
            writeError(response, HttpStatus.FORBIDDEN, "insufficient role");
            return;
        }

        // Cached before the admin decision, so a refused rotation doesn't make every Logs poll re-introspect.
        validTokenCache.put(tokenHash, new CachedUser(now + CACHE_TTL_MS, caller));
        proceed(request, response, chain, caller);
    }

    /** The per-request checks, on a fresh and on a cached token alike. */
    private void proceed(HttpServletRequest request, HttpServletResponse response, FilterChain chain,
                         Caller caller) throws IOException, ServletException {
        if (!adminCheckPasses(request, response, caller) || !tenantCheckPasses(request, response, caller)) {
            return;
        }
        request.setAttribute(CALLER_ATTRIBUTE, caller);
        chain.doFilter(request, response);
    }

    /** Writes the 403 itself and returns false when it refuses. */
    private boolean adminCheckPasses(HttpServletRequest request, HttpServletResponse response,
                                     Caller caller) throws IOException {
        if (!requiresAdmin(request)) {
            return true;
        }
        if (!caller.adminStateTenants().isEmpty()) {
            return true;
        }
        log.warn("Proxy auth: refusing {} {} — caller holds none of the admin roles {} at a state tenant",
                request.getMethod(), pathOf(request), config.getProxyAdminRoles());
        writeError(response, HttpStatus.FORBIDDEN, "NB_ADMIN_ROLE_REQUIRED",
                "This needs one of these roles held at a state tenant (e.g. ke, not ke.bomet): "
                        + String.join(", ", config.getProxyAdminRoles()));
        return false;
    }

    /** Every {@code tenantId} value must be the caller's; a missing one is the controller's 400. */
    private boolean tenantCheckPasses(HttpServletRequest request, HttpServletResponse response,
                                      Caller caller) throws IOException {
        if (!TENANT_SCOPED_READS.contains(normalize(pathOf(request)))) {
            return true;
        }
        String[] tenantIds = request.getParameterValues("tenantId");
        if (tenantIds == null) {
            return true;
        }
        for (String tenantId : tenantIds) {
            if (StringUtils.hasText(tenantId) && !caller.mayRead(tenantId)) {
                log.warn("Proxy auth: refusing {} {} for tenant {} — outside the caller's tenants {}",
                        request.getMethod(), pathOf(request), tenantId, caller.scopeTenants());
                // Not echoed: writeError concatenates, and this value is the caller's.
                writeError(response, HttpStatus.FORBIDDEN, "NB_TENANT_NOT_ALLOWED",
                        "The requested tenant is not your own tenant, nor a city of your state");
                return false;
            }
        }
        return true;
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
        String url = ServiceUrl.join(config.getUserHost(), config.getUserDetailsPath()) + "?access_token=" + token;
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        ResponseEntity<Map> res = restTemplate.exchange(url, HttpMethod.POST,
                new HttpEntity<>("{}", headers), Map.class);
        if (res.getStatusCode().is2xxSuccessful() && res.getBody() != null) {
            return (Map<String, Object>) res.getBody();
        }
        return null;
    }

    /**
     * The caller, or null when the user is not an EMPLOYEE (whatever roles a citizen carries). A
     * role without a {@code tenantId} still counts for the broad gate, never for scope or admin.
     */
    @SuppressWarnings("unchecked")
    private Caller employee(Map<String, Object> user) {
        Object type = user.get("type");
        if (type == null || !"EMPLOYEE".equalsIgnoreCase(type.toString())) {
            return null;
        }
        Object rolesObj = user.get("roles");
        if (!(rolesObj instanceof List)) {
            return null;
        }
        Set<String> codes = new HashSet<>();
        Set<String> scope = new LinkedHashSet<>();
        Set<String> adminStates = new LinkedHashSet<>();
        Object ownTenant = user.get("tenantId");
        if (ownTenant != null && StringUtils.hasText(ownTenant.toString())) {
            scope.add(ownTenant.toString().trim());
        }
        for (Object roleObj : (List<Object>) rolesObj) {
            if (!(roleObj instanceof Map)) {
                continue;
            }
            Object code = ((Map<String, Object>) roleObj).get("code");
            if (code == null || !StringUtils.hasText(code.toString())) {
                continue;
            }
            String upper = code.toString().trim().toUpperCase();
            codes.add(upper);
            Object roleTenant = ((Map<String, Object>) roleObj).get("tenantId");
            String tenant = roleTenant == null ? "" : roleTenant.toString().trim();
            if (tenant.isEmpty()) {
                continue;
            }
            boolean admin = containsAny(Set.of(upper), config.getProxyAdminRoles());
            if (admin || containsAny(Set.of(upper), config.getProxyAllowedRoles())) {
                scope.add(tenant);
            }
            if (admin && tenant.indexOf('.') < 0) {
                adminStates.add(tenant);
            }
        }
        return new Caller(Set.copyOf(codes), Set.copyOf(scope), Set.copyOf(adminStates));
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
