package org.egov.novubridge.service.resolution.golden;

import com.fasterxml.jackson.databind.JsonNode;
import org.egov.novubridge.web.models.ActorRef;
import org.egov.novubridge.web.models.ThinEvent;

import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Builds, for one golden scenario, the thin event <b>pgr-services will emit after task T8</b>.
 *
 * <p>This class is the executable specification of the producer half of the cutover. Every line
 * of it corresponds to something {@code NotificationService} does today and will keep doing:
 * building the thirteen placeholder values, resolving the assignee through workflow history,
 * reading the department and designation out of HRMS and MDMS. What it does NOT do is anything
 * the box now owns — it names no audience, expands no role pool, looks up no localization
 * message, picks no template and mints no envelope.
 *
 * <p><b>The split between {@code data} and {@code localized} is the whole design in miniature.</b>
 * The producer sends the literal it already holds and the localization CODES it alone can
 * construct; the box does the lookup, once per event, because the producer builds placeholders
 * once per event while the box renders once per locale. Three consequences are load-bearing for
 * parity and each is called out at the line that causes it:
 *
 * <ul>
 *   <li>a token the producer cannot fill is <b>absent</b> from {@code data}, never blank, so the
 *       renderer leaves its braces literal;</li>
 *   <li>{@code ulb}, {@code ao_designation}, {@code emp_department} and {@code emp_designation}
 *       have codes and NO literal, because today they exist only if localization resolves them —
 *       which is why a localization outage leaves exactly those four as literal braces;</li>
 *   <li>{@code download_link} is the one token the producer blanks rather than omits, because a
 *       URL shortener outage must not ship a message containing the text
 *       {@code {download_link}}.</li>
 * </ul>
 */
final class ScenarioThinEventBuilder {

    private static final String EVENT_TYPE = "COMPLAINTS_WORKFLOW_TRANSITIONED";
    private static final String MODULE = "Complaints";
    private static final String PRODUCER = "complaints-service";
    private static final String ENTITY_TYPE = "COMPLAINT";
    private static final String EVENT_PREFIX = "COMPLAINTS.WORKFLOW.";
    private static final String DEFAULT_LOCALE = "en_IN";
    private static final DateTimeFormatter DATE = DateTimeFormatter.ofPattern("dd/MM/yyyy");

    /** Forced UTC, as {@code MainConfiguration.initialize()} does in production (app.timezone=UTC). */
    private static final ZoneId ZONE = ZoneId.of("UTC");

    private ScenarioThinEventBuilder() {
    }

    static ThinEvent build(JsonNode request, ScenarioWorld world) {
        JsonNode service = request.path("service");
        JsonNode workflow = request.path("workflow");
        String action = workflow.path("action").asText(null);
        String toState = service.path("applicationStatus").asText(null);
        String serviceRequestId = service.path("serviceRequestId").asText(null);

        Assignee assignee = resolveAssignee(workflow, service, world);

        return ThinEvent.builder()
                .kind(ThinEvent.KIND)
                .schemaVersion("1")
                .eventId("golden-" + serviceRequestId + "-" + action + "-" + toState)
                .eventType(EVENT_TYPE)
                .eventTime("2026-09-21T00:00:00Z")
                .producer(PRODUCER)
                .module(MODULE)
                // The CONFIG key carries the target state: RATE to CLOSEDAFTERRESOLUTION needs
                // different words from RATE to CLOSEDAFTERREJECTION, and the old
                // (action, toState) pair could express that while the old eventName could not.
                .eventName(EVENT_PREFIX + upper(action) + "." + upper(toState))
                // The LEDGER label stays what pgr-services has been writing for releases, so
                // saved filters and dashboards survive the cutover release.
                .ledgerEventName(EVENT_PREFIX + upper(action))
                .entityType(ENTITY_TYPE)
                .entityId(serviceRequestId)
                .tenantId(service.path("tenantId").asText(null))
                // Chosen so transactionId comes out byte-identical to the pre-rendered path, which
                // is what stops a mid-flight redeploy double-sending.
                .transactionSeed(String.join(":", serviceRequestId, action, toState))
                .actors(actors(service, assignee))
                .data(data(service, workflow, world, assignee))
                .localized(localized(service, world, assignee))
                .localizationModules(List.of("rainmaker-pgr", "rainmaker-common"))
                // Errata 3: placeholder localization is driven by RequestInfo.msgId's locale and
                // computed ONCE per event, not per recipient.
                .localizationLocale(localeFromMsgId(request.path("RequestInfo").path("msgId").asText(null)))
                .payload(payload(service, action, toState))
                .build();
    }

    // ---- actors ------------------------------------------------------------

    private static Map<String, ActorRef> actors(JsonNode service, Assignee assignee) {
        Map<String, ActorRef> actors = new LinkedHashMap<>();
        JsonNode citizen = service.path("citizen");
        if (citizen.isObject()) {
            // The citizen is sent INLINE, with contact and all. Two reasons, both PGR knowledge:
            // the uuid falls back to the complaint's accountId when the embedded citizen has
            // none, and the contact on the complaint is the contact the citizen filed with —
            // hydrating from egov-user would silently substitute a different record.
            String uuid = text(citizen, "uuid");
            actors.put("citizen", ActorRef.builder()
                    .userId(hasText(uuid) ? uuid : text(service, "accountId"))
                    .type("CITIZEN")
                    .name(text(citizen, "name"))
                    .phone(withCountryCode(text(citizen, "mobileNumber"), text(citizen, "countryCode")))
                    .email(text(citizen, "emailId"))
                    .build());
        }
        if (assignee != null) {
            actors.put("assignee", assignee.ref);
        }
        return actors;
    }

    /**
     * Who the complaint is with, by the producer's own rule — the live workflow assignee, else the
     * last {@code ASSIGN} in workflow history. Walking that history is PGR knowledge and stays in
     * PGR; the box is simply told the answer.
     *
     * <p>When the producer holds only a uuid it sends only the uuid and the box hydrates, which is
     * what keeps the assignee's phone and email off the broker. When its own lookup failed it
     * sends the workflow's user record inline, because that is then the only contact anyone has.
     */
    private static Assignee resolveAssignee(JsonNode workflow, JsonNode service, ScenarioWorld world) {
        JsonNode assignes = workflow.path("assignes");
        if (assignes.isArray() && assignes.size() > 0 && hasText(assignes.get(0).asText(null))) {
            String uuid = assignes.get(0).asText();
            JsonNode user = world.usersByUuid().path(uuid);
            if (user.isObject()) {
                return new Assignee(ActorRef.builder().userId(uuid).type("EMPLOYEE").build(),
                        text(user, "name"));
            }
        }
        for (JsonNode instance : world.workflowHistory().path("ProcessInstances")) {
            if (!"ASSIGN".equalsIgnoreCase(instance.path("action").asText(""))) {
                continue;
            }
            JsonNode historyAssignes = instance.path("assignes");
            if (!historyAssignes.isArray() || historyAssignes.isEmpty()) {
                continue;
            }
            JsonNode workflowUser = historyAssignes.get(0);
            String uuid = text(workflowUser, "uuid");
            JsonNode user = world.usersByUuid().path(uuid);
            if (hasText(uuid) && user.isObject()) {
                return new Assignee(ActorRef.builder().userId(uuid).type("EMPLOYEE").build(),
                        text(user, "name"));
            }
            // The lookup failed: send what the workflow record holds, inline, uuid and all.
            return new Assignee(ActorRef.builder()
                    .userId(uuid)
                    .type("EMPLOYEE")
                    .name(text(workflowUser, "name"))
                    .phone(text(workflowUser, "mobileNumber"))
                    .build(), text(workflowUser, "name"));
        }
        return null;
    }

    private static final class Assignee {
        final ActorRef ref;
        final String name;

        Assignee(ActorRef ref, String name) {
            this.ref = ref;
            this.name = name;
        }
    }

    // ---- placeholder values -------------------------------------------------

    /**
     * The literals. Note what is and is not here: {@code put} skips a null, so a token the
     * producer cannot fill is ABSENT rather than empty, and the renderer leaves its braces
     * literal. That distinction is not cosmetic — an empty variable is what a provider rejects.
     */
    private static Map<String, Object> data(JsonNode service, JsonNode workflow, ScenarioWorld world,
                                            Assignee assignee) {
        Map<String, Object> data = new LinkedHashMap<>();
        put(data, "id", text(service, "serviceRequestId"));
        put(data, "date", formatCreatedDate(service));
        // The RAW service code and the RAW status. Both are enriched by a localization code
        // below; both survive a localization outage precisely because they are also literals.
        put(data, "complaint_type", text(service, "serviceCode"));
        put(data, "status", text(service, "applicationStatus"));
        put(data, "additional_comments", text(workflow, "comments"));
        JsonNode rating = service.path("rating");
        if (!rating.isMissingNode() && !rating.isNull()) {
            put(data, "rating", rating.asText());
        }
        JsonNode citizen = service.path("citizen");
        if (citizen.isObject()) {
            put(data, "citizen_name", text(citizen, "name"));
        }
        // The ONE token that is blanked rather than omitted on failure: a shortener outage must
        // not ship a message containing the literal text {download_link}.
        String shortUrl = world.shortUrl();
        data.put("download_link", shortUrl == null ? "" : shortUrl);
        if (assignee != null) {
            put(data, "emp_name", assignee.name);
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
    private static Map<String, Object> localized(JsonNode service, ScenarioWorld world, Assignee assignee) {
        Map<String, Object> localized = new LinkedHashMap<>();
        String serviceCode = text(service, "serviceCode");
        if (hasText(serviceCode)) {
            // The current namespace first, then the pre-hierarchy one. Which ladder applies is
            // PGR knowledge; walking it is not.
            localized.put("complaint_type",
                    List.of("COMPLAINT_HIERARCHY." + serviceCode, "pgr.complaint.category." + serviceCode));
        }
        String status = text(service, "applicationStatus");
        if (hasText(status)) {
            localized.put("status", List.of("CS_COMMON_" + status));
        }
        String district = text(service.path("address"), "district");
        if (hasText(district)) {
            localized.put("ulb", List.of(district));
        }
        localized.put("ao_designation", List.of("COMMON_MASTERS_DESIGNATION_AO"));

        // {emp_department} and {emp_designation} come from HRMS crossed with the MDMS
        // ComplaintHierarchy — a join only the producer can do, whose RESULT is a pair of
        // localization codes.
        String department = mdmsDepartment(service, world);
        if (assignee != null && hasText(department)) {
            JsonNode employees = world.hrms().path("Employees");
            for (JsonNode employee : employees) {
                for (JsonNode assignment : employee.path("assignments")) {
                    if (!department.equals(text(assignment, "department"))) {
                        continue;
                    }
                    localized.put("emp_department", List.of("COMMON_MASTERS_DEPARTMENT_" + department));
                    String designation = text(assignment, "designation");
                    if (hasText(designation)) {
                        localized.put("emp_designation", List.of("COMMON_MASTERS_DESIGNATION_" + designation));
                    }
                    return localized;
                }
            }
        }
        return localized;
    }

    private static String mdmsDepartment(JsonNode service, ScenarioWorld world) {
        String serviceCode = text(service, "serviceCode");
        for (JsonNode row : world.mdms().path("MdmsRes").path("RAINMAKER-PGR").path("ComplaintHierarchy")) {
            if (serviceCode != null && serviceCode.equals(text(row, "code"))) {
                return text(row, "department");
            }
        }
        return null;
    }

    /** The ledger's own vocabulary, echoed onto every envelope's {@code data} block. */
    private static Map<String, Object> payload(JsonNode service, String action, String toState) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("complaintNo", text(service, "serviceRequestId"));
        payload.put("status", text(service, "applicationStatus"));
        payload.put("action", action);
        payload.put("toState", toState);
        return payload;
    }

    // ---- helpers -----------------------------------------------------------

    /** {@code RequestInfo.msgId} is {@code <ts>|<locale>}; absent, the deployment default. */
    private static String localeFromMsgId(String msgId) {
        if (msgId == null) {
            return DEFAULT_LOCALE;
        }
        String[] parts = msgId.split("\\|");
        return parts.length >= 2 && hasText(parts[1]) ? parts[1] : DEFAULT_LOCALE;
    }

    private static String formatCreatedDate(JsonNode service) {
        JsonNode created = service.path("auditDetails").path("createdTime");
        if (created.isMissingNode() || created.isNull()) {
            return null;
        }
        long millis = created.asLong();
        return Instant.ofEpochMilli(millis > 1_000_000_000_000L ? millis : millis * 1000)
                .atZone(ZONE).toLocalDate().format(DATE);
    }

    private static String withCountryCode(String mobileNumber, String countryCode) {
        if (!hasText(mobileNumber)) {
            return null;
        }
        if (mobileNumber.startsWith("+")) {
            return mobileNumber;
        }
        return hasText(countryCode) ? countryCode + mobileNumber : mobileNumber;
    }

    private static void put(Map<String, Object> map, String key, String value) {
        if (value != null) {
            map.put(key, value);
        }
    }

    private static String text(JsonNode node, String field) {
        JsonNode value = node.path(field);
        return value.isMissingNode() || value.isNull() ? null : value.asText();
    }

    private static boolean hasText(String value) {
        return value != null && !value.trim().isEmpty();
    }

    private static String upper(String value) {
        return value == null ? null : value.toUpperCase(java.util.Locale.ROOT);
    }
}
