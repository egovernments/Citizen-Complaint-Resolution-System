package org.egov.pgr.service.notification;

import lombok.extern.slf4j.Slf4j;
import org.egov.pgr.config.PGRConfiguration;
import org.egov.pgr.util.MDMSUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

import java.util.Map;

/**
 * The "what": looks up a RAINMAKER-PGR.NotificationTemplate body by
 * (audience, action, toState, channel, locale) and fills {placeholder} tokens. Localization
 * happens here / upstream so the rendered body is final BEFORE it is published to Kafka (D4).
 *
 * Returns null when no template matches (caller skips that recipient/channel and logs).
 */
@Slf4j
@Component
public class TemplateRenderer {

    private final MDMSUtils mdmsUtils;
    private final PGRConfiguration config;

    @Autowired
    public TemplateRenderer(MDMSUtils mdmsUtils, PGRConfiguration config) {
        this.mdmsUtils = mdmsUtils;
        this.config = config;
    }

    /**
     * @param values placeholder name -> resolved value (without braces). Null values are skipped.
     * @return the rendered body, or null if no template exists for the key (after default-locale fallback).
     */
    public String render(String tenantId, String audience, String action, String toState,
                         String channel, String locale, Map<String, String> values) {
        String body = findBody(tenantId, audience, action, toState, channel, locale);
        if (body == null && StringUtils.hasText(config.getNotificationDefaultLocale())
                && !config.getNotificationDefaultLocale().equalsIgnoreCase(locale)) {
            body = findBody(tenantId, audience, action, toState, channel, config.getNotificationDefaultLocale());
        }
        if (body == null) {
            log.info("No NotificationTemplate for audience={} action={} toState={} channel={} locale={} (tenant {})",
                    audience, action, toState, channel, locale, tenantId);
            return null;
        }
        return substitute(body, values);
    }

    @SuppressWarnings("unchecked")
    private String findBody(String tenantId, String audience, String action, String toState,
                            String channel, String locale) {
        for (Object rowObj : mdmsUtils.getNotificationTemplates(tenantId)) {
            if (!(rowObj instanceof Map)) continue;
            Map<String, Object> row = (Map<String, Object>) rowObj;
            if (Boolean.FALSE.equals(row.get("active"))) continue;
            if (eq(audience, row.get("audience")) && eq(action, row.get("action"))
                    && eq(toState, row.get("toState")) && eq(channel, row.get("channel"))
                    && eq(locale, row.get("locale"))) {
                Object body = row.get("body");
                return body != null ? body.toString() : null;
            }
        }
        return null;
    }

    private String substitute(String body, Map<String, String> values) {
        if (values == null) return body;
        String out = body;
        for (Map.Entry<String, String> e : values.entrySet()) {
            if (e.getKey() != null && e.getValue() != null) {
                out = out.replace("{" + e.getKey() + "}", e.getValue());
            }
        }
        return out;
    }

    private boolean eq(String expected, Object actual) {
        return actual != null && expected != null && expected.equalsIgnoreCase(actual.toString());
    }
}
