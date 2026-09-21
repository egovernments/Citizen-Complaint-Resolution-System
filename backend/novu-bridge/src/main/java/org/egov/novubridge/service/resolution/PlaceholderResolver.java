package org.egov.novubridge.service.resolution;

import org.egov.common.contract.request.RequestInfo;
import org.egov.novubridge.web.models.ThinEvent;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Placeholder name to the string that will replace {@code {name}} in a template.
 *
 * <p>Three sources, in this order, per token:
 * <ol>
 *   <li>the first code in {@code localized[token]} that has a message in this locale;</li>
 *   <li>{@code dataByLocale[locale][token]} — the escape hatch for a value that genuinely cannot
 *       be expressed as a localization code;</li>
 *   <li>{@code data[token]} — the literal the producer sent.</li>
 * </ol>
 * A token present in none of them is <b>absent from the returned map</b>, not present-and-empty,
 * and the renderer therefore leaves its braces literal. That distinction is the whole reason this
 * returns a map with holes rather than a map of empty strings: a blank looks like a template with
 * nothing to say, and a provider rejects a message whose variables are all blank.
 *
 * <p><b>Localization is resolved ONCE PER EVENT, not per recipient</b>, in the locale the event
 * carries ({@code localizationLocale}, else the deployment default). That is not an oversight: it
 * is what today's producer does — it builds placeholder values once, from
 * {@code RequestInfo.msgId}'s locale, and then renders per-recipient templates against that one
 * set — and a two-language fan-out therefore shares one set of substituted values while the
 * template text itself differs per recipient. Moving to per-recipient placeholder localization is
 * a real improvement and a deliberate behaviour change; it is not something to acquire by
 * accident while moving code between services.
 */
public class PlaceholderResolver {

    private final LocalizationProvider localization;

    public PlaceholderResolver(LocalizationProvider localization) {
        this.localization = localization;
    }

    /**
     * @param locale the ONE locale the event's localization codes are resolved in
     * @return an insertion-ordered map; tokens with no value anywhere are absent
     */
    public Map<String, String> resolve(ThinEvent event, String locale, RequestInfo requestInfo) {
        Map<String, String> values = new LinkedHashMap<>();
        // Literals first, so a localization outage can only fail to IMPROVE a value, never blank
        // one. The ordering is load-bearing: it is what stopped a localization 400 from shipping
        // a WhatsApp message whose contentVariables were all empty (Twilio 21656).
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
            // A provider that throws is treated exactly as one that found nothing: the ladder
            // moves on, and a token with no message anywhere keeps its literal fallback. An
            // outage must not blank a value that the producer already sent.
            return null;
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

    /** Null values are skipped — an absent token and a null token mean the same thing. */
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
