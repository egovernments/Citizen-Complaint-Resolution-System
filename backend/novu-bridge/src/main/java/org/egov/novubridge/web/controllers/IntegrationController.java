package org.egov.novubridge.web.controllers;

import org.egov.novubridge.service.NovuClient;
import org.egov.novubridge.web.models.IntegrationListResponse;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Read-only proxy exposing the configured Novu provider integrations to the
 * configurator's Notification Providers screen. Sits alongside
 * {@code DispatchController} under the same {@code /novu-adapter/v1} namespace.
 *
 * <p><b>Secrets stay server-side.</b> Novu is called here with the ApiKey held
 * by {@link NovuClient} (the keyless configurator SPA never sees that key). The
 * upstream integration objects carry provider {@code credentials} (apiKey /
 * apiToken / secretKey / password / token / ...); every value nested under a
 * {@code credentials} object is masked to {@code "***"} before the response
 * leaves this service. There is deliberately NO endpoint that returns the raw
 * Novu key or any provider secret.
 *
 * <p><b>Observability boundary:</b> this lists the Novu-side provider
 * configuration only. Direct Baileys / Telegram WhatsApp senders that bypass
 * Novu are configured elsewhere and are not represented here.
 */
@RestController
@RequestMapping("/novu-adapter/v1")
public class IntegrationController {

    private static final String CREDENTIALS_KEY = "credentials";
    private static final String REDACTED = "***";

    private final NovuClient novuClient;

    public IntegrationController(NovuClient novuClient) {
        this.novuClient = novuClient;
    }

    /**
     * Return the Novu integration list with every credential value redacted.
     *
     * @return {@code {data:[integration...], total}} — read-only, secrets masked.
     */
    @GetMapping("/integrations")
    public ResponseEntity<IntegrationListResponse> integrations() {
        NovuClient.NovuResponse novuResponse = novuClient.listIntegrations();
        List<Map<String, Object>> integrations = extractIntegrations(novuResponse.getResponse());
        List<Map<String, Object>> redacted = new ArrayList<>(integrations.size());
        for (Map<String, Object> integration : integrations) {
            redacted.add(redactCredentials(integration));
        }
        IntegrationListResponse response = IntegrationListResponse.builder()
                .data(redacted)
                .total((long) redacted.size())
                .build();
        return new ResponseEntity<>(response, HttpStatus.OK);
    }

    /** Novu returns {@code {data: [...]}}; be defensive about the envelope shape. */
    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> extractIntegrations(Map<String, Object> body) {
        List<Map<String, Object>> result = new ArrayList<>();
        if (body == null) {
            return result;
        }
        Object data = body.get("data");
        if (data instanceof List) {
            for (Object item : (List<Object>) data) {
                if (item instanceof Map) {
                    result.add((Map<String, Object>) item);
                }
            }
        }
        return result;
    }

    /**
     * Deep-copy an integration, masking every value found under any nested
     * {@code credentials} object. Traverses maps and lists so a credentials
     * block at any depth is caught; leaves all non-credential fields (channel,
     * providerId, active, primary, name, ...) untouched.
     */
    @SuppressWarnings("unchecked")
    private Map<String, Object> redactCredentials(Map<String, Object> integration) {
        Map<String, Object> copy = new LinkedHashMap<>();
        for (Map.Entry<String, Object> entry : integration.entrySet()) {
            String key = entry.getKey();
            Object value = entry.getValue();
            if (CREDENTIALS_KEY.equals(key) && value instanceof Map) {
                copy.put(key, maskAllValues((Map<String, Object>) value));
            } else if (value instanceof Map) {
                copy.put(key, redactCredentials((Map<String, Object>) value));
            } else if (value instanceof List) {
                copy.put(key, redactList((List<Object>) value));
            } else {
                copy.put(key, value);
            }
        }
        return copy;
    }

    @SuppressWarnings("unchecked")
    private List<Object> redactList(List<Object> list) {
        List<Object> out = new ArrayList<>(list.size());
        for (Object item : list) {
            if (item instanceof Map) {
                out.add(redactCredentials((Map<String, Object>) item));
            } else if (item instanceof List) {
                out.add(redactList((List<Object>) item));
            } else {
                out.add(item);
            }
        }
        return out;
    }

    /** Replace every non-null value in a credentials map with the redaction marker. */
    private Map<String, Object> maskAllValues(Map<String, Object> credentials) {
        Map<String, Object> masked = new LinkedHashMap<>();
        for (Map.Entry<String, Object> entry : credentials.entrySet()) {
            masked.put(entry.getKey(), entry.getValue() == null ? null : REDACTED);
        }
        return masked;
    }
}
