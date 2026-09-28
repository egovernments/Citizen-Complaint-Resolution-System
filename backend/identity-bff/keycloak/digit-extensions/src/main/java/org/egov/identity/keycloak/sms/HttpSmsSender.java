package org.egov.identity.keycloak.sms;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.net.URI;
import java.util.HashMap;
import java.util.Map;

/**
 * Generic gateway: {@code POST <url>} with
 * {@code {"to":"+2547…","body":"…","meta":{"tenant":"…","purpose":"…"}}} and
 * {@code Authorization: Bearer <token>}. Intended target is the identity BFF's
 * future {@code /internal/identity/v1/sms/_send}.
 */
public final class HttpSmsSender implements DigitSmsSender {

    private final URI uri;
    private final String token;
    private final JsonPoster poster;
    private final ObjectMapper json = new ObjectMapper();

    public HttpSmsSender(String url, String token, JsonPoster poster) {
        this.uri = URI.create(url);
        this.token = token;
        this.poster = poster;
    }

    String payload(String e164, String text, SmsContext context) {
        ObjectNode body = json.createObjectNode();
        body.put("to", e164);
        body.put("body", text);
        ObjectNode meta = body.putObject("meta");
        meta.put("tenant", context.tenant());
        meta.put("purpose", context.purpose());
        return body.toString();
    }

    @Override
    public void send(String e164, String text, SmsContext context) throws SmsSendException {
        Map<String, String> headers = new HashMap<>();
        if (token != null && !token.isBlank()) {
            headers.put("Authorization", "Bearer " + token);
        }
        try {
            int status = poster.post(uri, payload(e164, text, context), headers);
            if (status / 100 != 2) {
                throw new SmsSendException("sms gateway returned HTTP " + status);
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new SmsSendException("interrupted", e);
        } catch (IOException e) {
            throw new SmsSendException("sms gateway unreachable: " + e.getMessage(), e);
        }
    }
}
