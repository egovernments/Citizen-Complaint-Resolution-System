package org.egov.novubridge.service;

import lombok.extern.slf4j.Slf4j;
import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.novubridge.util.PiiMask;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.util.StringUtils;
import org.springframework.web.client.RestClientResponseException;
import org.springframework.web.client.RestTemplate;

import java.util.HashMap;
import java.util.Map;

/**
 * SMSCountry's legacy bulk API: form-encoded request, plain-text reply. No Novu provider can
 * express that, hence a direct client.
 *
 * <p>HTTP 200 is not success (malformed requests get 200 plus an ASP.NET stack trace); only a body
 * starting {@code OK:} is. And accepted is not delivered: an unregistered DLT template still gets
 * {@code OK:<jobid>}, so a 2xx here means queued and only the delivery report proves delivery.
 */
@Service
@Slf4j
public class SmsCountryClient {

    private static final int LOG_SNIPPET_CHARS = 200;

    private final RestTemplate restTemplate;
    private final NovuBridgeConfiguration config;

    public SmsCountryClient(RestTemplate restTemplate, NovuBridgeConfiguration config) {
        this.restTemplate = restTemplate;
        this.config = config;
    }

    /** @param senderId registered sender id for THIS send (per-tenant policy may override the env default) */
    public NovuClient.NovuResponse send(String phone, String text, String transactionId, String senderId) {
        return send(phone, text, transactionId, senderId,
                config.getSmsCountryUser(), config.getSmsCountryPassword(), config.getSmsCountryUrl());
    }

    /**
     * Send with per-call credentials (the adapter endpoint receives them from Novu).
     *
     * @param apiUrl gateway endpoint for THIS send; blank = the configured one. Callers must have
     *               vetted it: this client posts credentials to whatever it is given.
     */
    public NovuClient.NovuResponse send(String phone, String text, String transactionId, String senderId,
                                        String user, String password, String apiUrl) {
        MultiValueMap<String, String> form = new LinkedMultiValueMap<>();
        form.add("User", user);
        form.add("passwd", password);
        form.add("mobilenumber", phone == null ? null : phone.replaceAll("[^0-9]", ""));
        form.add("message", text);
        form.add("sid", senderId);
        form.add("mtype", "N");
        form.add("DR", "Y");
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_FORM_URLENCODED);

        String url = StringUtils.hasText(apiUrl) ? apiUrl.trim() : config.getSmsCountryUrl();
        String body;
        try {
            body = restTemplate.exchange(url, HttpMethod.POST, new HttpEntity<>(form, headers), String.class).getBody();
        } catch (Exception e) {
            // Never surface e.getMessage(): RestTemplate puts the upstream response body in it.
            String cause = e instanceof RestClientResponseException re
                    ? "HTTP " + re.getStatusCode().value() : e.getClass().getSimpleName();
            log.error("SMSCountry send failed for txn={} to={}: {}", transactionId, PiiMask.mask(phone), cause);
            return error("NB_SMSCOUNTRY_UNREACHABLE", "SMSCountry gateway call failed (" + cause + ")");
        }
        return parse(body, transactionId, phone, user, password);
    }

    /**
     * {@code OK:<jobid>} is the only accepted response. The upstream body is never returned
     * (the adapter's caller would read it back); a redacted snippet is logged instead.
     */
    NovuClient.NovuResponse parse(String body, String transactionId, String phone, String... secrets) {
        String trimmed = body == null ? "" : body.trim();
        if (!trimmed.startsWith("OK:")) {
            log.error("SMSCountry rejected txn={} to={}: {}", transactionId, PiiMask.mask(phone), snippet(trimmed, secrets));
            return error("NB_SMSCOUNTRY_REJECTED", "SMSCountry did not answer OK:<jobid>; see the bridge log for txn "
                    + transactionId);
        }
        String jobId = trimmed.substring(3).trim();
        log.info("SMSCountry queued txn={} to={} jobId={}", transactionId, PiiMask.mask(phone), jobId);
        Map<String, Object> payload = new HashMap<>();
        payload.put("jobId", jobId);
        payload.put("accepted", true);
        return build(200, payload);
    }

    private static String snippet(String s, String... secrets) {
        String out = s.length() <= LOG_SNIPPET_CHARS ? s : s.substring(0, LOG_SNIPPET_CHARS) + "…";
        for (String secret : secrets) {
            if (StringUtils.hasText(secret)) {
                out = out.replace(secret, "***");
            }
        }
        return out;
    }

    private static NovuClient.NovuResponse error(String code, String message) {
        Map<String, Object> payload = new HashMap<>();
        payload.put("error", code);
        payload.put("message", message);
        return build(502, payload);
    }

    private static NovuClient.NovuResponse build(int status, Map<String, Object> payload) {
        return NovuClient.NovuResponse.builder().statusCode(status).response(payload).build();
    }
}
