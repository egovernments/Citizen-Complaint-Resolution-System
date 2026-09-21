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

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * The SMSCountry adapter: the JSON face this service wears so Novu can drive a gateway that
 * speaks neither JSON nor HTTP status codes.
 *
 * <p>SMSCountry's legacy bulk API takes form-encoded parameters and answers in plain text
 * ({@code OK:<jobid>}), always with HTTP 200 — malformed requests come back 200 carrying an
 * ASP.NET stack trace. No Novu provider can express that. So an {@code smscountry} provider
 * configured in the configurator is really a Novu {@code generic-sms} integration pointed at
 * THIS endpoint, and this endpoint does the translating.
 *
 * <p><b>Request shape, confirmed against novuhq/novu v2.3.0</b>
 * ({@code packages/providers/src/lib/sms/generic-sms/generic-sms.provider.ts} and
 * {@code apps/worker/src/app/workflow/usecases/send-message/send-message-sms.usecase.ts}):
 * <ul>
 *   <li>Always {@code POST}, to the {@code baseUrl} credential <em>verbatim</em> — axios is
 *       created with {@code baseURL} and the request passes no {@code url}, so no path is
 *       appended. Hence {@code novu.bridge.smscountry.adapter.url} is the complete URL, and a
 *       query string on it survives (that is how {@code apiUrl} gets here).</li>
 *   <li>Content type is axios's default for an object body: {@code application/json}. The
 *       provider sets no explicit header.</li>
 *   <li>Body is {@code {to, from, content, id, customData, sender}}. {@code from} and
 *       {@code sender} both carry {@code overrides.sms.from || credentials.from}, which is
 *       where the registered sender id travels. {@code id} is Novu's message {@code _id}.</li>
 *   <li>Credentials arrive as HEADERS: the constructor does
 *       {@code headers = { [config.apiKeyRequestHeader]: config.apiKey }} and adds
 *       {@code [config.secretKeyRequestHeader]: config.secretKey} when both are set. So
 *       {@code apiKeyRequestHeader}/{@code secretKeyRequestHeader} are header <em>names</em>
 *       and the catalog stores {@link ProviderCatalog#SMSCOUNTRY_USER_HEADER} /
 *       {@link ProviderCatalog#SMSCOUNTRY_PASSWORD_HEADER} in them.</li>
 *   <li>The reply is read with {@code idPath}/{@code datePath} (dot paths into the response
 *       body; the catalog sets them to {@code id} and {@code date}). The lookup is a bare
 *       {@code reduce} with no null guard, and the worker marks the step failed unless
 *       {@code result.id} is truthy — so a success MUST answer with a non-empty {@code id}.
 *       A non-2xx makes axios throw, which the worker records as PROVIDER_ERROR: that is how
 *       a gateway rejection is reported honestly instead of as a phantom send.</li>
 * </ul>
 *
 * <p><b>Not a browser endpoint.</b> Novu holds no DIGIT token, so this path is excluded from
 * {@link org.egov.novubridge.web.filters.ProxyAuthFilter}. In its place the credential headers
 * are themselves the authentication: without both, nothing is sent anywhere. Credentials are
 * never logged and recipients are always masked.
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

        // The credential headers ARE the authentication here. Refuse before touching the
        // gateway, and say only which header is missing — never what was sent.
        if (!StringUtils.hasText(user) || !StringUtils.hasText(password)) {
            log.warn("SMSCountry adapter: rejected a call missing the credential headers");
            return error(HttpStatus.UNAUTHORIZED, "NB_ADAPTER_UNAUTHENTICATED",
                    "Both " + ProviderCatalog.SMSCOUNTRY_USER_HEADER + " and "
                            + ProviderCatalog.SMSCOUNTRY_PASSWORD_HEADER + " are required");
        }

        Map<String, Object> in = body == null ? Map.of() : body;
        String recipient = firstNonBlank(in, "to", "recipient", "phone", "mobilenumber");
        String text = firstNonBlank(in, "content", "text", "message", "body");
        if (!StringUtils.hasText(recipient) || !StringUtils.hasText(text)) {
            return error(HttpStatus.BAD_REQUEST, "NB_ADAPTER_BAD_REQUEST",
                    "Both a recipient (to) and a message (content) are required");
        }
        // generic-sms sends the integration's `from` under both `from` and `sender`.
        String senderId = firstNonBlank(in, "from", "sender", "senderId");
        if (!StringUtils.hasText(senderId)) {
            senderId = config.getSmsSenderId();
        }
        // Novu's message _id: the only correlator the gateway call can carry into our logs.
        String correlationId = firstNonBlank(in, "id", "transactionId");

        NovuClient.NovuResponse result = smsCountryClient.send(recipient, text, correlationId, senderId,
                user, password, sanitizeApiUrl(apiUrl));
        Map<String, Object> raw = result.getResponse();
        boolean accepted = result.getStatusCode() != null
                && result.getStatusCode() >= 200 && result.getStatusCode() < 300;

        if (!accepted) {
            String code = raw != null && raw.get("error") != null
                    ? raw.get("error").toString() : "NB_SMSCOUNTRY_REJECTED";
            String message = raw != null && raw.get("message") != null
                    ? raw.get("message").toString() : "SMSCountry rejected the message";
            log.warn("SMSCountry adapter: gateway rejected to={} code={}", PiiMask.mask(recipient), code);
            // Non-2xx so axios throws inside generic-sms and Novu records the step FAILED. A 200
            // with an error body would be read as a successful send by everything downstream.
            return error(HttpStatus.BAD_GATEWAY, code, message);
        }

        Object jobId = raw != null ? raw.get("jobId") : null;
        Map<String, Object> out = new LinkedHashMap<>();
        // Queued, not delivered — the gateway's delivery report is the only proof of delivery.
        out.put("id", jobId != null ? jobId.toString() : "");
        out.put("date", Instant.now().toString());
        log.info("SMSCountry adapter: queued to={} jobId={}", PiiMask.mask(recipient), jobId);
        return ResponseEntity.ok(out);
    }

    /**
     * Only an absolute http(s) URL is honoured as the per-integration gateway endpoint;
     * anything else falls back to {@code novu.bridge.smscountry.url}. The value comes from an
     * authenticated operator via the Novu integration, but it decides where this service posts
     * a live credential, so it is not taken on trust.
     */
    private static String sanitizeApiUrl(String apiUrl) {
        if (!StringUtils.hasText(apiUrl)) {
            return null;
        }
        String trimmed = apiUrl.trim();
        if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
            return trimmed;
        }
        log.warn("SMSCountry adapter: ignoring a non-http apiUrl parameter");
        return null;
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
