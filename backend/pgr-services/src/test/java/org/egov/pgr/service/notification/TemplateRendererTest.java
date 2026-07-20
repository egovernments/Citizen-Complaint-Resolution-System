package org.egov.pgr.service.notification;

import org.egov.pgr.config.PGRConfiguration;
import org.egov.pgr.util.MDMSUtils;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
public class TemplateRendererTest {

    private static final String TENANT = "ke.bomet";

    @Mock
    private MDMSUtils mdmsUtils;

    @Mock
    private PGRConfiguration config;

    @InjectMocks
    private TemplateRenderer renderer;

    @BeforeEach
    void setUp() {
        when(config.getNotificationDefaultLocale()).thenReturn("en_IN");
    }

    private Map<String, Object> tmpl(String audience, String action, String toState, String channel,
                                     String locale, String body) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("audience", audience);
        m.put("action", action);
        m.put("toState", toState);
        m.put("channel", channel);
        m.put("locale", locale);
        m.put("body", body);
        m.put("active", true);
        return m;
    }

    private void seed(Object... rows) {
        when(mdmsUtils.getNotificationTemplates(TENANT)).thenReturn(new ArrayList<>(Arrays.asList(rows)));
    }

    @Test
    void fillsPlaceholders() {
        seed(tmpl("CITIZEN", "ASSIGN", "PENDINGATLME", "SMS", "en_IN",
                "Complaint {id} ({complaint_type}) assigned to {emp_name}"));
        Map<String, String> v = new HashMap<>();
        v.put("id", "PGR-001");
        v.put("complaint_type", "Garbage");
        v.put("emp_name", "John");
        String out = renderer.render(TENANT, "CITIZEN", "ASSIGN", "PENDINGATLME", "SMS", "en_IN", v);
        assertEquals("Complaint PGR-001 (Garbage) assigned to John", out);
    }

    @Test
    void localeFallbackToDefault() {
        seed(tmpl("CITIZEN", "REJECT", "REJECTED", "SMS", "en_IN", "Your complaint {id} was rejected"));
        Map<String, String> v = new HashMap<>();
        v.put("id", "PGR-002");
        // request sw_KE; only en_IN seeded -> falls back to default locale en_IN
        String out = renderer.render(TENANT, "CITIZEN", "REJECT", "REJECTED", "SMS", "sw_KE", v);
        assertEquals("Your complaint PGR-002 was rejected", out);
    }

    @Test
    void missingTemplateReturnsNull() {
        seed(tmpl("CITIZEN", "ASSIGN", "PENDINGATLME", "SMS", "en_IN", "x"));
        assertNull(renderer.render(TENANT, "EMPLOYEE", "ASSIGN", "PENDINGATLME", "SMS", "en_IN", new HashMap<>()));
    }

    @Test
    void caseInsensitiveKeyMatch() {
        seed(tmpl("CITIZEN", "ASSIGN", "PENDINGATLME", "SMS", "en_IN", "ok {id}"));
        Map<String, String> v = new HashMap<>();
        v.put("id", "X");
        String out = renderer.render(TENANT, "citizen", "assign", "pendingatlme", "sms", "en_IN", v);
        assertEquals("ok X", out);
    }

    @Test
    void nullPlaceholderValueLeavesTokenUntouched() {
        seed(tmpl("CITIZEN", "ASSIGN", "PENDINGATLME", "SMS", "en_IN", "Hi {emp_name}"));
        Map<String, String> v = new HashMap<>();
        v.put("emp_name", null);
        String out = renderer.render(TENANT, "CITIZEN", "ASSIGN", "PENDINGATLME", "SMS", "en_IN", v);
        assertTrue(out.contains("{emp_name}"));
    }

    @Test
    void emailBodyHtmlEscapesUserValuesButKeepsTemplateHtml() {
        // The EMAIL body is delivered as raw HTML (Novu editorType=html,
        // disableOutputSanitization=true), so user-controlled values must be escaped
        // to prevent HTML/link injection, while the admin-authored template markup
        // (here, the <b> wrapper) is preserved verbatim.
        seed(tmpl("CITIZEN", "ASSIGN", "PENDINGATLME", "EMAIL", "en_IN", "Hello <b>{citizen_name}</b>"));
        Map<String, String> v = new HashMap<>();
        v.put("citizen_name", "Jane<a href=\"http://evil.example/phish\">Doe</a>");
        String out = renderer.render(TENANT, "CITIZEN", "ASSIGN", "PENDINGATLME", "EMAIL", "en_IN", v);
        assertEquals("Hello <b>Jane&lt;a href=&quot;http://evil.example/phish&quot;&gt;Doe&lt;/a&gt;</b>", out);
    }

    @Test
    void smsBodyDoesNotEscapeUserValues() {
        // Non-EMAIL channels are plain text, so escaping would leak visible entities.
        seed(tmpl("CITIZEN", "ASSIGN", "PENDINGATLME", "SMS", "en_IN", "Hello {citizen_name}"));
        Map<String, String> v = new HashMap<>();
        v.put("citizen_name", "Tom & Jerry");
        String out = renderer.render(TENANT, "CITIZEN", "ASSIGN", "PENDINGATLME", "SMS", "en_IN", v);
        assertEquals("Hello Tom & Jerry", out);
    }
}
