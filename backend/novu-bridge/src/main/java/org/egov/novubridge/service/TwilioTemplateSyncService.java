package org.egov.novubridge.service;

import lombok.extern.slf4j.Slf4j;
import org.egov.tracer.model.CustomException;
import org.springframework.http.*;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import org.springframework.web.client.RestTemplate;

import java.nio.charset.StandardCharsets;
import java.util.*;

/**
 * §4 of the 2026-07-06 provider-template-mapping design: pull the linked Twilio
 * account's <b>approved WhatsApp Content templates</b> from
 * {@code content.twilio.com/v1/ContentAndApprovals}, auto-match each
 * {@code complaints_…_message[_new]} friendly-name to a PGR routing key, and return
 * proposed {@code RAINMAKER-PGR.NotificationProviderTemplate} rows (ContentSid +
 * ordered variables) for the configurator to persist.
 *
 * <p><b>Matching is token-based, not a single brittle regex.</b> A friendly_name is
 * split on {@code _} and each token classified:
 * <ul>
 *   <li>{@code complaints} / {@code message} / {@code new} — convention markers.</li>
 *   <li>{@code citizen} / {@code employee} — <b>audience</b> (derived, not hardcoded).</li>
 *   <li>{@code english}/{@code en} / {@code hindi}/{@code hi} — <b>locale</b>. If absent,
 *       the Twilio content {@code language} is used, else {@code en_IN}.</li>
 *   <li>{@code sms} and any state token (e.g. {@code pendingatlme}) — ignored; the
 *       <b>toState</b> and <b>variables</b> are canonical <i>per action</i> (derived from
 *       the seed {@code RAINMAKER-PGR.NotificationProviderTemplate.json}), because names
 *       like {@code …reassign_pendingatlme…} route to {@code PENDINGFORREASSIGNMENT} and
 *       {@code complaints_rate_english_…} routes to {@code CLOSEDAFTERRESOLUTION}.</li>
 *   <li>an {@link #ACTION_ROUTING} key — the <b>action</b>.</li>
 * </ul>
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

    /**
     * Canonical routing per PGR action, derived verbatim from the seed
     * {@code RAINMAKER-PGR.NotificationProviderTemplate.json}. The action token in the
     * Twilio friendly_name selects the entry; {@code toState} and {@code variables} come
     * from here (never parsed from the name) so that e.g. {@code reassign} → the routing
     * key {@code REASSIGN.PENDINGFORREASSIGNMENT} regardless of the name's state token.
     */
    private static final Map<String, Routing> ACTION_ROUTING;
    static {
        Map<String, Routing> m = new LinkedHashMap<>();
        m.put("APPLY",    new Routing("PENDINGFORASSIGNMENT",     List.of("complaint_type", "id", "date")));
        m.put("ASSIGN",   new Routing("PENDINGATLME",            List.of("complaint_type", "id", "date", "emp_name", "emp_designation", "emp_department")));
        m.put("RESOLVE",  new Routing("RESOLVED",                List.of("complaint_type", "id", "date", "emp_name")));
        m.put("REJECT",   new Routing("REJECTED",                List.of("complaint_type", "id", "date", "additional_comments")));
        m.put("REOPEN",   new Routing("PENDINGFORASSIGNMENT",     List.of("complaint_type", "id", "date")));
        m.put("REASSIGN", new Routing("PENDINGFORREASSIGNMENT",   List.of("complaint_type", "id", "date", "emp_name", "emp_designation", "emp_department")));
        m.put("RATE",     new Routing("CLOSEDAFTERRESOLUTION",    List.of("complaint_type", "id", "date")));
        ACTION_ROUTING = Collections.unmodifiableMap(m);
    }

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
     *
     * <p>Proposals are de-duplicated on {@code (audience, action, toState, locale)},
     * preferring the {@code _message_new} variant over a plain {@code _message} one.
     */
    @SuppressWarnings("unchecked")
    public Map<String, Object> syncWhatsappTemplates() {
        String[] creds = twilioCredentials();
        String accountSid = creds[0], authToken = creds[1];

        // Dedup on (audience, action, toState, locale); prefer the _new variant.
        Map<String, Map<String, Object>> dedup = new LinkedHashMap<>();
        Map<String, Boolean> dedupIsNew = new HashMap<>();
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
                String language = str(c.get("language"));
                String waStatus = whatsappApprovalStatus(c);

                Parsed p = parse(friendlyName, language);
                if (p == null) {
                    unmatched.add(diag(sid, friendlyName, waStatus,
                            "friendly_name does not match complaints_…_message[_new] convention"));
                    continue;
                }
                if (p.action == null) {
                    unmatched.add(diag(sid, friendlyName, waStatus,
                            "no known PGR routing key for this template (unknown action token)"));
                    continue;
                }
                if (!"approved".equalsIgnoreCase(waStatus)) {
                    unmatched.add(diag(sid, friendlyName, waStatus,
                            "WhatsApp approval status is not 'approved'"));
                    continue;
                }

                Routing r = ACTION_ROUTING.get(p.action);
                Map<String, Object> row = new LinkedHashMap<>();
                row.put("provider", "twilio");
                row.put("channel", "WHATSAPP");
                row.put("audience", p.audience);
                row.put("action", p.action);
                row.put("toState", r.toState);
                row.put("locale", p.locale);
                row.put("templateId", sid);
                row.put("templateName", friendlyName);
                row.put("variables", r.variables);
                row.put("approvalStatus", "approved");
                row.put("active", true);

                String dk = p.audience + "|" + p.action + "|" + r.toState + "|" + p.locale;
                Boolean existingNew = dedupIsNew.get(dk);
                if (existingNew == null || (p.isNew && !existingNew)) {
                    // First seen, or this is a _new variant superseding a plain _message one.
                    dedup.put(dk, row);
                    dedupIsNew.put(dk, p.isNew);
                }
                // else: keep the existing (already-preferred) proposal and drop this duplicate.
            }
            url = nextPageUrl(page);
        }

        List<Map<String, Object>> matched = new ArrayList<>(dedup.values());
        log.info("Twilio template sync: {} matched (approved+known, deduped), {} unmatched/skipped",
                matched.size(), unmatched.size());

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("matched", matched);
        out.put("unmatched", unmatched);
        out.put("total", matched.size() + unmatched.size());
        return out;
    }

    /**
     * Token-classify a friendly_name into (audience, action, locale, isNew). Returns
     * {@code null} when the name is not a PGR complaint template at all (missing
     * {@code complaints}/{@code message} markers). A returned {@link Parsed} with a
     * {@code null action} means "looks like a template but the action is unknown".
     */
    Parsed parse(String friendlyName, String contentLanguage) {
        if (!StringUtils.hasText(friendlyName)) return null;
        String[] tokens = friendlyName.toLowerCase(Locale.ROOT).split("_");
        Set<String> tokenSet = new HashSet<>(Arrays.asList(tokens));

        // Convention markers required to treat this as a PGR notification template.
        if (!tokenSet.contains("complaints") || !tokenSet.contains("message")) return null;

        String audience = tokenSet.contains("employee") ? "EMPLOYEE" : "CITIZEN";

        String locale;
        if (tokenSet.contains("hindi") || tokenSet.contains("hi")) locale = "hi_IN";
        else if (tokenSet.contains("english") || tokenSet.contains("en")) locale = "en_IN";
        else locale = localeFromLanguage(contentLanguage);

        boolean isNew = tokenSet.contains("new");

        String action = null;
        for (String t : tokens) {
            String upper = t.toUpperCase(Locale.ROOT);
            if (ACTION_ROUTING.containsKey(upper)) { action = upper; break; }
        }
        return new Parsed(audience, action, locale, isNew);
    }

    /** Map a Twilio content {@code language} to a PGR locale; defaults to {@code en_IN}. */
    private static String localeFromLanguage(String language) {
        if (!StringUtils.hasText(language)) return "en_IN";
        return language.toLowerCase(Locale.ROOT).startsWith("hi") ? "hi_IN" : "en_IN";
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

    /** Canonical toState + ordered variables for a PGR action (from the seed file). */
    static final class Routing {
        final String toState;
        final List<String> variables;
        Routing(String toState, List<String> variables) {
            this.toState = toState;
            this.variables = variables;
        }
    }

    /** Result of classifying a friendly_name. {@code action == null} ⇒ unknown action. */
    static final class Parsed {
        final String audience;
        final String action;   // null when no known action token is present
        final String locale;
        final boolean isNew;
        Parsed(String audience, String action, String locale, boolean isNew) {
            this.audience = audience;
            this.action = action;
            this.locale = locale;
            this.isNew = isNew;
        }
    }
}
