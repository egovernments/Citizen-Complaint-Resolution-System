package org.egov.novubridge.web.controllers;

import lombok.extern.slf4j.Slf4j;
import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.novubridge.service.NovuClient;
import org.egov.novubridge.service.SmsCountryClient;
import org.egov.novubridge.service.provider.ProviderCatalog;
import org.egov.novubridge.util.PiiMask;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.util.StringUtils;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.net.URI;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * The JSON face Novu's {@code generic-sms} provider drives for an SMSCountry integration; this
 * translates to SMSCountry's form post. Contract (novuhq/novu v2.3.0 generic-sms): POST to
 * {@code baseUrl} verbatim (so {@code apiUrl} rides as a query parameter), JSON body
 * {@code {to, from, content, id, sender}}, credentials as the configured headers, and the reply
 * must carry a non-empty {@code id} or Novu marks the step failed. A non-2xx is how a gateway
 * rejection reaches Novu as PROVIDER_ERROR rather than a phantom send.
 *
 * <p>Excluded from ProxyAuthFilter (Novu holds no DIGIT token): the credential headers are the
 * authentication, and an {@code apiUrl} on a host that is not allowlisted is refused (400
 * {@code NB_ADAPTER_URL_NOT_ALLOWED}), so a caller inside the network cannot turn this into a proxy
 * to internal addresses, and an operator's credentials never go to a gateway they did not choose.
 */
@RestController
@RequestMapping("/novu-adapter/v1/gateways")
@Slf4j
public class SmsCountryAdapterController {

    private final SmsCountryClient smsCountryClient;
    private final NovuBridgeConfiguration config;

    public SmsCountryAdapterController(SmsCountryClient smsCountryClient, NovuBridgeConfiguration config) {
        this.smsCountryClient = smsCountryClient;
        this.config = config;
    }

    @PostMapping("/smscountry/send")
    public ResponseEntity<Map<String, Object>> send(
            @RequestHeader(name = ProviderCatalog.SMSCOUNTRY_USER_HEADER, required = false) String user,
            @RequestHeader(name = ProviderCatalog.SMSCOUNTRY_PASSWORD_HEADER, required = false) String password,
            @RequestParam(name = ProviderCatalog.ADAPTER_PARAM_API_URL, required = false) String apiUrl,
            @RequestBody(required = false) Map<String, Object> body) {

        if (!StringUtils.hasText(user) || !StringUtils.hasText(password)) {
            log.warn("SMSCountry adapter: rejected a call missing the credential headers");
            return error(HttpStatus.UNAUTHORIZED, "NB_ADAPTER_UNAUTHENTICATED",
                    "Both " + ProviderCatalog.SMSCOUNTRY_USER_HEADER + " and "
                            + ProviderCatalog.SMSCOUNTRY_PASSWORD_HEADER + " are required");
        }
        // Refused, not replaced by the default gateway: that would post these credentials to a
        // vendor endpoint the operator did not choose, and hide that their URL was ignored.
        if (StringUtils.hasText(apiUrl) && !config.isSmsCountryUrlAllowed(apiUrl)) {
            log.warn("SMSCountry adapter: refused an apiUrl on host '{}' (not in novu.bridge.smscountry.allowed.hosts)",
                    hostOf(apiUrl));
            return error(HttpStatus.BAD_REQUEST, "NB_ADAPTER_URL_NOT_ALLOWED",
                    "The provider's Gateway URL is not an http(s) URL on an allowed host; add its host to "
                            + "novu.bridge.smscountry.allowed.hosts (NOVU_BRIDGE_SMSCOUNTRY_ALLOWED_HOSTS) or "
                            + "clear the Gateway URL. Nothing was sent.");
        }

        Map<String, Object> in = body == null ? Map.of() : body;
        String recipient = firstNonBlank(in, "to", "recipient", "phone", "mobilenumber");
        String text = firstNonBlank(in, "content", "text", "message", "body");
        if (!StringUtils.hasText(recipient) || !StringUtils.hasText(text)) {
            return error(HttpStatus.BAD_REQUEST, "NB_ADAPTER_BAD_REQUEST",
                    "Both a recipient (to) and a message (content) are required");
        }
        String senderId = firstNonBlank(in, "from", "sender", "senderId");
        if (!StringUtils.hasText(senderId)) {
            senderId = config.getSmsSenderId();
        }
        String correlationId = firstNonBlank(in, "id", "transactionId");

        NovuClient.NovuResponse result = smsCountryClient.send(recipient, text, correlationId, senderId,
                user, password, StringUtils.hasText(apiUrl) ? apiUrl.trim() : null);
        Map<String, Object> raw = result.getResponse();
        boolean accepted = result.getStatusCode() != null
                && result.getStatusCode() >= 200 && result.getStatusCode() < 300;
        if (!accepted) {
            String code = raw != null && raw.get("error") != null
                    ? raw.get("error").toString() : "NB_SMSCOUNTRY_REJECTED";
            String message = raw != null && raw.get("message") != null
                    ? raw.get("message").toString() : "SMSCountry rejected the message";
            log.warn("SMSCountry adapter: gateway rejected to={} code={}", PiiMask.mask(recipient), code);
            // Non-2xx so Novu records the step FAILED; a 200 with an error body would read as sent.
            return error(HttpStatus.BAD_GATEWAY, code, message);
        }

        Object jobId = raw != null ? raw.get("jobId") : null;
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("id", jobId != null ? jobId.toString() : "");
        out.put("date", Instant.now().toString());
        log.info("SMSCountry adapter: queued to={} jobId={}", PiiMask.mask(recipient), jobId);
        return ResponseEntity.ok(out);
    }

    /** For the log line only. */
    private static String hostOf(String url) {
        try {
            return URI.create(url.trim()).getHost();
        } catch (IllegalArgumentException e) {
            return null;
        }
    }

    private static String firstNonBlank(Map<String, Object> body, String... keys) {
        for (String key : keys) {
            Object value = body.get(key);
            if (value != null && StringUtils.hasText(value.toString().trim())) {
                return value.toString().trim();
            }
        }
        return null;
    }

    private static ResponseEntity<Map<String, Object>> error(HttpStatus status, String code, String message) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("error", code);
        out.put("message", message);
        return ResponseEntity.status(status).body(out);
    }
}
