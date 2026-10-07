package org.egov.novubridge.service.core;

import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.novubridge.web.models.NotificationEvent;
import org.egov.tracer.model.CustomException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

class CoreSmsTranslatorTest {

    private static final String KEY = CoreSmsTranslator.recordKey("egov.core.notification.sms", 0, 42L, 1790000000000L);

    private NovuBridgeConfiguration config;
    private CoreSmsTranslator translator;

    @BeforeEach
    void setUp() {
        config = new NovuBridgeConfiguration();
        config.setDefaultLocale("en_IN");
        config.setCoreSmsDefaultTenant("ke");
        config.setCoreSmsCountryCode("+254");
        translator = new CoreSmsTranslator(config);
    }

    @Test
    void userOtpSmsRequest_becomesACoreSmsEnvelope() {
        Map<String, Object> sms = new HashMap<>();
        sms.put("mobileNumber", "0712345678");
        sms.put("message", "Your OTP is 481516. Valid for 5 minutes.");
        sms.put("category", "OTP");
        sms.put("expiryTime", 300000L);
        NotificationEvent e = translator.translate(sms, KEY);
        assertEquals("CORE_SMS", e.getEventType());
        assertEquals("CORE.SMS.OTP", e.getEventName());
        assertEquals("CORE", e.getModule());
        assertEquals("SMS", e.getChannel());
        assertEquals("ke", e.getTenantId());
        assertEquals("+254712345678", e.getContact().getPhone());
        assertEquals("ke:+254712345678", e.getSubscriberId());
        assertEquals("Your OTP is 481516. Valid for 5 minutes.", e.getRenderedBody());
        // No phone in the id: it reaches logs, gateway requests and last_error_message.
        assertEquals("CORE:ke:" + e.getEventId(), e.getTransactionId());
        assertFalse(e.getTransactionId().contains("712345678"), e.getTransactionId());
        assertEquals("OTP", e.getData().get("category"));
        assertEquals("1", e.getSchemaVersion());
    }

    @Test
    void tenantOnTheRequestWins_andCategoryDefaultsToGeneric() {
        NotificationEvent e = translator.translate(Map.of("mobileNumber", "+919415787824", "message", "hi", "tenantId", "pg"), KEY);
        assertEquals("pg", e.getTenantId());
        assertEquals("CORE.SMS.GENERIC", e.getEventName());
        assertEquals("+919415787824", e.getContact().getPhone(), "a '+' number is not re-prefixed");
    }

    @Test
    void twoSendsToTheSameNumberAreTwoRows() {
        // A real resend is a new record: a new offset (or, after a topic is recreated, a new timestamp).
        Map<String, Object> sms = Map.of("mobileNumber", "0712345678", "message", "a");
        String first = translator.translate(sms, KEY).getTransactionId();
        assertNotEquals(first, translator.translate(sms,
                CoreSmsTranslator.recordKey("egov.core.notification.sms", 0, 43L, 1790000000000L)).getTransactionId());
        assertNotEquals(first, translator.translate(sms,
                CoreSmsTranslator.recordKey("egov.core.notification.sms", 0, 42L, 1790000099999L)).getTransactionId());
    }

    @Test
    void aRedeliveredRecordIsTheSameTransaction_soTheReplayGuardCatchesIt() {
        Map<String, Object> sms = Map.of("mobileNumber", "0712345678", "message", "a");
        NotificationEvent first = translator.translate(sms, KEY);
        NotificationEvent again = translator.translate(sms, KEY);
        assertEquals(first.getTransactionId(), again.getTransactionId());
        assertEquals(first.getEventId(), again.getEventId());
    }

    @Test
    void dlqCopyOfAnSmsRequest_dropsTheTextAndMasksThePhone_withoutTouchingTheOriginal() {
        Map<String, Object> sms = new HashMap<>(Map.of("mobileNumber", "0712345678", "message",
                "Your OTP is 481516", "category", "OTP", "tenantId", "ke"));
        List<String> redacted = new ArrayList<>();
        Map<String, Object> copy = CoreSmsTranslator.redactForDlq(sms, redacted);

        assertFalse(copy.containsKey("message"), "the text is the OTP");
        assertEquals("***678", copy.get("mobileNumber"));
        assertEquals("OTP", copy.get("category"));
        assertEquals("ke", copy.get("tenantId"));
        assertEquals(List.of("message", "mobileNumber"), redacted.stream().sorted().toList());
        assertEquals("Your OTP is 481516", sms.get("message"), "the original is not mutated");
        // A replay of the copy is refused rather than sent.
        assertThrows(CustomException.class, () -> translator.translate(copy, KEY));
    }

    @Test
    void dlqCopyOfAnEnvelope_dropsTheBodyAndMasksEveryPhoneBearingField() {
        Map<String, Object> contact = new HashMap<>(Map.of("type", "CITIZEN", "phone", "+254712345678"));
        Map<String, Object> envelope = new HashMap<>(Map.of("eventType", "CORE_SMS", "eventName", "CORE.SMS.OTP",
                "subscriberId", "ke:+254712345678", "renderedBody", "Your OTP is 481516",
                "transactionId", "CORE:ke:5d41402a-bc4b-3a76-b971-9d911017c592", "contact", contact));
        List<String> redacted = new ArrayList<>();
        Map<String, Object> copy = CoreSmsTranslator.redactForDlq(envelope, redacted);

        assertFalse(copy.containsKey("renderedBody"));
        assertEquals("ke:+***678", copy.get("subscriberId"));
        assertEquals("+***678", ((Map<?, ?>) copy.get("contact")).get("phone"));
        assertEquals("CORE.SMS.OTP", copy.get("eventName"));
        assertEquals("CORE:ke:5d41402a-bc4b-3a76-b971-9d911017c592", copy.get("transactionId"));
        assertEquals(List.of("contact.phone", "renderedBody", "subscriberId"), redacted.stream().sorted().toList());
        assertFalse(String.valueOf(copy).contains("481516") || String.valueOf(copy).contains("712345678"),
                String.valueOf(copy));
    }

    @Test
    void missingPhoneOrMessage_isRejectedWithItsOwnCode() {
        CustomException ex = assertThrows(CustomException.class, () -> translator.translate(Map.of("message", "x"), KEY));
        assertEquals("NB_INVALID_CORE_SMS", ex.getCode());
        assertThrows(CustomException.class, () -> translator.translate(Map.of("mobileNumber", "0712345678"), KEY));
    }

    @Test
    void noTenantAnywhere_isRejected_notGuessed() {
        config.setCoreSmsDefaultTenant("");
        assertThrows(CustomException.class, () -> translator.translate(Map.of("mobileNumber", "0712345678", "message", "x"), KEY));
    }

    @Test
    void e164Rules() {
        assertEquals("+254712345678", CoreSmsTranslator.toE164("0712345678", "+254"));
        assertEquals("+254712345678", CoreSmsTranslator.toE164("+254 712 345 678", "+91"));
        // No code configured: NOT "+712345678", which is no one's number (field finding).
        assertNull(CoreSmsTranslator.toE164("712-345-678", ""));
        // A code without '+' is the same code; 00 is the international prefix, not two trunk zeros.
        assertEquals("+254712345678", CoreSmsTranslator.toE164("0712345678", "254"));
        assertEquals("+254712345678", CoreSmsTranslator.toE164("00254712345678", "+254"));
        // Already carries the code: not prefixed twice. A national number that merely starts
        // with the code's digits (India 91…, 10 digits) still is.
        assertEquals("+254712345678", CoreSmsTranslator.toE164("254712345678", "+254"));
        assertEquals("+919415787824", CoreSmsTranslator.toE164("919415787824", "+91"));
        assertEquals("+919123456789", CoreSmsTranslator.toE164("9123456789", "+91"));
    }
    // Field finding (dev deployment, 2026-10-07): with NOVU_BRIDGE_CORE_SMS_COUNTRY_CODE blank a
    // login OTP went out to "+762061507"; and one deployment-wide code is wrong for a deployment
    // whose workspaces are in several countries. The tenant's own rule decides.
    @Test
    @SuppressWarnings({"unchecked", "rawtypes"})
    void theOtpTenantsOwnCountryCodeWins_overTheDeploymentCode() {
        org.springframework.web.client.RestTemplate mdms = org.mockito.Mockito.mock(org.springframework.web.client.RestTemplate.class);
        org.mockito.Mockito.when(mdms.exchange(org.mockito.ArgumentMatchers.anyString(),
                org.mockito.ArgumentMatchers.eq(org.springframework.http.HttpMethod.POST),
                org.mockito.ArgumentMatchers.any(org.springframework.http.HttpEntity.class),
                org.mockito.ArgumentMatchers.eq(Map.class))).thenAnswer(inv -> {
            Map<String, Object> body = (Map<String, Object>) ((org.springframework.http.HttpEntity) inv.getArgument(2)).getBody();
            String tenant = (String) ((Map<String, Object>) body.get("MdmsCriteria")).get("tenantId");
            List<Object> rows = "iworkspace".equals(tenant)
                    ? List.of(Map.of("isActive", true, "data", Map.of("countryCode", "+91", "default", true)))
                    : List.of();
            return new org.springframework.http.ResponseEntity(Map.of("mdms", rows), org.springframework.http.HttpStatus.OK);
        });
        config.setMdmsHost("http://mdms");
        config.setMdmsSearchPath("/mdms-v2/v2/_search");
        CoreSmsTranslator tenantAware = new CoreSmsTranslator(config,
                new org.egov.novubridge.service.TenantPhoneNumbers(mdms, config));

        NotificationEvent india = tenantAware.translate(Map.of("mobileNumber", "9415787824", "message", "x",
                "tenantId", "iworkspace"), KEY);
        assertEquals("+919415787824", india.getContact().getPhone());
        assertEquals("iworkspace:+919415787824", india.getSubscriberId());
        // A tenant without a rule still gets the deployment's code (+254 here).
        assertEquals("+254712345678", tenantAware.translate(Map.of("mobileNumber", "0712345678", "message", "x",
                "tenantId", "kworkspace"), KEY).getContact().getPhone());
    }

    @Test
    void noCountryCodeAnywhere_leavesTheNumberNational_neverPlusNational() {
        config.setCoreSmsCountryCode("");
        NotificationEvent e = translator.translate(Map.of("mobileNumber", "762061507", "message", "x"), KEY);
        assertEquals("762061507", e.getContact().getPhone(), "the pipeline then skips it as NB_CONTACT_INVALID");
        assertFalse(e.getContact().getPhone().startsWith("+"));
    }
}
