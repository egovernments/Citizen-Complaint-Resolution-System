package org.egov.identity.keycloak.phone;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Pattern;
import org.egov.identity.keycloak.config.OtpSettings;
import org.jboss.logging.Logger;

/**
 * Resolves a tenant's mobile-number rule from the identity BFF's public
 * branding endpoint ({@code GET /identity/v1/tenant-contexts/{slug}/branding}
 * → {@code mobileValidation}), with a short in-memory cache per Keycloak node.
 *
 * <p>Any failure (no slug, BFF down, null mobileValidation, unusable regex)
 * yields the configured default so a citizen is never locked out by a
 * branding outage; the failure is cached for a shorter time so the BFF is not
 * hammered while it is down.
 */
public final class TenantMobileValidationResolver {

    public static final Pattern TENANT_SLUG = Pattern.compile("^[a-z0-9-]{2,63}$");
    private static final Logger LOG = Logger.getLogger(TenantMobileValidationResolver.class);
    private static final Duration FAILURE_TTL = Duration.ofSeconds(30);
    private static final int MAX_CACHE_ENTRIES = 1024;

    /** Fetches the branding JSON body for a URL; returns empty on a non-200. */
    public interface Fetcher {
        Optional<String> get(URI uri) throws IOException, InterruptedException;
    }

    private record Entry(MobileValidation value, Instant expiresAt) {
    }

    private final OtpSettings settings;
    private final Fetcher fetcher;
    private final Clock clock;
    private final MobileValidation fallback;
    private final ObjectMapper json = new ObjectMapper();
    private final ConcurrentHashMap<String, Entry> cache = new ConcurrentHashMap<>();

    public TenantMobileValidationResolver(OtpSettings settings, Fetcher fetcher, Clock clock) {
        this.settings = settings;
        this.fetcher = fetcher;
        this.clock = clock;
        this.fallback = MobileValidation.of(settings.defaultCountryCode(), settings.defaultMobileRegex(), null);
    }

    public static TenantMobileValidationResolver http(OtpSettings settings) {
        HttpClient client = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(2))
                .followRedirects(HttpClient.Redirect.NEVER)
                .build();
        Fetcher fetcher = uri -> {
            HttpRequest request = HttpRequest.newBuilder(uri)
                    .timeout(Duration.ofSeconds(3))
                    .header("Accept", "application/json")
                    .GET()
                    .build();
            HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
            return response.statusCode() == 200 ? Optional.of(response.body()) : Optional.empty();
        };
        return new TenantMobileValidationResolver(settings, fetcher, Clock.systemUTC());
    }

    public MobileValidation fallback() {
        return fallback;
    }

    public MobileValidation resolve(String tenantSlug) {
        if (tenantSlug == null || !TENANT_SLUG.matcher(tenantSlug).matches() || settings.tenantContextUrl().isEmpty()) {
            return fallback;
        }
        Instant now = clock.instant();
        Entry cached = cache.get(tenantSlug);
        if (cached != null && now.isBefore(cached.expiresAt())) {
            return cached.value();
        }
        MobileValidation fetched = fetch(tenantSlug);
        MobileValidation value = fetched != null ? fetched : fallback;
        Duration ttl = fetched != null ? settings.tenantCacheTtl() : FAILURE_TTL;
        if (cache.size() >= MAX_CACHE_ENTRIES) {
            cache.clear();
        }
        cache.put(tenantSlug, new Entry(value, now.plus(ttl)));
        return value;
    }

    private MobileValidation fetch(String tenantSlug) {
        URI uri = URI.create(settings.tenantContextUrl() + "/identity/v1/tenant-contexts/"
                + URLEncoder.encode(tenantSlug, StandardCharsets.UTF_8) + "/branding");
        try {
            Optional<String> body = fetcher.get(uri);
            if (body.isEmpty()) {
                LOG.debugf("no branding for tenant %s", tenantSlug);
                return null;
            }
            JsonNode node = json.readTree(body.get()).path("mobileValidation");
            if (!node.isObject()) {
                return null;
            }
            return MobileValidation.of(
                    text(node, "countryCode"), text(node, "mobileNumberRegex"), text(node, "errorMessage"));
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return null;
        } catch (IOException | RuntimeException e) {
            LOG.warnf("tenant mobile validation lookup failed for %s: %s", tenantSlug, e.toString());
            return null;
        }
    }

    private static String text(JsonNode node, String field) {
        JsonNode value = node.get(field);
        return value != null && value.isTextual() ? value.asText() : null;
    }
}
