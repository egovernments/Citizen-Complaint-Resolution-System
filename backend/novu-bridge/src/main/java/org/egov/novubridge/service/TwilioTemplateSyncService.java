package org.egov.novubridge.service;

import lombok.extern.slf4j.Slf4j;
import org.egov.tracer.model.CustomException;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import org.springframework.web.client.RestTemplate;

import java.nio.charset.StandardCharsets;
import java.util.*;

/**
 * Pulls the linked Twilio account's WhatsApp Content templates
 * ({@code content.twilio.com/v1/ContentAndApprovals}) and returns them as provider
 * metadata — SID, friendly name, language, approval status, and the name's tokens.
 *
 * <p>Deliberately domain-dumb: the bridge does NOT decide which PGR routing key a
 * template belongs to. That matching (audience, action, toState, locale, ordered
 * variables) is done in the configurator against the tenant's own NotificationRouting
 * and NotificationTemplate rows, which is where that knowledge lives.
 *
 * <p><b>Secrets stay server-side.</b> The Twilio Account SID / Auth Token are read from
 * the Novu integration and used only to call Twilio here; they are never returned or logged.
 */
@Service
@Slf4j
public class TwilioTemplateSyncService {

    private final NovuClient novuClient;
    private final RestTemplate restTemplate;

    private static final String TWILIO_CONTENT_APPROVALS_URL =
            "https://content.twilio.com/v1/ContentAndApprovals";

    public TwilioTemplateSyncService(NovuClient novuClient, RestTemplate restTemplate) {
        this.novuClient = novuClient;
        this.restTemplate = restTemplate;
    }

    /**
     * @return {@code {templates:[{templateId, templateName, language, approvalStatus, tokens[]}], total}}
     */
    @SuppressWarnings("unchecked")
    public Map<String, Object> syncWhatsappTemplates() {
        String[] creds = twilioCredentials();
        String accountSid = creds[0], authToken = creds[1];

        List<Map<String, Object>> templates = new ArrayList<>();
        String url = TWILIO_CONTENT_APPROVALS_URL + "?PageSize=200";
        int pages = 0;
        while (url != null && pages++ < 20) {   // bound pagination
            Map<String, Object> page = twilioGet(url, accountSid, authToken);
            List<Object> contents = (List<Object>) page.getOrDefault("contents", Collections.emptyList());
            for (Object o : contents) {
                if (!(o instanceof Map)) continue;
                Map<String, Object> c = (Map<String, Object>) o;
                Map<String, Object> row = new LinkedHashMap<>();
                row.put("templateId", str(c.get("sid")));
                row.put("templateName", str(c.get("friendly_name")));
                row.put("language", str(c.get("language")));
                row.put("approvalStatus", whatsappApprovalStatus(c));
                row.put("tokens", tokens(str(c.get("friendly_name"))));
                templates.add(row);
            }
            url = nextPageUrl(page);
        }
        log.info("Twilio template sync: {} templates fetched", templates.size());
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("templates", templates);
        out.put("total", templates.size());
        return out;
    }

    /** Lower-cased {@code _}-split tokens of a friendly_name (empty for a blank name). */
    static List<String> tokens(String friendlyName) {
        if (!StringUtils.hasText(friendlyName)) return List.of();
        return Arrays.asList(friendlyName.toLowerCase(Locale.ROOT).split("_"));
    }

    /** Twilio Account SID + Auth Token from the Novu twilio integration (internal use only). */
    @SuppressWarnings("unchecked")
    private String[] twilioCredentials() {
        NovuClient.NovuResponse res = novuClient.listIntegrations();
        Object data = res != null && res.getResponse() != null ? res.getResponse().get("data") : null;
        if (data instanceof List) {
            for (Object o : (List<Object>) data) {
                if (!(o instanceof Map)) continue;
                Map<String, Object> i = (Map<String, Object>) o;
                if (!"twilio".equalsIgnoreCase(str(i.get("providerId")))) continue;
                Map<String, Object> cred = (Map<String, Object>) i.get("credentials");
                if (cred == null) continue;
                String sid = str(cred.get("accountSid"));
                String token = str(cred.get("token"));
                if (token == null) token = str(cred.get("authToken"));
                if (StringUtils.hasText(sid) && StringUtils.hasText(token)) {
                    return new String[]{sid, token};
                }
            }
        }
        throw new CustomException("NB_NO_TWILIO_INTEGRATION",
                "No Twilio integration with credentials found in Novu — add the Twilio provider first.");
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> twilioGet(String url, String accountSid, String authToken) {
        try {
            HttpHeaders h = new HttpHeaders();
            String basic = Base64.getEncoder().encodeToString(
                    (accountSid + ":" + authToken).getBytes(StandardCharsets.UTF_8));
            h.set("Authorization", "Basic " + basic);
            ResponseEntity<Map> r = restTemplate.exchange(url, HttpMethod.GET, new HttpEntity<>(h), Map.class);
            return r.getBody() != null ? r.getBody() : Collections.emptyMap();
        } catch (Exception e) {
            log.error("Twilio ContentAndApprovals call failed: {}", e.getMessage());
            throw new CustomException("NB_TWILIO_CONTENT_FETCH_FAILED",
                    "Failed to fetch templates from Twilio: " + e.getMessage());
        }
    }

    /** WhatsApp channel approval status from a ContentAndApprovals entry, or "unknown". */
    @SuppressWarnings("unchecked")
    private String whatsappApprovalStatus(Map<String, Object> content) {
        Object ar = content.get("approval_requests");
        if (ar instanceof Map) {
            Object status = ((Map<String, Object>) ar).get("status");
            if (status != null) return status.toString();
        }
        if (ar instanceof List) {
            for (Object o : (List<Object>) ar) {
                if (o instanceof Map) {
                    Map<String, Object> req = (Map<String, Object>) o;
                    if ("whatsapp".equalsIgnoreCase(str(req.get("channel"))) || req.containsKey("status")) {
                        return str(req.get("status"));
                    }
                }
            }
        }
        return "unknown";
    }

    @SuppressWarnings("unchecked")
    private String nextPageUrl(Map<String, Object> page) {
        Object meta = page.get("meta");
        if (meta instanceof Map) {
            Object next = ((Map<String, Object>) meta).get("next_page_url");
            return next != null && StringUtils.hasText(next.toString()) ? next.toString() : null;
        }
        return null;
    }

    private static String str(Object o) {
        return o == null ? null : o.toString();
    }
}
