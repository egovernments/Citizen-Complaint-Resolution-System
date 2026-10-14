package org.egov.novubridge.web.filters;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;

/**
 * The first filter of every request: refuses (400 {@code NB_REQUEST_REJECTED}) a request URI that
 * a plain client never sends and that the servlet container and Spring MVC could read differently
 * from the auth filters: a path parameter ({@code ;}), an encoded {@code /}, {@code \}, {@code .}
 * or {@code %}, a control character, {@code //}, or a {@code .} / {@code ..} segment. The same
 * idea as Spring Security's StrictHttpFirewall, which this service does not use. See
 * {@link RequestPaths}.
 */
@Slf4j
public class RequestFirewallFilter extends OncePerRequestFilter {

    public static final String CODE = "NB_REQUEST_REJECTED";

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        String why = RequestPaths.rejection(request);
        if (why != null) {
            log.warn("Refusing {} with {} in its path", request.getMethod(), why);
            reject(response, why);
            return;
        }
        chain.doFilter(request, response);
    }

    /** Also used by the auth filters, which refuse the same paths on their own. */
    static void reject(HttpServletResponse response, String why) throws IOException {
        response.setStatus(HttpStatus.BAD_REQUEST.value());
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        // `why` is one of RequestPaths' fixed phrases, never request text.
        response.getWriter().write("{\"code\":\"" + CODE + "\",\"Errors\":[{\"code\":\"" + CODE
                + "\",\"message\":\"The request path contains " + why + "\"}]}");
    }
}
