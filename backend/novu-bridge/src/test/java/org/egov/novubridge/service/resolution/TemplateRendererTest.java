package org.egov.novubridge.service.resolution;

import org.egov.novubridge.service.resolution.config.NotificationConfigRows.TemplateRow;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

/**
 * The renderer, ported from the producer with the key shortened and the semantics unchanged.
 * Every case here is one that has shipped a wrong message at least once.
 */
class TemplateRendererTest {

    private static final String EVENT = "COMPLAINTS.WORKFLOW.ASSIGN.PENDINGATLME";

    private final TemplateRenderer renderer = new TemplateRenderer("en_IN");

    private static TemplateRow row(String audience, String channel, String locale,
                                   String subject, String body, boolean active) {
        return new TemplateRow("Complaints", EVENT, audience, channel, locale, subject, body, active);
    }

    private static Map<String, String> values(String... pairs) {
        Map<String, String> values = new HashMap<>();
        for (int i = 0; i < pairs.length; i += 2) {
            values.put(pairs[i], pairs[i + 1]);
        }
        return values;
    }

    @Test
    @DisplayName("placeholders are filled from the values map")
    void fillsPlaceholders() {
        List<TemplateRow> rows = List.of(row("ACTOR:citizen", "SMS", "en_IN", null,
                "Complaint {id} is now {status}.", true));
        assertEquals("Complaint PGR-001 is now Resolved.",
                renderer.render(rows, EVENT, "ACTOR:citizen", "SMS", "en_IN",
                        values("id", "PGR-001", "status", "Resolved")));
    }

    @Test
    @DisplayName("a token with no value keeps its BRACES — it is never blanked")
    void anUnresolvedTokenKeepsItsBraces() {
        List<TemplateRow> rows = List.of(row("ACTOR:citizen", "SMS", "en_IN", null,
                "Assigned to {emp_name}.", true));
        assertEquals("Assigned to {emp_name}.",
                renderer.render(rows, EVENT, "ACTOR:citizen", "SMS", "en_IN", values("id", "PGR-001")),
                "a blank looks like a working template with nothing to say; braces look like the bug");
    }

    @Test
    @DisplayName("a value the producer deliberately blanked substitutes as an empty string")
    void adeliberateBlankSubstitutes() {
        List<TemplateRow> rows = List.of(row("ACTOR:citizen", "SMS", "en_IN", null,
                "Download: {download_link}", true));
        assertEquals("Download: ",
                renderer.render(rows, EVENT, "ACTOR:citizen", "SMS", "en_IN",
                        values("download_link", "")),
                "the shortener being down must not ship the literal text {download_link}");
    }

    @Test
    @DisplayName("an unmatched locale falls back to the default")
    void localeFallsBackToTheDefault() {
        List<TemplateRow> rows = List.of(row("ACTOR:citizen", "SMS", "en_IN", null, "english", true));
        assertEquals("english", renderer.render(rows, EVENT, "ACTOR:citizen", "SMS", "fr_FR", Map.of()));
        assertEquals(EVENT + ".ACTOR:citizen.SMS.en_IN",
                renderer.resolveTemplateKey(rows, EVENT, "ACTOR:citizen", "SMS", "fr_FR"),
                "the key reports the locale that was RENDERED, not the one that was asked for");
    }

    @Test
    @DisplayName("subject and body fall back to the default locale INDEPENDENTLY")
    void subjectAndBodyFallBackSeparately() {
        List<TemplateRow> rows = List.of(
                // hi_IN has a body and NO subject; en_IN has both.
                row("ACTOR:citizen", "EMAIL", "hi_IN", null, "hindi body", true),
                row("ACTOR:citizen", "EMAIL", "en_IN", "english subject", "english body", true));

        assertEquals("hindi body", renderer.render(rows, EVENT, "ACTOR:citizen", "EMAIL", "hi_IN", Map.of()));
        assertEquals("english subject",
                renderer.renderSubject(rows, EVENT, "ACTOR:citizen", "EMAIL", "hi_IN", Map.of()),
                "resolving the ROW once and reading both fields off it would be tidier and would "
                        + "change what ships");
        assertEquals(EVENT + ".ACTOR:citizen.EMAIL.hi_IN",
                renderer.resolveTemplateKey(rows, EVENT, "ACTOR:citizen", "EMAIL", "hi_IN"),
                "templateKey tracks the BODY only");
    }

    @Test
    @DisplayName("no template in any locale is null, not an empty string")
    void aMissingTemplateIsNull() {
        assertNull(renderer.render(List.of(), EVENT, "ACTOR:citizen", "SMS", "en_IN", Map.of()));
        assertNull(renderer.resolveTemplateKey(List.of(), EVENT, "ACTOR:citizen", "SMS", "en_IN"));
    }

    @Test
    @DisplayName("an inactive row is not a template")
    void anInactiveRowIsSkipped() {
        List<TemplateRow> rows = List.of(row("ACTOR:citizen", "SMS", "en_IN", null, "body", false));
        assertNull(renderer.render(rows, EVENT, "ACTOR:citizen", "SMS", "en_IN", Map.of()));
    }

    @Test
    @DisplayName("matching is case-insensitive on every key part — operators type these")
    void matchingIsCaseInsensitive() {
        List<TemplateRow> rows = List.of(row("ACTOR:citizen", "sms", "EN_in", null, "body", true));
        assertEquals("body", renderer.render(rows, EVENT.toLowerCase(java.util.Locale.ROOT),
                "actor:citizen", "SMS", "en_IN", Map.of()));
    }

    @Test
    @DisplayName("an EMAIL body HTML-escapes substituted VALUES and leaves the template's own markup")
    void emailBodiesEscapeValuesNotTemplates() {
        List<TemplateRow> rows = List.of(row("ACTOR:citizen", "EMAIL", "en_IN", null,
                "<b>Reason</b>: {additional_comments}", true));
        assertEquals("<b>Reason</b>: Duplicate of &lt;b&gt;PGR-101&lt;/b&gt; &amp; closed",
                renderer.render(rows, EVENT, "ACTOR:citizen", "EMAIL", "en_IN",
                        values("additional_comments", "Duplicate of <b>PGR-101</b> & closed")),
                "the body is delivered as raw HTML, so a citizen's own words must not be markup — "
                        + "but the admin-authored template may legitimately contain some");
    }

    @Test
    @DisplayName("an EMAIL SUBJECT does not escape — Novu renders it as plain text")
    void emailSubjectsDoNotEscape() {
        List<TemplateRow> rows = List.of(row("ACTOR:citizen", "EMAIL", "en_IN",
                "Complaint ({complaint_type})", "body", true));
        assertEquals("Complaint (Garbage & \"litter\" <cleared>)",
                renderer.renderSubject(rows, EVENT, "ACTOR:citizen", "EMAIL", "en_IN",
                        values("complaint_type", "Garbage & \"litter\" <cleared>")),
                "escaping it would show the reader &amp;");
    }

    @Test
    @DisplayName("SMS and WHATSAPP bodies do not escape either")
    void smsBodiesDoNotEscape() {
        List<TemplateRow> rows = List.of(row("ACTOR:citizen", "SMS", "en_IN", null, "{x}", true));
        assertEquals("a & b", renderer.render(rows, EVENT, "ACTOR:citizen", "SMS", "en_IN",
                values("x", "a & b")));
    }

    @Test
    @DisplayName("the template key is the MDMS uniqueIdentifier of the row that rendered")
    void theTemplateKeyIsTheMdmsUid() {
        List<TemplateRow> rows = List.of(row("ACTOR:assignee|ROLE:GRO", "SMS", "en_IN", null, "body", true));
        assertEquals(EVENT + ".ACTOR:assignee|ROLE:GRO.SMS.en_IN",
                renderer.resolveTemplateKey(rows, EVENT, "ACTOR:assignee|ROLE:GRO", "SMS", "en_IN"));
    }
}
