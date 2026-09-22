package org.egov.novubridge.service.resolution.digit;

/**
 * Joins host and path with exactly one slash: Compose hosts have no trailing slash, the k8s
 * {@code egov-service-host} ConfigMap ends every host with one, and {@code //path} is rejected.
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
