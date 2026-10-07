package org.egov.novubridge.web.filters;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.extern.slf4j.Slf4j;
import org.egov.novubridge.config.TenantAccountsConfiguration;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.util.StringUtils;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

/**
 * Authenticates the two MACHINE APIs added by #2203, which no person and no browser calls and
 * which Kong never routes (it terminates both prefixes with 404):
 * <ul>
 *   <li>{@code /novu-adapter/v1/tenants/**}, the tenant account admin API (provision, provider
 *       credentials, status, deprovision): the platform's onboarding worker and operators, with
 *       {@code novu.bridge.internal.admin.token};</li>
 *   <li>{@code POST /novu-adapter/v1/messages/_send}: the Identity BFF, with
 *       {@code novu.bridge.internal.send.token}. That token also reads a tenant's status
 *       ({@code GET /tenants/{id}}), the capability lookup a sender needs, and nothing else.</li>
 * </ul>
 * The token travels in {@value #HEADER} and is compared in constant time. A blank configured
 * token switches its API OFF (403 {@code NB_INTERNAL_API_DISABLED}): there is no default secret.
 * DIGIT user tokens are never accepted here, so a workspace admin cannot reach these endpoints
 * even with a valid session.
 */
@Slf4j
public class InternalAuthFilter extends OncePerRequestFilter {

    public static final String HEADER = "X-Novu-Bridge-Token";
    private static final String TENANTS = "/novu-adapter/v1/tenants";
    private static final String MESSAGES = "/novu-adapter/v1/messages";

    private final TenantAccountsConfiguration accounts;

    public InternalAuthFilter(TenantAccountsConfiguration accounts) {
        this.accounts = accounts;
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        String path = pathOf(request);
        return !(isTenants(path) || isMessages(path));
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        String path = pathOf(request);
        String presented = request.getHeader(HEADER);
        boolean messages = isMessages(path);
        // A tenant's status is the one read the send token may make.
        boolean statusRead = !messages && HttpMethod.GET.matches(request.getMethod()) && isTenantStatus(path);

        String admin = accounts.getInternalAdminToken();
        String send = accounts.getInternalSendToken();
        String required = messages ? send : admin;
        if (!StringUtils.hasText(required) && !(statusRead && StringUtils.hasText(send))) {
            write(response, HttpStatus.FORBIDDEN, "NB_INTERNAL_API_DISABLED", messages
                    ? "messages/_send is off: novu.bridge.internal.send.token is not set"
                    : "The tenant account admin API is off: novu.bridge.internal.admin.token is not set");
            return;
        }
        if (!StringUtils.hasText(presented)) {
            write(response, HttpStatus.UNAUTHORIZED, "NB_INTERNAL_TOKEN_REQUIRED", "Missing " + HEADER);
            return;
        }
        boolean ok = matches(required, presented) || (statusRead && matches(send, presented));
        if (!ok) {
            log.warn("Internal API: refusing {} {} — wrong {}", request.getMethod(), path, HEADER);
            write(response, HttpStatus.UNAUTHORIZED, "NB_INTERNAL_TOKEN_INVALID", "Invalid " + HEADER);
            return;
        }
        chain.doFilter(request, response);
    }

    private static boolean matches(String expected, String presented) {
        return StringUtils.hasText(expected) && presented != null && MessageDigest.isEqual(
                expected.trim().getBytes(StandardCharsets.UTF_8), presented.trim().getBytes(StandardCharsets.UTF_8));
    }

    private static boolean isTenants(String path) {
        int at = path.indexOf(TENANTS);
        return at >= 0 && (path.length() == at + TENANTS.length() || path.charAt(at + TENANTS.length()) == '/');
    }

    private static boolean isMessages(String path) {
        int at = path.indexOf(MESSAGES);
        return at >= 0 && (path.length() == at + MESSAGES.length() || path.charAt(at + MESSAGES.length()) == '/');
    }

    /** {@code /tenants/{id}} exactly: one segment after the prefix. */
    private static boolean isTenantStatus(String path) {
        String rest = path.substring(path.indexOf(TENANTS) + TENANTS.length());
        while (rest.endsWith("/")) {
            rest = rest.substring(0, rest.length() - 1);
        }
        return rest.startsWith("/") && rest.indexOf('/', 1) < 0 && rest.length() > 1;
    }

    private static String pathOf(HttpServletRequest request) {
        String path = request.getRequestURI();
        if (!StringUtils.hasText(path)) {
            path = request.getServletPath();
        }
        return path == null ? "" : path;
    }

    private static void write(HttpServletResponse response, HttpStatus status, String code, String message)
            throws IOException {
        response.setStatus(status.value());
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.getWriter().write("{\"code\":\"" + code + "\",\"Errors\":[{\"code\":\"" + code
                + "\",\"message\":\"" + message + "\"}]}");
    }
}
