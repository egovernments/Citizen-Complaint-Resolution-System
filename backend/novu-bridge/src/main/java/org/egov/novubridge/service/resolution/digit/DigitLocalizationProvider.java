package org.egov.novubridge.service.resolution.digit;

import lombok.extern.slf4j.Slf4j;
import org.egov.common.contract.request.RequestInfo;
import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.novubridge.service.resolution.LocalizationProvider;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.lang.Nullable;
import org.springframework.util.StringUtils;
import org.springframework.web.client.RestTemplate;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Localization code to message, from egov-localization.
 *
 * <p>Reads one (tenant, locale, module) at a time and caches the whole module's messages, because
 * that is the shape of the upstream call — it answers a module, not a code — and because a
 * thirteen-placeholder event would otherwise be thirteen HTTP round trips.
 *
 * <p><b>Fail-open, and open means RAW.</b> A module that cannot be fetched is cached as an empty
 * map for the window and every code in it misses, so the caller falls back to the literal value
 * the producer sent — a raw status code instead of "Pending at LME" — or leaves the token's braces
 * literal when there is no literal either. That is what the code being replaced does, and it is
 * the right failure: a raw value is ugly and true, whereas blanking the token produces a message
 * with a hole in it, and an all-blank WhatsApp template is what a provider rejects outright.
 *
 * <p>Messages are held at the STATE tenant. A city tenant's messages are its state's.
 */
@Slf4j
public class DigitLocalizationProvider implements LocalizationProvider {

    private static final class Timed {
        final Map<String, String> messages;
        final long fetchedAt = System.currentTimeMillis();

        Timed(Map<String, String> messages) {
            this.messages = messages;
        }

        boolean fresh(long ttl) {
            return System.currentTimeMillis() - fetchedAt < ttl;
        }
    }

    private final RestTemplate restTemplate;
    private final NovuBridgeConfiguration config;
    private final Map<String, Timed> cache = new ConcurrentHashMap<>();

    public DigitLocalizationProvider(@Nullable RestTemplate restTemplate, NovuBridgeConfiguration config) {
        this.restTemplate = restTemplate;
        this.config = config;
    }

    @Override
    public String message(String tenantId, String locale, List<String> modules, String code,
                          RequestInfo requestInfo) {
        if (!StringUtils.hasText(code)) {
            return null;
        }
        String tenant = MdmsNotificationConfigRepository.stateTenant(tenantId);
        if (tenant == null || restTemplate == null || !StringUtils.hasText(config.getLocalizationHost())) {
            return null;
        }
        for (String module : modules == null || modules.isEmpty() ? config.getLocalizationModules() : modules) {
            if (!StringUtils.hasText(module)) {
                continue;
            }
            String message = messages(tenant, locale, module.trim(), requestInfo).get(code);
            if (StringUtils.hasText(message)) {
                return message;
            }
        }
        return null;
    }

    @SuppressWarnings("unchecked")
    private Map<String, String> messages(String tenant, String locale, String module, RequestInfo requestInfo) {
        String key = tenant + "|" + locale + "|" + module;
        long ttl = config.getLocalizationCacheTtlMs() != null ? config.getLocalizationCacheTtlMs() : 300_000L;
        Timed cached = cache.get(key);
        if (cached != null && cached.fresh(ttl)) {
            return cached.messages;
        }
        Map<String, String> out = new LinkedHashMap<>();
        try {
            String url = config.getLocalizationHost() + config.getLocalizationSearchPath()
                    + "?locale=" + locale + "&tenantId=" + tenant + "&module=" + module;
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);
            Map<String, Object> body = new LinkedHashMap<>();
            body.put("RequestInfo", requestInfo != null ? requestInfo : new RequestInfo());
            ResponseEntity<Map> response = restTemplate.exchange(url, HttpMethod.POST,
                    new HttpEntity<>(body, headers), Map.class);
            Object messages = response.getBody() == null ? null : response.getBody().get("messages");
            if (messages instanceof List) {
                for (Object element : (List<Object>) messages) {
                    if (!(element instanceof Map)) {
                        continue;
                    }
                    Map<String, Object> entry = (Map<String, Object>) element;
                    Object messageCode = entry.get("code");
                    Object message = entry.get("message");
                    if (messageCode != null && message != null) {
                        out.putIfAbsent(messageCode.toString(), message.toString());
                    }
                }
            }
        } catch (Exception e) {
            log.warn("Localization unavailable for tenant {} locale {} module {} ({}); placeholder values "
                    + "fall back to the raw literals the producer sent", tenant, locale, module, e.getMessage());
            // Cached empty for the window, deliberately: an outage costs one call per window,
            // not one per code per recipient.
        }
        cache.put(key, new Timed(out.isEmpty() ? Collections.emptyMap() : out));
        return out;
    }
}
