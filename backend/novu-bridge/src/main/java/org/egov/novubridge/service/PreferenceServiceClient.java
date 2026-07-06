package org.egov.novubridge.service;

import lombok.extern.slf4j.Slf4j;
import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.novubridge.util.PiiMask;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import org.springframework.web.client.RestTemplate;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Service
@Slf4j
public class PreferenceServiceClient {

    private final RestTemplate restTemplate;
    private final NovuBridgeConfiguration config;

    public PreferenceServiceClient(RestTemplate restTemplate, NovuBridgeConfiguration config) {
        this.restTemplate = restTemplate;
        this.config = config;
    }

    public boolean isChannelAllowed(String tenantId, String userId, String mobile, String channel) {
        String channelKey = StringUtils.hasText(channel) ? channel.toUpperCase() : "SMS";
        log.info("Preference check: tenantId={}, userId={}, mobile={}, channel={}, preferenceEnabled={}",
                tenantId, userId, PiiMask.mask(mobile), channelKey, config.getPreferenceEnabled());

        if (Boolean.FALSE.equals(config.getPreferenceEnabled())) {
            log.info("Preference check disabled, allowing by default");
            return true;
        }
        if (!StringUtils.hasText(userId)) {
            log.warn("Preference check denied: userId is blank. tenantId={}, mobile={}", tenantId, PiiMask.mask(mobile));
            return false;
        }
        try {
            Map<String, Object> payload = new HashMap<>();
            payload.put("requestInfo", new HashMap<>());
            payload.put("criteria", Map.of(
                    "userId", userId,
                    "tenantId", tenantId,
                    "preferenceCode", config.getPreferenceCode(),
                    "limit", 1,
                    "offset", 0
            ));

            String url = config.getPreferenceHost() + config.getPreferenceCheckPath();
            log.info("Preference request: url={}, preferenceCode={}, userId={}, tenantId={}",
                    url, config.getPreferenceCode(), userId, tenantId);

            ResponseEntity<Map> response = restTemplate.exchange(url, HttpMethod.POST, new HttpEntity<>(payload), Map.class);
            log.info("Preference response: statusCode={}, body={}", response.getStatusCode(), response.getBody());

            if (!response.getStatusCode().is2xxSuccessful() || response.getBody() == null) {
                log.warn("Preference check denied: non-success response. statusCode={}", response.getStatusCode());
                return false;
            }
            List<Map<String, Object>> preferences = (List<Map<String, Object>>) response.getBody().get("preferences");
            if (preferences == null || preferences.isEmpty()) {
                log.warn("Preference check denied: no preferences found for userId={}, tenantId={}", userId, tenantId);
                return false;
            }

            Map<String, Object> pref = preferences.get(0);
            Map<String, Object> prefPayload = (Map<String, Object>) pref.get("payload");
            if (prefPayload == null) {
                log.warn("Preference check denied: preference payload is null. pref={}", pref);
                return false;
            }
            Map<String, Object> consent = (Map<String, Object>) prefPayload.get("consent");
            if (consent == null) {
                log.warn("Preference check denied: consent block is null. prefPayload={}", prefPayload);
                return false;
            }
            Map<String, Object> channelConsent = (Map<String, Object>) consent.get(channelKey);
            if (channelConsent == null) {
                log.warn("Preference check denied: {} consent not found. consent={}", channelKey, consent);
                return false;
            }
            String status = value(channelConsent.get("status"));
            String scope = value(channelConsent.get("scope"));
            String scopeTenant = value(channelConsent.get("tenantId"));

            log.info("Preference {} consent: status={}, scope={}, scopeTenant={}", channelKey, status, scope, scopeTenant);

            if (!"GRANTED".equalsIgnoreCase(status)) {
                log.warn("Preference check denied: status is not GRANTED. status={}", status);
                return false;
            }
//            if ("TENANT".equalsIgnoreCase(scope)) {
//                return tenantId.equalsIgnoreCase(scopeTenant);
//            }
            log.info("Preference check allowed for userId={}, tenantId={}, channel={}", userId, tenantId, channelKey);
            return true;
        } catch (Exception e) {
            log.warn("Preference check failed. tenantId={} userId={} mobile={} channel={}", tenantId, userId, PiiMask.mask(mobile), channelKey, e);
            return false;
        }
    }

    public String getUserPreferredLocale(String tenantId, String userId, String defaultLocale) {
        log.info("Getting preferred locale: tenantId={}, userId={}, preferenceEnabled={}",
                tenantId, userId, config.getPreferenceEnabled());

        if (Boolean.FALSE.equals(config.getPreferenceEnabled())) {
            log.info("Preference check disabled, using default locale: {}", defaultLocale);
            return defaultLocale;
        }
        if (!StringUtils.hasText(userId)) {
            log.warn("Cannot get locale: userId is blank. tenantId={}, using default: {}", tenantId, defaultLocale);
            return defaultLocale;
        }
        try {
            Map<String, Object> payload = new HashMap<>();
            payload.put("requestInfo", new HashMap<>());
            payload.put("criteria", Map.of(
                    "userId", userId,
                    "tenantId", tenantId,
                    "preferenceCode", config.getPreferenceCode(),
                    "limit", 1,
                    "offset", 0
            ));

            String url = config.getPreferenceHost() + config.getPreferenceCheckPath();
            log.info("Preference request for locale: url={}, preferenceCode={}, userId={}, tenantId={}",
                    url, config.getPreferenceCode(), userId, tenantId);

            ResponseEntity<Map> response = restTemplate.exchange(url, HttpMethod.POST, new HttpEntity<>(payload), Map.class);
            log.info("Preference response for locale: statusCode={}", response.getStatusCode());

            if (!response.getStatusCode().is2xxSuccessful() || response.getBody() == null) {
                log.warn("Cannot get locale: non-success response. statusCode={}, using default: {}", response.getStatusCode(), defaultLocale);
                return defaultLocale;
            }
            List<Map<String, Object>> preferences = (List<Map<String, Object>>) response.getBody().get("preferences");
            if (preferences == null || preferences.isEmpty()) {
                log.warn("Cannot get locale: no preferences found for userId={}, tenantId={}, using default: {}", userId, tenantId, defaultLocale);
                return defaultLocale;
            }

            Map<String, Object> pref = preferences.get(0);
            Map<String, Object> prefPayload = (Map<String, Object>) pref.get("payload");
            if (prefPayload == null) {
                log.warn("Cannot get locale: preference payload is null. using default: {}", defaultLocale);
                return defaultLocale;
            }
            
            String preferredLanguage = value(prefPayload.get("preferredLanguage"));
            if (!StringUtils.hasText(preferredLanguage)) {
                log.warn("Cannot get locale: preferredLanguage is blank. using default: {}", defaultLocale);
                return defaultLocale;
            }

            log.info("Found user preferred locale: {} for userId={}, tenantId={}", preferredLanguage, userId, tenantId);
            return preferredLanguage;
        } catch (Exception e) {
            log.warn("Error getting preferred locale for tenantId={} userId={}, using default: {}", tenantId, userId, defaultLocale, e);
            return defaultLocale;
        }
    }

    /**
     * List the raw user notification preference records for a tenant (or all
     * tenants when {@code tenantId} is blank), paged via {@code limit}/{@code offset}.
     * Returns the raw {@code preferences} list from the preference service search
     * response; the caller is responsible for allowlist-projecting each record
     * before it leaves the service. Returns an empty list on any error or when no
     * records are found, mirroring the defensive style of the other search calls.
     */
    public List<Map<String, Object>> listPreferences(String tenantId, int limit, int offset) {
        log.info("Listing preferences: tenantId={}, limit={}, offset={}, preferenceEnabled={}",
                tenantId, limit, offset, config.getPreferenceEnabled());
        try {
            Map<String, Object> criteria = new HashMap<>();
            criteria.put("preferenceCode", config.getPreferenceCode());
            if (StringUtils.hasText(tenantId)) {
                criteria.put("tenantId", tenantId);
            }
            criteria.put("limit", limit);
            criteria.put("offset", offset);

            Map<String, Object> payload = new HashMap<>();
            payload.put("requestInfo", new HashMap<>());
            payload.put("criteria", criteria);

            String url = config.getPreferenceHost() + config.getPreferenceCheckPath();
            log.info("Preference list request: url={}, preferenceCode={}, tenantId={}, limit={}, offset={}",
                    url, config.getPreferenceCode(), tenantId, limit, offset);

            ResponseEntity<Map> response = restTemplate.exchange(url, HttpMethod.POST, new HttpEntity<>(payload), Map.class);
            log.info("Preference list response: statusCode={}", response.getStatusCode());

            if (!response.getStatusCode().is2xxSuccessful() || response.getBody() == null) {
                log.warn("Cannot list preferences: non-success response. statusCode={}", response.getStatusCode());
                return new ArrayList<>();
            }
            List<Map<String, Object>> preferences = (List<Map<String, Object>>) response.getBody().get("preferences");
            if (preferences == null || preferences.isEmpty()) {
                log.warn("No preferences found for tenantId={}, limit={}, offset={}", tenantId, limit, offset);
                return new ArrayList<>();
            }
            return preferences;
        } catch (Exception e) {
            log.warn("Error listing preferences for tenantId={}, limit={}, offset={}", tenantId, limit, offset, e);
            return new ArrayList<>();
        }
    }

    private String value(Object o) {
        return o == null ? null : String.valueOf(o);
    }
}
