package org.egov.novubridge.util;

/**
 * Joins host and path with exactly one slash: Compose hosts have no trailing slash, the k8s
 * {@code egov-service-host} ConfigMap ends every host with one, and {@code //path} is rejected.
 * EVERY configured host that gets a path appended goes through here; a bare {@code host + path}
 * works on Compose and fails on Kubernetes.
 */
public final class ServiceUrl {

    private ServiceUrl() {
    }

    public static String join(String host, String path) {
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
