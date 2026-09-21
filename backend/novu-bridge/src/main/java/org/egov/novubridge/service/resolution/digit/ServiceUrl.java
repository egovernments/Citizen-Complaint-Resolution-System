package org.egov.novubridge.service.resolution.digit;

/**
 * Joins a configured service host and a path with exactly one slash between them.
 *
 * <p>The two deployment tiers disagree about the host's shape: the Compose file sets hosts
 * without a trailing slash, while the Kubernetes {@code egov-service-host} ConfigMap ends every
 * host with one ({@code http://egov-localization.egov:8080/}). Plain concatenation therefore
 * yields {@code //localization/...} on one tier, which some servers reject.
 */
final class ServiceUrl {

    private ServiceUrl() {
    }

    static String join(String host, String path) {
        String h = host == null ? "" : host.trim();
        String p = path == null ? "" : path.trim();
        while (h.endsWith("/")) {
            h = h.substring(0, h.length() - 1);
        }
        if (!p.isEmpty() && !p.startsWith("/")) {
            p = "/" + p;
        }
        return h + p;
    }
}
