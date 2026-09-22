package org.egov.novubridge.service.resolution.digit;

import lombok.extern.slf4j.Slf4j;
import org.egov.common.contract.request.RequestInfo;
import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.novubridge.service.resolution.LocaleProvider;
import org.egov.novubridge.util.ServiceUrl;
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

/**
 * Preferred language per user, from {@code digit-user-preferences-service}, at the state tenant.
 * One call per state tenant per cache window, and empty or failed answers are cached too: most
 * deployments do not run the service, and it must not cost a call per recipient.
 */
@Slf4j
public class DigitLocaleProvider implements LocaleProvider {

    private static final int PAGE_LIMIT = 1000;

    private final RestTemplate restTemplate;
    private final NovuBridgeConfiguration config;
    private final TtlCache<String, Map<String, String>> cache = new TtlCache<>();

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
        Map<String, String> cached = cache.fresh(tenant, ttl);
        if (cached != null) {
            return cached;
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

            String url = ServiceUrl.join(config.getPreferenceHost(), config.getPreferenceSearchPath());
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
        cache.put(tenant, out);
        return out;
    }
}
