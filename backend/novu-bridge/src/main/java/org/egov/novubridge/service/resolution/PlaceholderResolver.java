package org.egov.novubridge.service.resolution;

import org.egov.common.contract.request.RequestInfo;
import org.egov.novubridge.web.models.ThinEvent;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Placeholder name to substituted value, per token: the first {@code localized} code with a
 * message, else {@code dataByLocale[locale]}, else {@code data}. A token with no value is ABSENT
 * from the map so its braces stay literal; a blank would look like a working template.
 *
 * <p>Resolved once per event in the event's locale, not per recipient: that is what the
 * producer did before the thin path, and changing it is a separate decision.
 */
public class PlaceholderResolver {

    private final LocalizationProvider localization;

    public PlaceholderResolver(LocalizationProvider localization) {
        this.localization = localization;
    }

    public Map<String, String> resolve(ThinEvent event, String locale, RequestInfo requestInfo) {
        Map<String, String> values = new LinkedHashMap<>();
        // Literals first, so a localization outage can only fail to improve a value, never blank
        // one (an all-blank WhatsApp template is Twilio 21656).
        putAll(values, event.getData());
        putAll(values, localeOverride(event, locale));

        Map<String, Object> localized = event.getLocalized();
        if (localized == null || localized.isEmpty() || localization == null) {
            return values;
        }
        List<String> modules = event.getLocalizationModules();
        for (String token : localized.keySet()) {
            for (String code : event.localizationCodes(token)) {
                String message = message(event.getTenantId(), locale, modules, code, requestInfo);
                if (message != null && !message.isEmpty()) {
                    values.put(token, message);
                    break;
                }
            }
        }
        return values;
    }

    private String message(String tenantId, String locale, List<String> modules, String code,
                           RequestInfo requestInfo) {
        try {
            return localization.message(tenantId, locale, modules, code, requestInfo);
        } catch (Exception e) {
            return null;   // fail-open: the token keeps its literal
        }
    }

    private static Map<String, Object> localeOverride(ThinEvent event, String locale) {
        Map<String, Map<String, Object>> byLocale = event.getDataByLocale();
        if (byLocale == null || locale == null) {
            return null;
        }
        Map<String, Object> exact = byLocale.get(locale);
        if (exact != null) {
            return exact;
        }
        for (Map.Entry<String, Map<String, Object>> entry : byLocale.entrySet()) {
            if (entry.getKey() != null && entry.getKey().equalsIgnoreCase(locale)) {
                return entry.getValue();
            }
        }
        return null;
    }

    private static void putAll(Map<String, String> into, Map<String, Object> from) {
        if (from == null) {
            return;
        }
        for (Map.Entry<String, Object> entry : from.entrySet()) {
            if (entry.getKey() != null && entry.getValue() != null) {
                into.put(entry.getKey(), String.valueOf(entry.getValue()));
            }
        }
    }
}
