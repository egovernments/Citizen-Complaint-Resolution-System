package org.egov.novubridge.service.resolution.digit;

import lombok.extern.slf4j.Slf4j;
import org.egov.common.contract.request.RequestInfo;
import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.novubridge.service.resolution.LocaleProvider;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.lang.Nullable;
import org.springframework.util.StringUtils;
import org.springframework.web.client.RestTemplate;

import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Preferred language per user, from {@code digit-user-preferences-service}.
 *
 * <p><b>One paged call per STATE tenant per cache window, and failures and empties are cached
 * too.</b> That last part is the point: a forty-person role pool must not become forty lookups,
 * and a preference service that is absent — which is the normal state of most deployments — must
 * cost one call per window rather than one per recipient forever. The fallback is silent and
 * total: everyone renders in the deployment default, which is what happened before anyone could
 * express a preference at all.
 *
 * <p>Preferences are held at the state tenant because that is where the preference service keeps
 * them; a city tenant's users are found under its state root.
 */
@Slf4j
public class DigitLocaleProvider implements LocaleProvider {

    private static final int PAGE_LIMIT = 1000;

    private static final class Timed {
        final Map<String, String> byUuid;
        final long fetchedAt = System.currentTimeMillis();

        Timed(Map<String, String> byUuid) {
            this.byUuid = byUuid;
        }

        boolean fresh(long ttl) {
            return System.currentTimeMillis() - fetchedAt < ttl;
        }
    }

    private final RestTemplate restTemplate;
    private final NovuBridgeConfiguration config;
    private final Map<String, Timed> cache = new ConcurrentHashMap<>();

    public DigitLocaleProvider(@Nullable RestTemplate restTemplate, NovuBridgeConfiguration config) {
        this.restTemplate = restTemplate;
        this.config = config;
    }

    @Override
    @SuppressWarnings("unchecked")
    public Map<String, String> preferredLocales(String tenantId, RequestInfo requestInfo) {
        if (restTemplate == null || !StringUtils.hasText(config.getPreferenceHost())) {
            return Collections.emptyMap();
        }
        String tenant = MdmsNotificationConfigRepository.stateTenant(tenantId);
        if (tenant == null) {
            return Collections.emptyMap();
        }
        long ttl = config.getNotificationConfigCacheTtlMs() != null
                ? config.getNotificationConfigCacheTtlMs() : 60_000L;
        Timed cached = cache.get(tenant);
        if (cached != null && cached.fresh(ttl)) {
            return cached.byUuid;
        }

        Map<String, String> out = new HashMap<>();
        try {
            Map<String, Object> criteria = new LinkedHashMap<>();
            criteria.put("tenantId", tenant);
            criteria.put("preferenceCode", config.getPreferenceCode());
            criteria.put("limit", PAGE_LIMIT);
            criteria.put("offset", 0);
            Map<String, Object> body = new LinkedHashMap<>();
            body.put("RequestInfo", requestInfo != null ? requestInfo : new RequestInfo());
            body.put("criteria", criteria);
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);

            String url = config.getPreferenceHost() + config.getPreferenceSearchPath();
            ResponseEntity<Map> response = restTemplate.exchange(url, HttpMethod.POST,
                    new HttpEntity<>(body, headers), Map.class);
            Object preferences = response.getBody() == null ? null : response.getBody().get("preferences");
            if (preferences instanceof List) {
                for (Object element : (List<Object>) preferences) {
                    if (!(element instanceof Map)) {
                        continue;
                    }
                    Map<String, Object> preference = (Map<String, Object>) element;
                    Object userId = preference.get("userId");
                    Object payload = preference.get("payload");
                    Object language = payload instanceof Map
                            ? ((Map<String, Object>) payload).get("preferredLanguage") : null;
                    if (userId != null && language != null && StringUtils.hasText(language.toString())) {
                        out.put(userId.toString(), language.toString());
                    }
                }
            }
        } catch (Exception e) {
            log.warn("Preferred-language lookup unavailable for tenant {} ({}); rendering in the "
                    + "default locale", tenant, e.getMessage());
        }
        // Cached even when empty or failed: see the class javadoc. The cost of being wrong for
        // one TTL window is a message in the wrong language; the cost of not caching is a
        // per-recipient call to a service most deployments do not run.
        cache.put(tenant, new Timed(out));
        return out;
    }
}
