package org.egov.novubridge.service;

import lombok.extern.slf4j.Slf4j;
import org.egov.tracer.model.CustomException;
import org.springframework.http.*;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import org.springframework.web.client.RestTemplate;

import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * §4 of the 2026-07-06 provider-template-mapping design: pull the linked Twilio
 * account's <b>approved WhatsApp Content templates</b> from
 * {@code content.twilio.com/v1/ContentAndApprovals}, auto-match each
 * {@code complaints_{action}_{toState}_[hindi_]message[_new]} friendly-name to a PGR
 * routing key, and return proposed {@code RAINMAKER-PGR.NotificationProviderTemplate}
 * rows (ContentSid + ordered variables) for the configurator to persist.
 *
 * <p><b>Secrets stay server-side.</b> The Twilio Account SID / Auth Token are read
 * from the Novu integration and used only to call Twilio here; they are never
 * returned to the caller or logged. Only the resulting SID→routing-key mapping is
 * returned.
 */
@Service
@Slf4j
public class TwilioTemplateSyncService {

    private final NovuClient novuClient;
    private final RestTemplate restTemplate;

    private static final String TWILIO_CONTENT_APPROVALS_URL =
            "https://content.twilio.com/v1/ContentAndApprovals";

    /** friendly_name convention: complaints_{action}_{toState}_[hindi_]message[_new]. */
    private static final Pattern FRIENDLY_NAME = Pattern.compile(
            "complaints_([a-z]+)_([a-z]+)_(?:(hindi)_)?message(?:_new)?", Pattern.CASE_INSENSITIVE);

    /**
     * Canonical ordered variable names per routing key (design §3). Positional →
     * these fill Twilio {@code {{1}},{{2}},…}. Operators should confirm order in the UI.
     */
    private static final Map<String, List<String>> VARIABLE_ORDER = Map.of(
            "APPLY.PENDINGFORASSIGNMENT",       List.of("complaint_type", "id", "date"),
            "ASSIGN.PENDINGATLME",              List.of("complaint_type", "id", "date", "emp_name", "emp_designation", "emp_department"),
            "RESOLVE.RESOLVED",                 List.of("complaint_type", "id", "date", "emp_name"),
            "REJECT.REJECTED",                  List.of("complaint_type", "id", "date", "additional_comments"),
            "REOPEN.PENDINGFORASSIGNMENT",      List.of("complaint_type", "id", "date"),
            "REASSIGN.PENDINGFORREASSIGNMENT",  List.of("complaint_type", "id", "date", "emp_name", "emp_designation", "emp_department"),
            "RATE.CLOSEDAFTERRESOLUTION",       List.of("complaint_type", "id", "date"));

    public TwilioTemplateSyncService(NovuClient novuClient, RestTemplate restTemplate) {
        this.novuClient = novuClient;
        this.restTemplate = restTemplate;
    }

    /**
     * Returns proposed NotificationProviderTemplate rows for every approved WhatsApp
     * template whose friendly_name matches the PGR convention. Each row:
     * {@code {provider, channel, audience, action, toState, locale, templateId,
     * templateName, variables[], approvalStatus, active}} — ready for MDMS upsert.
     * Also returns unmatched/non-approved entries as diagnostics so the operator
     * sees the gaps.
     */
    @SuppressWarnings("unchecked")
    public Map<String, Object> syncWhatsappTemplates() {
        String[] creds = twilioCredentials();
        String accountSid = creds[0], authToken = creds[1];

        List<Map<String, Object>> matched = new ArrayList<>();
        List<Map<String, Object>> unmatched = new ArrayList<>();

        String url = TWILIO_CONTENT_APPROVALS_URL + "?PageSize=200";
        int pages = 0;
        while (url != null && pages++ < 20) {   // bound pagination
            Map<String, Object> page = twilioGet(url, accountSid, authToken);
            List<Object> contents = (List<Object>) page.getOrDefault("contents", Collections.emptyList());
            for (Object o : contents) {
                if (!(o instanceof Map)) continue;
                Map<String, Object> c = (Map<String, Object>) o;
                String sid = str(c.get("sid"));
                String friendlyName = str(c.get("friendly_name"));
                String waStatus = whatsappApprovalStatus(c);

                Matcher m = FRIENDLY_NAME.matcher(friendlyName == null ? "" : friendlyName);
                if (!m.matches()) {
                    unmatched.add(diag(sid, friendlyName, waStatus, "friendly_name does not match complaints_{action}_{toState}_message convention"));
                    continue;
                }
                String action = m.group(1).toUpperCase(Locale.ROOT);
                String toState = m.group(2).toUpperCase(Locale.ROOT);
                String locale = m.group(3) != null ? "hi_IN" : "en_IN";
                String key = action + "." + toState;
                List<String> variables = VARIABLE_ORDER.get(key);
                if (variables == null) {
                    unmatched.add(diag(sid, friendlyName, waStatus, "no known variable order for routing key " + key));
                    continue;
                }
                if (!"approved".equalsIgnoreCase(waStatus)) {
                    unmatched.add(diag(sid, friendlyName, waStatus, "WhatsApp approval status is not 'approved'"));
                    continue;
                }
                Map<String, Object> row = new LinkedHashMap<>();
                row.put("provider", "twilio");
                row.put("channel", "WHATSAPP");
                row.put("audience", "CITIZEN");   // only CITIZEN templates exist upstream
                row.put("action", action);
                row.put("toState", toState);
                row.put("locale", locale);
                row.put("templateId", sid);
                row.put("templateName", friendlyName);
                row.put("variables", variables);
                row.put("approvalStatus", "approved");
                row.put("active", true);
                matched.add(row);
            }
            url = nextPageUrl(page);
        }
        log.info("Twilio template sync: {} matched (approved+known), {} unmatched/skipped", matched.size(), unmatched.size());

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("matched", matched);
        out.put("unmatched", unmatched);
        out.put("total", matched.size() + unmatched.size());
        return out;
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
            Map<String, Object> arm = (Map<String, Object>) ar;
            // Newer shape: {status, allowed_category, ...}; the whatsapp status lives here.
            Object status = arm.get("status");
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

    private static Map<String, Object> diag(String sid, String friendlyName, String status, String reason) {
        Map<String, Object> d = new LinkedHashMap<>();
        d.put("templateId", sid);
        d.put("templateName", friendlyName);
        d.put("approvalStatus", status);
        d.put("skipReason", reason);
        return d;
    }

    private static String str(Object o) {
        return o == null ? null : o.toString();
    }
}
