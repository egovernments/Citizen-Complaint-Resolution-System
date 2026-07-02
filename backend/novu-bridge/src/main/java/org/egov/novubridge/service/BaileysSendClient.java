package org.egov.novubridge.service;

import lombok.extern.slf4j.Slf4j;
import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.tracer.model.CustomException;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import org.springframework.web.client.RestTemplate;

import java.util.HashMap;
import java.util.Map;

/**
 * Client for the self-hosted Baileys WhatsApp send-service. Novu has no
 * Baileys integration, so WHATSAPP delivery is performed out-of-band over
 * HTTP. The result is mapped onto {@link NovuClient.NovuResponse} so the
 * existing dispatch_log persist (SENT/FAILED) path is reused unchanged.
 */
@Service
@Slf4j
public class BaileysSendClient {

    private final RestTemplate restTemplate;
    private final NovuBridgeConfiguration config;

    public BaileysSendClient(RestTemplate restTemplate, NovuBridgeConfiguration config) {
        this.restTemplate = restTemplate;
        this.config = config;
    }

    /**
     * Deliver a free-form WhatsApp message via the Baileys send-service.
     *
     * @param to   recipient MSISDN in E.164 (NO Twilio "whatsapp:" prefix)
     * @param text the pre-rendered, already-localized message body
     */
    public NovuClient.NovuResponse send(String to, String text) {
        if (!StringUtils.hasText(to)) {
            throw new CustomException("NB_BAILEYS_RECIPIENT_MISSING",
                    "Recipient phone is required for Baileys WhatsApp send");
        }
        try {
            Map<String, Object> body = new HashMap<>();
            body.put("to", to);
            body.put("text", text);

            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);
            if (StringUtils.hasText(config.getBaileysToken())) {
                headers.set("Authorization", "Bearer " + config.getBaileysToken());
            }

            String url = resolveSendUrl();
            log.info("Baileys WhatsApp send: url={} to={}", url, to);

            ResponseEntity<Map> response = restTemplate.exchange(url, HttpMethod.POST,
                    new HttpEntity<>(body, headers), Map.class);
            return NovuClient.NovuResponse.builder()
                    .statusCode(response.getStatusCodeValue())
                    .response(response.getBody())
                    .build();
        } catch (Exception e) {
            // Surface as a CustomException so the consumer routes to retry/DLQ.
            log.error("Baileys WhatsApp send failed for to={}", to, e);
            throw new CustomException("NB_BAILEYS_SEND_FAILED",
                    "Failed sending WhatsApp via Baileys: " + e.getMessage());
        }
    }

    /**
     * Build the send endpoint URL. The compose wires NOVU_BRIDGE_BAILEYS_URL as
     * the FULL send URL (e.g. http://baileys-send-service:3040/send), but the
     * default property splits host + send-path. Tolerate both: only append the
     * send path when the base URL doesn't already end with it.
     */
    private String resolveSendUrl() {
        String base = config.getBaileysUrl();
        String path = config.getBaileysSendPath();
        if (!StringUtils.hasText(path)) {
            return base;
        }
        if (base != null && (base.endsWith(path) || base.endsWith(path + "/"))) {
            return base;
        }
        return base + path;
    }
}
