package org.egov.novubridge.service.resolution;

import org.egov.novubridge.service.resolution.config.NotificationConfigRows.TemplateRow;
import org.springframework.web.util.HtmlUtils;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * The "what": picks a {@code NOTIFICATIONS.Template} row for
 * {@code (eventName, audience, channel, locale)} and fills its {@code {token}} placeholders.
 *
 * <p>Ported from {@code pgr-services}' renderer with the key shortened and the semantics kept
 * exactly. Four of those semantics are easy to lose and each has cost a real incident:
 *
 * <ol>
 *   <li><b>Locale falls back per FIELD, independently.</b> The body may render in the recipient's
 *       language while the subject falls back to the default, or the reverse. Resolving the row
 *       once and reading both fields off it would be tidier and would change what ships.</li>
 *   <li><b>An unresolved placeholder stays as literal braces.</b> {@code {emp_name}} with no value
 *       is delivered as {@code {emp_name}}, not blanked. A blank looks like a working template
 *       with nothing to say; braces look like the bug they are. The one exception is a value the
 *       producer deliberately blanked, which arrives as an empty string and substitutes as one.</li>
 *   <li><b>EMAIL bodies HTML-escape substituted VALUES; subjects do not.</b> The body is delivered
 *       with {@code editorType=html} and output sanitization off, so a citizen name or a workflow
 *       comment is live HTML in the recipient's mail client. The template itself is
 *       admin-authored and may legitimately contain markup, so only the values are escaped. The
 *       subject is rendered as plain text, so escaping it would show {@code &amp;} to the reader.
 *       Spring's {@code HtmlUtils.htmlEscape} is called rather than reimplemented: its exact
 *       entity table (HTML 4.0 — which escapes {@code é} and does NOT escape an apostrophe) is
 *       what the golden master recorded, and a hand-rolled five-character version would differ on
 *       both.</li>
 *   <li><b>Matching is case-insensitive</b> on every key part, because every one of them is typed
 *       by an operator into a form.</li>
 * </ol>
 *
 * <p>Returns null when no row matches, in the requested locale or the default. The caller writes
 * {@code SKIPPED / NB_NO_TEMPLATE} and moves on — it does NOT consume the recipient's dedupe key,
 * so a missing template on one routing row cannot suppress a working one on the next.
 */
public class TemplateRenderer {

    private static final String BODY = "body";
    private static final String SUBJECT = "subject";

    private final String defaultLocale;

    public TemplateRenderer(String defaultLocale) {
        this.defaultLocale = defaultLocale;
    }

    /** The rendered body, or null when no template exists after the default-locale fallback. */
    public String render(List<TemplateRow> rows, String eventName, String audience, String channel,
                         String locale, Map<String, String> values) {
        return renderField(BODY, rows, eventName, audience, channel, locale, values);
    }

    /**
     * The rendered EMAIL subject, or null when the matched row has no subject (every SMS and
     * WHATSAPP row) or no row matched. Novu's email step REJECTS a blank subject and drops the
     * whole send, so the caller must supply a fallback.
     */
    public String renderSubject(List<TemplateRow> rows, String eventName, String audience, String channel,
                                String locale, Map<String, String> values) {
        return renderField(SUBJECT, rows, eventName, audience, channel, locale, values);
    }

    /**
     * The uid of the row the BODY actually came from — the requested locale's, or the default
     * locale's after fallback — or null when neither exists. This is the only field that reports
     * the locale that was rendered; {@code contact.locale} reports the recipient's preference,
     * which is a different thing and is why both are on the wire.
     */
    public String resolveTemplateKey(List<TemplateRow> rows, String eventName, String audience,
                                     String channel, String locale) {
        TemplateRow row = find(rows, eventName, audience, channel, locale, BODY);
        if (row != null) {
            return row.uid();
        }
        if (hasText(defaultLocale) && !defaultLocale.equalsIgnoreCase(locale)) {
            TemplateRow fallback = find(rows, eventName, audience, channel, defaultLocale, BODY);
            if (fallback != null) {
                return fallback.uid();
            }
        }
        return null;
    }

    private String renderField(String field, List<TemplateRow> rows, String eventName, String audience,
                               String channel, String locale, Map<String, String> values) {
        TemplateRow row = find(rows, eventName, audience, channel, locale, field);
        if (row == null && hasText(defaultLocale) && !defaultLocale.equalsIgnoreCase(locale)) {
            row = find(rows, eventName, audience, channel, defaultLocale, field);
        }
        if (row == null) {
            return null;
        }
        String raw = BODY.equals(field) ? row.body() : row.subject();
        if (raw == null) {
            return null;
        }
        Map<String, String> effective = values;
        if (BODY.equals(field) && "EMAIL".equalsIgnoreCase(channel)) {
            effective = escapeValuesForHtml(values);
        }
        return substitute(raw, effective);
    }

    /**
     * The first ACTIVE row whose key matches and whose requested field is non-null. The
     * field-presence condition is what makes the two locale ladders independent: a row with a body
     * and no subject is a match for the body and a miss for the subject, so the subject keeps
     * looking in the default locale.
     */
    private static TemplateRow find(List<TemplateRow> rows, String eventName, String audience,
                                    String channel, String locale, String field) {
        if (rows == null) {
            return null;
        }
        for (TemplateRow row : rows) {
            if (!row.active()) {
                continue;
            }
            if (!eq(eventName, row.eventName()) || !eq(audience, row.audience())
                    || !eq(channel, row.channel()) || !eq(locale, row.locale())) {
                continue;
            }
            String value = BODY.equals(field) ? row.body() : row.subject();
            if (value != null) {
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
        for (Map.Entry<String, String> entry : values.entrySet()) {
            escaped.put(entry.getKey(), entry.getValue() == null ? null : HtmlUtils.htmlEscape(entry.getValue()));
        }
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

    private static boolean hasText(String value) {
        return value != null && !value.trim().isEmpty();
    }
}
