package org.egov.identity.keycloak.sms;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.net.URI;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class SmsSenderTest {

    private record Call(URI uri, String json, Map<String, String> headers) {
    }

    private final List<Call> calls = new ArrayList<>();
    private int status = 200;
    private final JsonPoster poster = (uri, json, headers) -> {
        calls.add(new Call(uri, json, headers));
        return status;
    };
    private final SmsContext ctx = new SmsContext("digit", "bomet", "en", "login_otp");

    @Test
    void selectionDefaultsToLog() {
        assertEquals("log", SmsSenderSelection.selected(key -> null));
    }

    @Test
    void modeWinsOverTheBuildTimeProviderKey() {
        Map<String, String> config = new HashMap<>();
        config.put("provider", "http");
        assertEquals("http", SmsSenderSelection.selected(config::get));
        config.put("mode", "MAILPIT");
        assertEquals("mailpit", SmsSenderSelection.selected(config::get));
    }

    @Test
    void unknownModeFailsLoudly() {
        assertThrows(IllegalStateException.class, () -> SmsSenderSelection.selected(Map.of("mode", "twilio")::get));
    }

    @Test
    void logModeWarnsThatNothingIsDelivered() {
        String warning = SmsSenderSelection.logModeWarning(key -> null);
        assertTrue(warning.contains("NOT delivered"), warning);
        assertTrue(SmsSenderSelection.logModeWarning(Map.of("mode", "log", "allow-dev", "true")::get)
                .contains("allow-dev=true"));
        assertEquals(null, SmsSenderSelection.logModeWarning(Map.of("mode", "http")::get));
        assertEquals(null, SmsSenderSelection.logModeWarning(Map.of("mode", "mailpit")::get));
    }

    @Test
    void allowDevIsOffUnlessExplicitlyTrue() {
        assertFalse(SmsSenderSelection.allowDev(key -> null));
        assertFalse(SmsSenderSelection.allowDev(Map.of("allow-dev", "yes")::get));
        assertTrue(SmsSenderSelection.allowDev(Map.of("allow-dev", "true")::get));
    }

    @Test
    void mailpitRefusesToStartWithoutAllowDev() {
        IllegalStateException e = assertThrows(IllegalStateException.class,
                () -> MailpitSmsSender.assertStartupAllowed(false, "http://mailpit:8025"));
        assertTrue(e.getMessage().contains("ALLOW_DEV"));
        assertThrows(IllegalStateException.class, () -> MailpitSmsSender.assertStartupAllowed(true, " "));
        assertDoesNotThrow(() -> MailpitSmsSender.assertStartupAllowed(true, "http://mailpit:8025"));
    }

    @Test
    void mailpitSendsTheContractMessage() throws Exception {
        MailpitSmsSender sender = new MailpitSmsSender("http://mailpit:8025/mailpit/", "dev", "pw", poster);
        sender.send("+254712345678", "123456 is your code", ctx);
        Call call = calls.get(0);
        assertEquals(URI.create("http://mailpit:8025/mailpit/api/v1/send"), call.uri());
        JsonNode body = new ObjectMapper().readTree(call.json());
        assertEquals("254712345678@sms.local", body.at("/To/0/Email").asText());
        assertEquals("SMS to +254712345678", body.get("Subject").asText());
        assertEquals("123456 is your code", body.get("Text").asText());
        assertEquals("bomet", body.at("/Headers/X-Digit-Tenant").asText());
        assertTrue(call.headers().get("Authorization").startsWith("Basic "));
    }

    @Test
    void httpSendsTheContractPayloadWithBearer() throws Exception {
        HttpSmsSender sender = new HttpSmsSender("http://identity-bff:3000/internal/identity/v1/sms/_send", "tok", poster);
        sender.send("+254712345678", "hello", ctx);
        JsonNode body = new ObjectMapper().readTree(calls.get(0).json());
        assertEquals("+254712345678", body.get("to").asText());
        assertEquals("hello", body.get("body").asText());
        assertEquals("bomet", body.at("/meta/tenant").asText());
        assertEquals("login_otp", body.at("/meta/purpose").asText());
        assertEquals("Bearer tok", calls.get(0).headers().get("Authorization"));
    }

    @Test
    void nonSuccessAndTransportErrorsBecomeSmsSendException() {
        status = 502;
        assertThrows(SmsSendException.class,
                () -> new HttpSmsSender("http://gw/send", null, poster).send("+254712345678", "x", ctx));
        JsonPoster broken = (uri, json, headers) -> {
            throw new IOException("refused");
        };
        assertThrows(SmsSendException.class,
                () -> new MailpitSmsSender("http://mailpit:8025", null, null, broken).send("+254712345678", "x", ctx));
    }

    @Test
    void logSenderNeverThrows() {
        assertDoesNotThrow(() -> new LogSmsSender(false).send("+254712345678", "123456", ctx));
    }
}
