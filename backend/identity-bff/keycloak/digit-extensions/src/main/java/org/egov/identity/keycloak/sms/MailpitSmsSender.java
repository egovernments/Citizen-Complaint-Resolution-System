package org.egov.identity.keycloak.sms;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.HashMap;
import java.util.Map;

/**
 * DEV ONLY. "Delivers" an SMS as an e-mail through Mailpit's send API so a
 * developer can read OTPs at {@code /mailpit}:
 * To {@code <digits>@sms.local}, Subject {@code SMS to +<digits>}, Text = the SMS.
 */
public final class MailpitSmsSender implements DigitSmsSender {

    private final URI sendUri;
    private final String authorization;
    private final JsonPoster poster;
    private final ObjectMapper json = new ObjectMapper();

    public MailpitSmsSender(String baseUrl, String username, String password, JsonPoster poster) {
        String base = baseUrl.endsWith("/") ? baseUrl.substring(0, baseUrl.length() - 1) : baseUrl;
        this.sendUri = URI.create(base + "/api/v1/send");
        this.authorization = username == null || username.isBlank() ? null
                : "Basic " + Base64.getEncoder().encodeToString(
                        (username + ":" + (password == null ? "" : password)).getBytes(StandardCharsets.UTF_8));
        this.poster = poster;
    }

    /** Refuse to exist outside development: called when mailpit is the selected mode. */
    public static void assertStartupAllowed(boolean allowDev, String baseUrl) {
        if (!allowDev) {
            throw new IllegalStateException("digit-sms-sender mode 'mailpit' is development-only: "
                    + "set KC_SPI_DIGIT_SMS_SENDER_ALLOW_DEV=true to acknowledge that OTPs are not delivered");
        }
        if (baseUrl == null || baseUrl.isBlank()) {
            throw new IllegalStateException("digit-sms-sender mode 'mailpit' needs KC_SPI_DIGIT_SMS_SENDER_MAILPIT_URL");
        }
    }

    public URI sendUri() {
        return sendUri;
    }

    String payload(String e164, String text, SmsContext context) {
        String digits = e164.startsWith("+") ? e164.substring(1) : e164;
        ObjectNode body = json.createObjectNode();
        body.putObject("From").put("Email", "sms@sms.local").put("Name", "DIGIT SMS");
        body.putArray("To").addObject().put("Email", digits + "@sms.local");
        body.put("Subject", "SMS to +" + digits);
        body.put("Text", text);
        ObjectNode headers = body.putObject("Headers");
        if (context.tenant() != null) {
            headers.put("X-Digit-Tenant", context.tenant());
        }
        if (context.purpose() != null) {
            headers.put("X-Digit-Purpose", context.purpose());
        }
        return body.toString();
    }

    @Override
    public void send(String e164, String text, SmsContext context) throws SmsSendException {
        Map<String, String> headers = new HashMap<>();
        if (authorization != null) {
            headers.put("Authorization", authorization);
        }
        try {
            int status = poster.post(sendUri, payload(e164, text, context), headers);
            if (status / 100 != 2) {
                throw new SmsSendException("mailpit returned HTTP " + status);
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new SmsSendException("interrupted", e);
        } catch (IOException e) {
            throw new SmsSendException("mailpit unreachable: " + e.getMessage(), e);
        }
    }
}
