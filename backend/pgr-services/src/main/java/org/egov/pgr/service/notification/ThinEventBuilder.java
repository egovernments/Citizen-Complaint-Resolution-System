package org.egov.pgr.service.notification;

import org.egov.common.contract.request.RequestInfo;
import org.egov.pgr.web.models.ServiceRequest;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

import static org.egov.pgr.util.PGRConstants.AUDIENCE_CITIZEN;
import static org.egov.pgr.util.PGRConstants.COMMON_MODULE;
import static org.egov.pgr.util.PGRConstants.AUDIENCE_EMPLOYEE;
import static org.egov.pgr.util.PGRConstants.DATE_PATTERN;
import static org.egov.pgr.util.PGRConstants.EVENT_NAME_PREFIX;
import static org.egov.pgr.util.PGRConstants.NOTIFICATION_LOCALE;
import static org.egov.pgr.util.PGRConstants.PGR_MODULE;

/**
 * Builds the ONE thin domain event pgr-services publishes per workflow transition.
 *
 * <p>Pure assembly: every value it needs has already been fetched by {@code NotificationService}.
 * It names no audience, expands no role pool, looks up no localization message, picks no template
 * and mints no envelope — novu-bridge owns all of that. What travels is <i>this happened to this
 * entity, here are the people it is about, here are the words that plug into whatever template you
 * choose</i>.
 *
 * <p><b>The split between {@code data} and {@code localized} is the whole design in miniature.</b>
 * The producer sends the literal it already holds and the localization CODES only it can construct;
 * the bridge does the lookup, once per event, because the producer builds placeholders once per
 * event while the bridge renders once per locale. Three consequences are load-bearing for parity
 * with the pre-rendered path and each is called out at the line that causes it:
 *
 * <ul>
 *   <li>a token the producer cannot fill is <b>absent</b> from {@code data}, never blank, so the
 *       renderer leaves its braces literal — an empty variable is what a provider rejects
 *       (Twilio 21656);</li>
 *   <li>{@code ulb}, {@code ao_designation}, {@code emp_department} and {@code emp_designation}
 *       carry codes and NO literal, because today they exist only if localization resolves them,
 *       which is why a localization outage leaves exactly those four as literal braces;</li>
 *   <li>{@code download_link} is the one token blanked rather than omitted, because a shortener
 *       outage must not ship a message containing the text <code>{download_link}</code>.</li>
 * </ul>
 *
 * <p><b>The wire form is the published contract</b>
 * {@code docs/2.12/notifications/contract/thin-event-v1.schema.json} (examples under
 * {@code examples/thin/}), and it is pinned from the test side by
 * {@code src/test/resources/golden/golden-thin-events.json}. Null values are OMITTED rather than
 * written as {@code null}: the bridge binds the event to its {@code ThinEvent} POJO, where an
 * absent field and a null field are the same thing, and omitting keeps contact PII that PGR does
 * not hold off the broker entirely.
 *
 * @see ResolvedAssignee for why the assignee is sometimes uuid-only and sometimes inline
 */
@Component
public class ThinEventBuilder {

    /** The discriminator novu-bridge reads off the raw map before binding. */
    public static final String KIND_THIN = "THIN";

    public static final String EVENT_TYPE = "COMPLAINTS_WORKFLOW_TRANSITIONED";
    public static final String MODULE = "Complaints";
    public static final String PRODUCER = "complaints-service";
    public static final String ENTITY_TYPE = "COMPLAINT";
    public static final String SCHEMA_VERSION = "1";

    /** Searched in this order by the bridge when it resolves a {@code localized} code. */
    public static final List<String> LOCALIZATION_MODULES = List.of(PGR_MODULE, COMMON_MODULE);

    /**
     * Assembles the event.
     *
     * @param request     the transition as it arrived on save-pgr-request / update-pgr-request
     * @param assignee    who the complaint is with, or null when nobody is
     * @param downloadLink the shortened app link, or {@code ""} when the shortener was unavailable
     * @param department  the MDMS {@code ComplaintHierarchy} department, ONLY when HRMS confirms the
     *                    assignee actually holds an assignment in it; null otherwise
     * @param designation that assignment's designation; null when there is none
     */
    public Map<String, Object> build(ServiceRequest request, ResolvedAssignee assignee, String downloadLink,
                                     String department, String designation) {
        org.egov.pgr.web.models.Service service = request.getService();
        String action = request.getWorkflow() == null ? null : request.getWorkflow().getAction();
        String toState = service.getApplicationStatus();
        String serviceRequestId = service.getServiceRequestId();

        Map<String, Object> event = new LinkedHashMap<>();
        event.put("kind", KIND_THIN);
        event.put("schemaVersion", SCHEMA_VERSION);
        event.put("eventId", UUID.randomUUID().toString());
        event.put("eventType", EVENT_TYPE);
        event.put("eventTime", Instant.now().toString());
        event.put("producer", PRODUCER);
        event.put("module", MODULE);
        // The CONFIG key carries the target state: RATE to CLOSEDAFTERRESOLUTION needs different
        // words from RATE to CLOSEDAFTERREJECTION, and the old (action, toState) pair could express
        // that while the old eventName could not.
        put(event, "eventName", EVENT_NAME_PREFIX + upper(action) + "." + upper(toState));
        // The LEDGER label stays what pgr-services has been writing for releases, so saved filters
        // and dashboards survive the cutover release. Drop it and every nb_dispatch_log row's
        // event_name changes shape.
        put(event, "ledgerEventName", EVENT_NAME_PREFIX + upper(action));
        event.put("entityType", ENTITY_TYPE);
        put(event, "entityId", serviceRequestId);
        put(event, "tenantId", service.getTenantId());
        // Chosen so the bridge's transactionId (<seed>:<subscriberId>:<channel>) comes out
        // byte-identical to the pre-rendered path's. RAW action/toState, NOT uppercased: the old
        // transactionId interpolated them verbatim, and a redeploy mid-flight must not double-send.
        event.put("transactionSeed", String.join(":", serviceRequestId, action, toState));
        event.put("actors", actors(service, assignee));
        event.put("data", data(request, assignee, downloadLink));
        event.put("localized", localized(service, assignee, department, designation));
        event.put("localizationModules", LOCALIZATION_MODULES);
        // Design errata 3: placeholder localization is driven by RequestInfo.msgId and computed ONCE
        // per event, not per recipient. In a two-locale fan-out both recipients share one set of
        // substituted values; reproducing that is what makes the cutover a move, not a change.
        event.put("localizationLocale", localeFromMsgId(request.getRequestInfo()));
        event.put("payload", payload(service, action, toState));
        return event;
    }

    // ---- actors ----------------------------------------------------------------------------

    private Map<String, Object> actors(org.egov.pgr.web.models.Service service, ResolvedAssignee assignee) {
        Map<String, Object> actors = new LinkedHashMap<>();
        org.egov.pgr.web.models.User citizen = service.getCitizen();
        if (citizen != null) {
            // The citizen is sent INLINE, with contact and all. Two reasons, both PGR knowledge: the
            // uuid falls back to the complaint's accountId when the embedded citizen has none, and
            // the contact on the complaint is the contact the citizen filed with — hydrating from
            // egov-user would silently substitute a different record.
            Map<String, Object> ref = new LinkedHashMap<>();
            put(ref, "userId", StringUtils.hasText(citizen.getUuid()) ? citizen.getUuid() : service.getAccountId());
            ref.put("type", AUDIENCE_CITIZEN);
            put(ref, "name", citizen.getName());
            put(ref, "phone", withCountryCode(citizen.getMobileNumber(), citizen.getCountryCode()));
            put(ref, "email", citizen.getEmailId());
            actors.put("citizen", ref);
        }
        if (assignee != null) {
            Map<String, Object> ref = new LinkedHashMap<>();
            put(ref, "userId", assignee.getUserId());
            ref.put("type", AUDIENCE_EMPLOYEE);
            // uuid-only on the normal path: the bridge hydrates, and no employee phone number
            // reaches Kafka. Inline ONLY when PGR's own egov-user lookup failed and the workflow
            // record is the only contact anyone has.
            if (assignee.isInline()) {
                put(ref, "name", assignee.getName());
                put(ref, "phone", assignee.getPhone());
            }
            actors.put("assignee", ref);
        }
        return actors;
    }

    // ---- placeholder values ----------------------------------------------------------------

    /**
     * The literals. Note what is and is not here: {@link #put} skips a null, so a token the producer
     * cannot fill is ABSENT rather than empty and the renderer leaves its braces literal. That
     * distinction is not cosmetic — an empty variable is what a provider rejects.
     */
    private Map<String, Object> data(ServiceRequest request, ResolvedAssignee assignee, String downloadLink) {
        org.egov.pgr.web.models.Service service = request.getService();
        Map<String, Object> data = new LinkedHashMap<>();
        put(data, "id", service.getServiceRequestId());
        put(data, "date", formatCreatedDate(service));
        // The RAW service code and the RAW status. Both are enriched by a localization code below;
        // both survive a localization outage precisely because they are also literals here.
        put(data, "complaint_type", service.getServiceCode());
        put(data, "status", service.getApplicationStatus());
        if (request.getWorkflow() != null) {
            put(data, "additional_comments", request.getWorkflow().getComments());
        }
        if (service.getRating() != null) {
            put(data, "rating", service.getRating().toString());
        }
        if (service.getCitizen() != null) {
            put(data, "citizen_name", service.getCitizen().getName());
        }
        // The ONE token blanked rather than omitted on failure: a shortener outage must not ship a
        // message containing the literal text {download_link}.
        data.put("download_link", downloadLink == null ? "" : downloadLink);
        if (assignee != null) {
            put(data, "emp_name", assignee.getName());
        }
        return data;
    }

    /**
     * The localization CODES. Four tokens appear here with no literal in {@code data}, and that
     * asymmetry is exactly today's behaviour: {@code ulb}, {@code ao_designation},
     * {@code emp_department} and {@code emp_designation} exist only if localization resolves them.
     * It is why a localization outage leaves those four as literal braces while
     * {@code complaint_type} and {@code status} fall back to their raw values.
     */
    private Map<String, Object> localized(org.egov.pgr.web.models.Service service, ResolvedAssignee assignee,
                                          String department, String designation) {
        Map<String, Object> localized = new LinkedHashMap<>();
        String serviceCode = service.getServiceCode();
        if (StringUtils.hasText(serviceCode)) {
            // The current namespace first, then the pre-hierarchy one. Which ladder applies is PGR
            // knowledge; walking it is not.
            localized.put("complaint_type",
                    List.of("COMPLAINT_HIERARCHY." + serviceCode, "pgr.complaint.category." + serviceCode));
        }
        String status = service.getApplicationStatus();
        if (StringUtils.hasText(status)) {
            localized.put("status", List.of("CS_COMMON_" + status));
        }
        if (service.getAddress() != null && StringUtils.hasText(service.getAddress().getDistrict())) {
            localized.put("ulb", List.of(service.getAddress().getDistrict()));
        }
        localized.put("ao_designation", List.of("COMMON_MASTERS_DESIGNATION_AO"));
        // {emp_department} and {emp_designation} come from HRMS crossed with the MDMS
        // ComplaintHierarchy — a join only the producer can do, whose RESULT is a pair of codes.
        if (assignee != null && StringUtils.hasText(department)) {
            localized.put("emp_department", List.of("COMMON_MASTERS_DEPARTMENT_" + department));
            if (StringUtils.hasText(designation)) {
                localized.put("emp_designation", List.of("COMMON_MASTERS_DESIGNATION_" + designation));
            }
        }
        return localized;
    }

    /** The ledger's own vocabulary, echoed onto every envelope the bridge mints from this event. */
    private Map<String, Object> payload(org.egov.pgr.web.models.Service service, String action, String toState) {
        Map<String, Object> payload = new LinkedHashMap<>();
        put(payload, "complaintNo", service.getServiceRequestId());
        put(payload, "status", service.getApplicationStatus());
        put(payload, "action", action);
        put(payload, "toState", toState);
        return payload;
    }

    // ---- helpers ---------------------------------------------------------------------------

    /** {@code RequestInfo.msgId} is {@code <ts>|<locale>}; absent, the deployment default. */
    static String localeFromMsgId(RequestInfo requestInfo) {
        String msgId = requestInfo == null ? null : requestInfo.getMsgId();
        if (!StringUtils.hasText(msgId)) {
            return NOTIFICATION_LOCALE;
        }
        String[] parts = msgId.split("\\|");
        return parts.length >= 2 && StringUtils.hasText(parts[1]) ? parts[1] : NOTIFICATION_LOCALE;
    }

    private static String formatCreatedDate(org.egov.pgr.web.models.Service service) {
        if (service.getAuditDetails() == null || service.getAuditDetails().getCreatedTime() == null) return null;
        Long t = service.getAuditDetails().getCreatedTime();
        LocalDate date = Instant.ofEpochMilli(t > 1_000_000_000_000L ? t : t * 1000)
                .atZone(ZoneId.systemDefault()).toLocalDate();
        return date.format(DateTimeFormatter.ofPattern(DATE_PATTERN));
    }

    /** A number already in E.164 is not prefixed a second time. */
    static String withCountryCode(String mobileNumber, String countryCode) {
        if (mobileNumber == null) return null;
        if (mobileNumber.startsWith("+")) return mobileNumber;
        if (StringUtils.hasText(countryCode)) return countryCode + mobileNumber;
        return mobileNumber;
    }

    private static void put(Map<String, Object> map, String key, String value) {
        if (value != null) map.put(key, value);
    }

    private static String upper(String value) {
        return value == null ? null : value.toUpperCase(Locale.ROOT);
    }
}
