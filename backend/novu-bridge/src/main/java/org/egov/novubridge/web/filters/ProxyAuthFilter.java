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
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Collectors;

/**
 * Server-side authentication for the configurator proxy endpoints
 * ({@code GET /novu-adapter/v1/logs}, {@code /novu-adapter/v1/integrations},
 * {@code /novu-adapter/v1/preferences} and the {@code /novu-adapter/v1/providers}
 * self-service management paths — GET/POST).
 *
 * <p>DIGIT access tokens are opaque OAuth tokens minted by egov-user. This filter
 * introspects the incoming {@code Authorization: Bearer <token>} against egov-user
 * {@code POST /user/_details?access_token=<token>} and allows the request only when
 * the resolved user is an {@code EMPLOYEE} carrying at least one role code from the
 * configured allowlist ({@code novu.bridge.proxy.allowed.roles}). A valid token is
 * cached (by SHA-256 hash, never raw) for 60s so the Logs screen's polling does not
 * hammer egov-user.
 *
 * <p>The POST diagnostic endpoints under the same {@code /novu-adapter/v1} namespace
 * ({@code _validate}, {@code _dry-run}, {@code _test-trigger}) are gated by the same
 * URL pattern; they are additionally NOT routed publicly by Kong.
 */
@Slf4j
public class ProxyAuthFilter extends OncePerRequestFilter {

    private static final long CACHE_TTL_MS = 60_000L;
    private static final String BEARER_PREFIX = "Bearer ";

    private final RestTemplate restTemplate;
    private final NovuBridgeConfiguration config;
    // tokenHash -> expiry epoch millis. Never stores the raw token.
    private final ConcurrentHashMap<String, Long> validTokenCache = new ConcurrentHashMap<>();

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
        String path = request.getServletPath();
        if (!StringUtils.hasText(path)) {
            path = request.getRequestURI();
        }
        return !(path.startsWith("/novu-adapter/v1/logs")
                || path.startsWith("/novu-adapter/v1/integrations")
                || path.startsWith("/novu-adapter/v1/preferences")
                || path.startsWith("/novu-adapter/v1/providers"));
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
        Long expiry = validTokenCache.get(tokenHash);
        if (expiry != null && expiry > now) {
            chain.doFilter(request, response);
            return;
        }
        // Opportunistic sweep of expired entries.
        validTokenCache.entrySet().removeIf(e -> e.getValue() <= now);

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
        if (!isAuthorized(user)) {
            writeError(response, HttpStatus.FORBIDDEN, "insufficient role");
            return;
        }

        validTokenCache.put(tokenHash, now + CACHE_TTL_MS);
        chain.doFilter(request, response);
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

    /** Allow EMPLOYEE users carrying at least one allowlisted role code. */
    @SuppressWarnings("unchecked")
    private boolean isAuthorized(Map<String, Object> user) {
        Object type = user.get("type");
        if (type == null || !"EMPLOYEE".equalsIgnoreCase(type.toString())) {
            return false;
        }
        Object rolesObj = user.get("roles");
        if (!(rolesObj instanceof List)) {
            return false;
        }
        Set<String> allowed = config.getProxyAllowedRoles().stream()
                .map(r -> r.trim().toUpperCase())
                .collect(Collectors.toSet());
        for (Object roleObj : (List<Object>) rolesObj) {
            if (roleObj instanceof Map) {
                Object code = ((Map<String, Object>) roleObj).get("code");
                if (code != null && allowed.contains(code.toString().toUpperCase())) {
                    return true;
                }
            }
        }
        return false;
    }

    private void writeError(HttpServletResponse response, HttpStatus status, String message) throws IOException {
        response.setStatus(status.value());
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.getWriter().write("{\"error\":\"" + message + "\"}");
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
