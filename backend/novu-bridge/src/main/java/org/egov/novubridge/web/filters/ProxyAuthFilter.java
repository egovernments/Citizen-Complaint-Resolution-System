package org.egov.novubridge.web.filters;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.extern.slf4j.Slf4j;
import org.egov.novubridge.config.NovuBridgeConfiguration;
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
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Server-side authentication for the configurator proxy endpoints
 * ({@code GET /novu-adapter/v1/logs}, {@code /novu-adapter/v1/integrations},
 * {@code /novu-adapter/v1/preferences}, the {@code /novu-adapter/v1/providers}
 * self-service management paths — GET/POST — and the {@code /novu-adapter/v1/dispatch}
 * diagnostic endpoints).
 *
 * <p>DIGIT access tokens are opaque OAuth tokens minted by egov-user. This filter
 * introspects the incoming {@code Authorization: Bearer <token>} against egov-user
 * {@code POST /user/_details?access_token=<token>} and allows the request only when
 * the resolved user is an {@code EMPLOYEE} carrying at least one role code from the
 * configured allowlist ({@code novu.bridge.proxy.allowed.roles}). A valid token's
 * resolved role codes are cached (keyed by SHA-256 hash, never the raw token) for 60s
 * so the Logs screen's polling does not hammer egov-user.
 *
 * <p><b>Two tiers.</b> Reading the screens (logs, integrations, preferences, the provider
 * catalog and templates) and exercising them (verify, test-send) needs a role from that broad
 * allowlist. The three calls that push credentials into Novu or destroy them — {@code POST
 * /providers}, {@code POST /providers/_update}, {@code POST /providers/_delete} — additionally
 * require a role from the narrower {@code novu.bridge.proxy.admin.roles}, and answer
 * {@code 403 NB_ADMIN_ROLE_REQUIRED} without it. Rotating an SMS gateway's password is a
 * config-admin act; a GRO holding a Logs-screen role must not be able to do it, whatever the
 * gateway's own access-control rows say.
 *
 * <p>The POST diagnostic endpoints under the same {@code /novu-adapter/v1} namespace
 * ({@code _validate}, {@code _dry-run}, {@code _test-trigger}) are gated by the same
 * URL pattern; they are additionally NOT routed publicly by Kong.
 */
@Slf4j
public class ProxyAuthFilter extends OncePerRequestFilter {

    private static final long CACHE_TTL_MS = 60_000L;
    private static final String BEARER_PREFIX = "Bearer ";
    private static final String NAMESPACE = "/novu-adapter/v1";

    /**
     * The credential-bearing and destructive provider calls. Exact paths, not a prefix: every
     * other {@code /providers/*} path (catalog, templates, twilio-templates, verify, test-send)
     * stays on the broad allowlist. They are POSTs by design — the gateway matches exact URLs,
     * so management calls cannot use PUT/DELETE with an id in the path.
     */
    private static final Set<String> ADMIN_ONLY_PATHS = Set.of(
            NAMESPACE + "/providers",
            NAMESPACE + "/providers/_update",
            NAMESPACE + "/providers/_delete",
            // _resolve expands role pools and answers with rendered bodies and filled contact
            // blocks — recipient PII for every holder of a role. The Logs screen's read tier is
            // deliberately broader than that.
            NAMESPACE + "/dispatch/_resolve");

    /** A resolved token: when it expires, and the role codes egov-user reported for it. */
    private static final class CachedUser {
        final long expiresAt;
        final Set<String> roles;
        CachedUser(long expiresAt, Set<String> roles) {
            this.expiresAt = expiresAt;
            this.roles = roles;
        }
    }

    private final RestTemplate restTemplate;
    private final NovuBridgeConfiguration config;
    // tokenHash -> resolved user. Never stores the raw token.
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
        // Delivery receipts are machine callbacks with their own shared-secret check.
        if (path.startsWith("/novu-adapter/v1/receipts")) {
            return true;
        }
        // Gateway adapters are called by the Novu worker, which holds no DIGIT token. They
        // authenticate on the provider credential headers Novu sends (see
        // SmsCountryAdapterController) and refuse without them.
        if (path.startsWith("/novu-adapter/v1/gateways")) {
            return true;
        }
        // The published contract (envelope JSON Schema, OpenAPI). Read-only descriptions of
        // the interface itself — no tenant data, no recipient, no credential, nothing about
        // this deployment — so they are served to anyone who can reach the service, the way
        // the docs that describe them already are. Stated explicitly rather than left to the
        // fall-through below, so adding a namespace to that list can never gate them by
        // accident (see ContractController).
        if (path.startsWith("/novu-adapter/v1/contract")) {
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
        String tokenHash = sha256(token);
        CachedUser cached = validTokenCache.get(tokenHash);
        if (cached != null && cached.expiresAt > now) {
            if (!adminCheckPasses(request, response, cached.roles)) {
                return;
            }
            chain.doFilter(request, response);
            return;
        }
        // Opportunistic sweep of expired entries.
        validTokenCache.entrySet().removeIf(e -> e.getValue().expiresAt <= now);

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

        // Cached on the broad grant, BEFORE the admin decision: an operator who is refused a
        // rotation must not then make the Logs screen re-introspect on every poll.
        validTokenCache.put(tokenHash, new CachedUser(now + CACHE_TTL_MS, roles));
        if (!adminCheckPasses(request, response, roles)) {
            return;
        }
        chain.doFilter(request, response);
    }

    /**
     * The second tier: on {@link #ADMIN_ONLY_PATHS} the caller additionally needs a role from
     * {@code novu.bridge.proxy.admin.roles}. Writes the 403 itself and returns false when it
     * refuses, so the caller can simply stop.
     */
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

    /**
     * The broad gate: a role from {@code proxy.allowed.roles} — or from
     * {@code proxy.admin.roles}, which is a superset by intent. The two lists are configured
     * separately and their defaults do not overlap completely (ACCOUNT_ADMIN is an admin but
     * not on the read allowlist); without this union an admin could rotate a credential and
     * still be refused the Logs screen, which is nonsense.
     */
    private boolean isAuthorized(Set<String> roles) {
        return containsAny(roles, config.getProxyAllowedRoles())
                || containsAny(roles, config.getProxyAdminRoles());
    }

    /** POST to one of the credential-bearing, destructive or PII-expanding paths. */
    private static boolean requiresAdmin(HttpServletRequest request) {
        if (!HttpMethod.POST.matches(request.getMethod())) {
            return false;
        }
        return isAdminOnly(pathOf(request));
    }

    /**
     * Whether a path is on the admin tier. Exposed so a test can state which endpoints are, and
     * which deliberately are not, rather than re-listing them and drifting from the set above.
     */
    public static boolean isAdminOnly(String path) {
        return ADMIN_ONLY_PATHS.contains(normalize(path));
    }

    /**
     * The request path as {@code /novu-adapter/v1/...}, whether the container reports it with
     * the {@code /novu-bridge} context prefix or without.
     */
    private static String pathOf(HttpServletRequest request) {
        String path = request.getServletPath();
        if (!StringUtils.hasText(path)) {
            path = request.getRequestURI();
        }
        return path == null ? "" : path;
    }

    /** Anchor at the namespace and drop a trailing slash so path matching is exact. */
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

    /** POST /user/_details?access_token=... — returns the flat user object or null on non-2xx. */
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

    /**
     * The user's role codes, upper-cased — or {@code null} when the introspected user is not an
     * {@code EMPLOYEE} (citizens never reach these endpoints, whatever roles they carry).
     * Returning the set rather than a boolean is what lets the admin tier reuse this one
     * introspection instead of asking egov-user again.
     */
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

    /**
     * The same refusal with a machine-readable {@code NB_*} code, in the shape the controllers'
     * errors already take ({@code Errors:[{code,message}]}) — plus the flat {@code error} key
     * the read-only paths have always written, so an existing client parsing that keeps working.
     */
    private void writeError(HttpServletResponse response, HttpStatus status, String code, String message)
            throws IOException {
        response.setStatus(status.value());
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.getWriter().write("{\"error\":\"" + message + "\","
                + "\"code\":\"" + code + "\","
                + "\"Errors\":[{\"code\":\"" + code + "\",\"message\":\"" + message + "\"}]}");
    }

    private static String sha256(String value) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] digest = md.digest(value.getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder(digest.length * 2);
            for (byte b : digest) {
                sb.append(String.format("%02x", b));
            }
            return sb.toString();
        } catch (Exception e) {
            return Integer.toHexString(value.hashCode());
        }
    }
}
