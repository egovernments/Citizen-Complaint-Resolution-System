package org.egov.novubridge.service.core;

import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.novubridge.web.models.NotificationEvent;
import org.egov.tracer.model.CustomException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

class CoreSmsTranslatorTest {

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
        NotificationEvent e = translator.translate(sms);
        assertEquals("CORE_SMS", e.getEventType());
        assertEquals("CORE.SMS.OTP", e.getEventName());
        assertEquals("CORE", e.getModule());
        assertEquals("SMS", e.getChannel());
        assertEquals("ke", e.getTenantId());
        assertEquals("+254712345678", e.getContact().getPhone());
        assertEquals("ke:+254712345678", e.getSubscriberId());
        assertEquals("Your OTP is 481516. Valid for 5 minutes.", e.getRenderedBody());
        assertTrue(e.getTransactionId().startsWith("CORE:ke:+254712345678:"));
        assertEquals("OTP", e.getData().get("category"));
        assertEquals("1", e.getSchemaVersion());
    }

    @Test
    void tenantOnTheRequestWins_andCategoryDefaultsToGeneric() {
        NotificationEvent e = translator.translate(Map.of("mobileNumber", "+919415787824", "message", "hi", "tenantId", "pg"));
        assertEquals("pg", e.getTenantId());
        assertEquals("CORE.SMS.GENERIC", e.getEventName());
        assertEquals("+919415787824", e.getContact().getPhone(), "a '+' number is not re-prefixed");
    }

    @Test
    void twoSendsToTheSameNumberAreTwoRows() {
        Map<String, Object> sms = Map.of("mobileNumber", "0712345678", "message", "a");
        assertNotEquals(translator.translate(sms).getTransactionId(), translator.translate(sms).getTransactionId());
    }

    @Test
    void missingPhoneOrMessage_isRejectedWithItsOwnCode() {
        CustomException ex = assertThrows(CustomException.class, () -> translator.translate(Map.of("message", "x")));
        assertEquals("NB_INVALID_CORE_SMS", ex.getCode());
        assertThrows(CustomException.class, () -> translator.translate(Map.of("mobileNumber", "0712345678")));
    }

    @Test
    void noTenantAnywhere_isRejected_notGuessed() {
        config.setCoreSmsDefaultTenant("");
        assertThrows(CustomException.class, () -> translator.translate(Map.of("mobileNumber", "0712345678", "message", "x")));
    }

    @Test
    void e164Rules() {
        assertEquals("+254712345678", CoreSmsTranslator.toE164("0712345678", "+254"));
        assertEquals("+254712345678", CoreSmsTranslator.toE164("+254 712 345 678", "+91"));
        assertEquals("712345678", CoreSmsTranslator.toE164("712-345-678", ""));
    }
}
