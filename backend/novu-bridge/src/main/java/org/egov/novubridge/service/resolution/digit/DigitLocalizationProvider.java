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

/**
 * Localization code to message, from egov-localization at the state tenant. Caches a whole
 * (tenant, locale, module) per call, since that is what the upstream answers.
 *
 * <p>Fail-open to the RAW value: a module that cannot be fetched is cached empty for the window,
 * so tokens fall back to the producer's literal. Raw is ugly but true; blank is a hole in the
 * message, and an all-blank WhatsApp template is rejected outright.
 */
@Slf4j
public class DigitLocalizationProvider implements LocalizationProvider {

    private final RestTemplate restTemplate;
    private final NovuBridgeConfiguration config;
    private final TtlCache<String, Map<String, String>> cache = new TtlCache<>();

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
        Map<String, String> cached = cache.fresh(key, ttl);
        if (cached != null) {
            return cached;
        }
        Map<String, String> out = new LinkedHashMap<>();
        try {
            String url = ServiceUrl.join(config.getLocalizationHost(), config.getLocalizationSearchPath())
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
        }
        cache.put(key, out.isEmpty() ? Collections.emptyMap() : out);
        return out;
    }
}
