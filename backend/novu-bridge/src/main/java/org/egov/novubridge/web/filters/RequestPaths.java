package org.egov.novubridge.web.filters;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.util.StringUtils;
import org.springframework.web.util.UriUtils;

import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.Locale;

/**
 * The one reading of a request path that every filter decides on.
 *
 * <p>Spring MVC does not map the raw request URI: it drops each segment's path parameters
 * ({@code /v1;x/tenants} maps as {@code /v1/tenants}) and percent-decodes the segments. A filter
 * that matched the raw URI could therefore be told "not mine" for a request the controllers then
 * serve, which is how {@code /novu-adapter/v1;x/tenants} once reached the tenant admin API without
 * a token. So:
 * <ul>
 *   <li>{@link #rejection} names what a plain path never contains ({@code ;}, encoded {@code /},
 *       {@code \}, {@code .} or {@code %}, a control character, {@code //}, a {@code .} or
 *       {@code ..} segment). {@link RequestFirewallFilter} answers 400 for any of them, before any
 *       other filter, and the auth filters refuse them again on their own paths;</li>
 *   <li>{@link #canonical} is the path the way the request maps, and then some: per segment the
 *       path parameters dropped and the rest decoded, empty and {@code .} segments dropped,
 *       {@code ..} applied, no trailing slash, lower case. Every auth decision is made on it, so a
 *       variant a mapping might accept (case, a trailing slash, a dot segment) can only ever be
 *       judged MORE protected than its plain form, never less.</li>
 * </ul>
 */
public final class RequestPaths {

    /** Every API of the bridge lives under this prefix (inside the servlet context). */
    public static final String NAMESPACE = "/novu-adapter/v1";

    private RequestPaths() {
    }

    /**
     * What makes a raw request URI unacceptable, or {@code null} when it is a plain path. Applied to
     * the URI exactly as the client sent it (before any decoding).
     */
    public static String rejection(String rawUri) {
        if (rawUri == null || rawUri.isEmpty()) {
            return null;
        }
        String lower = rawUri.toLowerCase(Locale.ROOT);
        if (rawUri.indexOf(';') >= 0 || lower.contains("%3b")) {
            return "a path parameter (;)";
        }
        if (rawUri.indexOf('\\') >= 0 || lower.contains("%2f") || lower.contains("%5c")) {
            return "an encoded slash or a backslash";
        }
        if (lower.contains("%2e")) {
            return "an encoded period";
        }
        if (lower.contains("%25")) {
            return "an encoded percent sign";
        }
        for (int i = 0; i < rawUri.length(); i++) {
            char c = rawUri.charAt(i);
            if (c < 0x20 || c == 0x7f) {
                return "a control character";
            }
        }
        if (lower.matches(".*%[01][0-9a-f].*") || lower.contains("%7f")) {
            return "an encoded control character";
        }
        if (rawUri.contains("//")) {
            return "an empty path segment (//)";
        }
        for (String segment : rawUri.split("/", -1)) {
            if (".".equals(segment) || "..".equals(segment)) {
                return "a relative path segment (. or ..)";
            }
        }
        return null;
    }

    /**
     * The canonical form of a path: per segment, everything from the first {@code ;} dropped and the
     * rest percent-decoded (what Spring MVC maps); empty and {@code .} segments dropped and
     * {@code ..} applied; no trailing slash; lower case. {@code "/"} for an empty path.
     */
    public static String canonical(String path) {
        if (path == null || path.isEmpty()) {
            return "/";
        }
        Deque<String> segments = new ArrayDeque<>();
        for (String raw : path.split("/", -1)) {
            int semicolon = raw.indexOf(';');
            String segment = decode(semicolon < 0 ? raw : raw.substring(0, semicolon));
            if (segment.isEmpty() || ".".equals(segment)) {
                continue;
            }
            if ("..".equals(segment)) {
                segments.pollLast();
                continue;
            }
            segments.addLast(segment);
        }
        if (segments.isEmpty()) {
            return "/";
        }
        return ("/" + String.join("/", segments)).toLowerCase(Locale.ROOT);
    }

    /**
     * The request's canonical path from {@link #NAMESPACE} on (e.g. {@code /novu-adapter/v1/tenants/acme}),
     * or {@code ""} when the request is not inside the namespace. The context path is whatever precedes
     * the namespace, so this reads the same with or without {@code /novu-bridge}.
     */
    public static String inNamespace(HttpServletRequest request) {
        String raw = request.getRequestURI();
        if (!StringUtils.hasText(raw)) {
            raw = (request.getServletPath() == null ? "" : request.getServletPath())
                    + (request.getPathInfo() == null ? "" : request.getPathInfo());
        }
        String path = canonical(raw);
        int at = path.indexOf(NAMESPACE);
        while (at >= 0) {
            int end = at + NAMESPACE.length();
            if (end == path.length() || path.charAt(end) == '/') {
                return path.substring(at);
            }
            at = path.indexOf(NAMESPACE, at + 1);
        }
        return "";
    }

    /** The raw request URI's {@link #rejection}, or the servlet path's when there is no URI. */
    public static String rejection(HttpServletRequest request) {
        String raw = request.getRequestURI();
        return rejection(StringUtils.hasText(raw) ? raw : request.getServletPath());
    }

    /** {@code path} is {@code prefix} or below it, on a segment boundary. Both canonical. */
    public static boolean isAtOrUnder(String path, String prefix) {
        return path.startsWith(prefix) && (path.length() == prefix.length() || path.charAt(prefix.length()) == '/');
    }

    private static String decode(String segment) {
        if (segment.indexOf('%') < 0) {
            return segment;
        }
        try {
            return UriUtils.decode(segment, StandardCharsets.UTF_8);
        } catch (IllegalArgumentException e) {
            // Not decodable: Spring MVC would not map it either. Kept as sent, so it stays as
            // specific (and as protected) as its literal text.
            return segment;
        }
    }
}
