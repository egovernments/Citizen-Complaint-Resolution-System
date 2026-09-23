package org.egov.novubridge.service.resolution;

import org.egov.novubridge.service.resolution.config.NotificationConfigRows.TemplateRow;
import org.springframework.util.StringUtils;
import org.springframework.web.util.HtmlUtils;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Function;

/**
 * Picks the {@code NOTIFICATIONS.Template} row for {@code (eventName, audience, channel, locale)}
 * (case-insensitive, falling back to the default locale) and fills its {@code {token}}s.
 *
 * <ul>
 *   <li>Body and subject fall back to the default locale INDEPENDENTLY, per field.</li>
 *   <li>An unresolved placeholder stays as literal braces, never blank.</li>
 *   <li>EMAIL bodies HTML-escape substituted values (the body is sent as live HTML); subjects are
 *       plain text and are not escaped. {@code HtmlUtils.htmlEscape}'s HTML 4 entity table is
 *       the expected output, so do not hand-roll it.</li>
 * </ul>
 */
public class TemplateRenderer {

    /**
     * One rendering. {@code templateKey} is the uid of the row the body came from, which is the
     * only field that reports the locale actually rendered.
     */
    public record Rendered(String body, String subject, String templateKey) {
    }

    private final String defaultLocale;

    public TemplateRenderer(String defaultLocale) {
        this.defaultLocale = defaultLocale;
    }

    /**
     * @return null when no body template exists after the default-locale fallback. The subject is
     *         rendered for EMAIL only and may be null.
     */
    public Rendered render(List<TemplateRow> rows, String eventName, String audience, String channel,
                           String locale, Map<String, String> values) {
        TemplateRow bodyRow = find(rows, eventName, audience, channel, locale, TemplateRow::body);
        if (bodyRow == null) {
            return null;
        }
        boolean email = "EMAIL".equalsIgnoreCase(channel);
        String body = substitute(bodyRow.body(), email ? escapeValuesForHtml(values) : values);
        String subject = null;
        if (email) {
            TemplateRow subjectRow = find(rows, eventName, audience, channel, locale, TemplateRow::subject);
            subject = subjectRow == null ? null : substitute(subjectRow.subject(), values);
        }
        return new Rendered(body, subject, bodyRow.uid());
    }

    /** The requested locale's row, else the default locale's, whose {@code field} is non-null. */
    private TemplateRow find(List<TemplateRow> rows, String eventName, String audience, String channel,
                             String locale, Function<TemplateRow, String> field) {
        TemplateRow row = findExact(rows, eventName, audience, channel, locale, field);
        if (row == null && StringUtils.hasText(defaultLocale) && !defaultLocale.equalsIgnoreCase(locale)) {
            row = findExact(rows, eventName, audience, channel, defaultLocale, field);
        }
        return row;
    }

    private static TemplateRow findExact(List<TemplateRow> rows, String eventName, String audience,
                                         String channel, String locale, Function<TemplateRow, String> field) {
        if (rows == null) {
            return null;
        }
        for (TemplateRow row : rows) {
            if (row.active() && eq(eventName, row.eventName()) && eq(audience, row.audience())
                    && eq(channel, row.channel()) && eq(locale, row.locale()) && field.apply(row) != null) {
                return row;
            }
        }
        return null;
    }

    private static Map<String, String> escapeValuesForHtml(Map<String, String> values) {
        if (values == null) {
            return null;
        }
        Map<String, String> escaped = new LinkedHashMap<>(values.size());
        values.forEach((k, v) -> escaped.put(k, v == null ? null : HtmlUtils.htmlEscape(v)));
        return escaped;
    }

    private static String substitute(String body, Map<String, String> values) {
        if (values == null) {
            return body;
        }
        String out = body;
        for (Map.Entry<String, String> entry : values.entrySet()) {
            if (entry.getKey() != null && entry.getValue() != null) {
                out = out.replace("{" + entry.getKey() + "}", entry.getValue());
            }
        }
        return out;
    }

    private static boolean eq(String expected, String actual) {
        return actual != null && expected != null && expected.equalsIgnoreCase(actual);
    }
}
