package org.egov.novubridge.service;

import lombok.extern.slf4j.Slf4j;
import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.novubridge.util.PiiMask;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.web.client.RestTemplate;

import java.util.HashMap;
import java.util.Map;

/**
 * Delivers an SMS straight to SMSCountry's legacy bulk API, bypassing Novu.
 *
 * <p>SMSCountry runs two APIs. The legacy one — the API eGov accounts are
 * provisioned on — takes <b>form-encoded parameters</b> and answers in <b>plain
 * text</b>. No Novu provider can express that: the closest, {@code generic-sms},
 * injects a JSON body. Hence a direct client. The newer REST v0.1 JSON API is not
 * supported.
 *
 * <p>Two behaviours of this gateway drive the design:
 * <ul>
 *   <li><b>HTTP 200 is not success.</b> Malformed requests return 200 carrying an
 *       ASP.NET stack trace. Only a body starting {@code OK:} means accepted.</li>
 *   <li><b>Accepted is not delivered.</b> A message the operator later drops — an
 *       unregistered DLT template, most often — still gets {@code OK:<jobid>} here.
 *       So a 2xx from this client means queued, and the gateway's delivery report
 *       is the only proof of delivery. Nothing downstream can infer more.</li>
 * </ul>
 *
 * <p>Returns {@link NovuClient.NovuResponse} so {@code DispatchPipelineService}
 * handles direct and Novu-routed sends identically.
 */
@Service
@Slf4j
public class SmsCountryClient {

    private final RestTemplate restTemplate;
    private final NovuBridgeConfiguration config;

    public SmsCountryClient(RestTemplate restTemplate, NovuBridgeConfiguration config) {
        this.restTemplate = restTemplate;
        this.config = config;
    }

    /**
     * @param phone         recipient; the gateway wants plain digits with country
     *                      code, while the pipeline carries +E164
     * @param text          final localized body. It must match a template registered
     *                      against the sender id, or the operator silently drops it.
     * @param transactionId dispatch correlation id, logged only — the legacy send
     *                      body has no caller-supplied correlator field
     */
    public NovuClient.NovuResponse send(String phone, String text, String transactionId) {
        MultiValueMap<String, String> form = new LinkedMultiValueMap<>();
        form.add("User", config.getSmsCountryUser());
        form.add("passwd", config.getSmsCountryPassword());
        form.add("mobilenumber", toNationalDigits(phone));
        form.add("message", text);
        form.add("sid", config.getSmsSenderId());
        form.add("mtype", "N");
        form.add("DR", "Y");

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_FORM_URLENCODED);

        String body;
        try {
            ResponseEntity<String> response = restTemplate.exchange(
                    config.getSmsCountryUrl(), HttpMethod.POST,
                    new HttpEntity<>(form, headers), String.class);
            body = response.getBody();
        } catch (Exception e) {
            log.error("SMSCountry send failed for txn={} to={}: {}",
                    transactionId, PiiMask.mask(phone), e.getMessage());
            return error("NB_SMSCOUNTRY_UNREACHABLE", e.getMessage());
        }
        return parse(body, transactionId, phone);
    }

    /**
     * {@code OK:<jobid>} is the only accepted response. Anything else — an error
     * string, an HTML error page, an empty body — is a failure regardless of the
     * HTTP status, which this gateway reports as 200 either way.
     */
    NovuClient.NovuResponse parse(String body, String transactionId, String phone) {
        String trimmed = body == null ? "" : body.trim();
        if (!trimmed.startsWith("OK:")) {
            log.error("SMSCountry rejected txn={} to={}: {}",
                    transactionId, PiiMask.mask(phone), abbreviate(trimmed));
            return error("NB_SMSCOUNTRY_REJECTED", abbreviate(trimmed));
        }
        String jobId = trimmed.substring(3).trim();
        // Queued, NOT delivered. An unregistered DLT template is accepted here and
        // dropped by the operator; only the delivery report distinguishes them.
        log.info("SMSCountry queued txn={} to={} jobId={}",
                transactionId, PiiMask.mask(phone), jobId);
        Map<String, Object> payload = new HashMap<>();
        payload.put("jobId", jobId);
        payload.put("accepted", true);
        return build(200, payload);
    }

    /** The gateway wants the country code with no leading {@code +}. */
    private static String toNationalDigits(String phone) {
        return phone == null ? null : phone.replaceAll("[^0-9]", "");
    }

    private static String abbreviate(String s) {
        return s.length() <= 200 ? s : s.substring(0, 200) + "…";
    }

    private static NovuClient.NovuResponse error(String code, String message) {
        Map<String, Object> payload = new HashMap<>();
        payload.put("error", code);
        payload.put("message", message);
        return build(502, payload);
    }

    private static NovuClient.NovuResponse build(int status, Map<String, Object> payload) {
        NovuClient.NovuResponse r = new NovuClient.NovuResponse();
        r.setStatusCode(status);
        r.setResponse(payload);
        return r;
    }
}
