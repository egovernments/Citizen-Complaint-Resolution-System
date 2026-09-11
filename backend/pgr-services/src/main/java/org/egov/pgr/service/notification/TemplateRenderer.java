package org.egov.pgr.service.notification;

import lombok.extern.slf4j.Slf4j;
import org.egov.pgr.config.PGRConfiguration;
import org.egov.pgr.util.MDMSUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import org.springframework.web.util.HtmlUtils;

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
        return renderField("body", tenantId, audience, action, toState, channel, locale, values);
    }

    /**
     * Render the EMAIL subject line (RAINMAKER-PGR.NotificationTemplate {@code subject}) with
     * placeholders filled. Returns null when the matched template has no subject (SMS/WHATSAPP
     * rows) or no template matches. Novu's email step REQUIRES a non-empty subject, so callers
     * must supply a fallback for the EMAIL channel when this returns null/blank.
     */
    public String renderSubject(String tenantId, String audience, String action, String toState,
                                String channel, String locale, Map<String, String> values) {
        return renderField("subject", tenantId, audience, action, toState, channel, locale, values);
    }

    private String renderField(String field, String tenantId, String audience, String action,
                               String toState, String channel, String locale, Map<String, String> values) {
        String raw = findField(field, tenantId, audience, action, toState, channel, locale);
        if (raw == null && StringUtils.hasText(config.getNotificationDefaultLocale())
                && !config.getNotificationDefaultLocale().equalsIgnoreCase(locale)) {
            raw = findField(field, tenantId, audience, action, toState, channel, config.getNotificationDefaultLocale());
        }
        if (raw == null) {
            if ("body".equals(field))
                log.info("No NotificationTemplate for audience={} action={} toState={} channel={} locale={} (tenant {})",
                        audience, action, toState, channel, locale, tenantId);
            return null;
        }
        // The EMAIL body is delivered through Novu with editorType=html and
        // disableOutputSanitization=true, so the rendered string is treated as raw
        // HTML by the recipient's mail client. Placeholder VALUES (citizen name,
        // workflow comments, ...) are user-controlled, so HTML-escape them before
        // substitution to prevent HTML/link injection into the email. The template
        // body itself is admin-authored MDMS and may legitimately contain HTML, so
        // only the substituted values are escaped, not the template. The subject is
        // rendered as plain text by Novu, so it is left unescaped.
        Map<String, String> effectiveValues = values;
        if ("body".equals(field) && "EMAIL".equalsIgnoreCase(channel)) {
            effectiveValues = escapeValuesForHtml(values);
        }
        return substitute(raw, effectiveValues);
    }

    /** Returns a copy of {@code values} with every value HTML-escaped. */
    private Map<String, String> escapeValuesForHtml(Map<String, String> values) {
        if (values == null) return null;
        Map<String, String> escaped = new java.util.LinkedHashMap<>(values.size());
        for (Map.Entry<String, String> e : values.entrySet()) {
            escaped.put(e.getKey(), e.getValue() == null ? null : HtmlUtils.htmlEscape(e.getValue()));
        }
        return escaped;
    }

    @SuppressWarnings("unchecked")
    private String findField(String field, String tenantId, String audience, String action, String toState,
                             String channel, String locale) {
        for (Object rowObj : mdmsUtils.getNotificationTemplates(tenantId)) {
            if (!(rowObj instanceof Map)) continue;
            Map<String, Object> row = (Map<String, Object>) rowObj;
            if (Boolean.FALSE.equals(row.get("active"))) continue;
            if (eq(audience, row.get("audience")) && eq(action, row.get("action"))
                    && eq(toState, row.get("toState")) && eq(channel, row.get("channel"))
                    && eq(locale, row.get("locale"))) {
                Object v = row.get(field);
                return v != null ? v.toString() : null;
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
