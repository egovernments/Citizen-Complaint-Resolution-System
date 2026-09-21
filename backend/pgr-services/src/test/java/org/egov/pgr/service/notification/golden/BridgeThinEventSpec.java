package org.egov.pgr.service.notification.golden;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Locale;

/**
 * THE EXECUTABLE SPEC, mirrored. A line-by-line port of novu-bridge's
 * {@code ScenarioThinEventBuilder} — the class the bridge's own {@code ThinEventParityTest} feeds
 * into the resolution stage to prove that the envelopes it mints equal the ones pgr-services used
 * to publish. That class is the definition of "the thin event pgr-services must emit"; this is the
 * same definition, restated where pgr-services' build can reach it.
 *
 * <p><b>Mirrored from</b>
 * {@code backend/novu-bridge/src/test/java/org/egov/novubridge/service/resolution/golden/ScenarioThinEventBuilder.java}
 * at commit {@code 350f4c38} ("feat(novu-bridge): thin events — routing, recipients and rendering
 * move into the box"), blob {@code 4c4eafb1}. Each method below corresponds to the method of the
 * same name there and carries the same decisions; if that file changes, this one has to change with
 * it and {@code golden-thin-events.json} has to be regenerated.
 *
 * <p><b>Why a copy at all.</b> The Docker test runner mounts one module at a time, so a
 * pgr-services test cannot see novu-bridge's test classes — the same reason the golden fixture is
 * copied into the bridge's own resources. What the copy buys is the thing that matters: the
 * committed {@code golden-thin-events.json} is <em>generated</em> from the real
 * {@code NotificationService} and then <em>checked</em> against this independent restatement of the
 * bridge's expectation, so the fixture cannot quietly record whatever the producer happens to do.
 *
 * <p><b>Two deliberate differences from the mirrored class</b>, both about form rather than content:
 *
 * <ul>
 *   <li>it builds the JSON <b>wire form</b> rather than a {@code ThinEvent} POJO, and a null field
 *       is OMITTED rather than written as {@code null} — the bridge binds the wire form to that
 *       POJO, where absent and null are the same thing;</li>
 *   <li>{@code eventId} and {@code eventTime} are the fixture's normalisation placeholders, because
 *       the real producer generates a fresh uuid and reads the wall clock. The mirrored class uses
 *       a deterministic id of its own for the same reason.</li>
 * </ul>
 */
final class BridgeThinEventSpec {

    private static final String EVENT_TYPE = "COMPLAINTS_WORKFLOW_TRANSITIONED";
    private static final String MODULE = "Complaints";
    private static final String PRODUCER = "complaints-service";
    private static final String ENTITY_TYPE = "COMPLAINT";
    private static final String EVENT_PREFIX = "COMPLAINTS.WORKFLOW.";
    private static final String DEFAULT_LOCALE = "en_IN";
    private static final DateTimeFormatter DATE = DateTimeFormatter.ofPattern("dd/MM/yyyy");

    /** Forced UTC, as {@code MainConfiguration.initialize()} does in production (app.timezone=UTC). */
    private static final ZoneId ZONE = ZoneId.of("UTC");

    private BridgeThinEventSpec() {
    }

    /**
     * @param request the scenario's {@code request} block (a PGR {@code ServiceRequest})
     * @param world   the scenario's {@code world} block, already merged over the defaults
     */
    static ObjectNode build(ObjectMapper mapper, JsonNode request, JsonNode world) {
        JsonNode service = request.path("service");
        JsonNode workflow = request.path("workflow");
        String action = text(workflow, "action");
        String toState = text(service, "applicationStatus");
        String serviceRequestId = text(service, "serviceRequestId");

        Assignee assignee = resolveAssignee(workflow, world);

        ObjectNode event = mapper.createObjectNode();
        event.put("kind", "THIN");
        event.put("schemaVersion", "1");
        event.put("eventId", GoldenThinEventFixtureGenerator.UUID_PLACEHOLDER);
        event.put("eventType", EVENT_TYPE);
        event.put("eventTime", GoldenThinEventFixtureGenerator.TIMESTAMP_PLACEHOLDER);
        event.put("producer", PRODUCER);
        event.put("module", MODULE);
        // The CONFIG key carries the target state: RATE to CLOSEDAFTERRESOLUTION needs different
        // words from RATE to CLOSEDAFTERREJECTION, and the old (action, toState) pair could express
        // that while the old eventName could not.
        event.put("eventName", EVENT_PREFIX + upper(action) + "." + upper(toState));
        // The LEDGER label stays what pgr-services has been writing for releases, so saved filters
        // and dashboards survive the cutover release.
        event.put("ledgerEventName", EVENT_PREFIX + upper(action));
        event.put("entityType", ENTITY_TYPE);
        put(event, "entityId", serviceRequestId);
        put(event, "tenantId", text(service, "tenantId"));
        // Chosen so transactionId comes out byte-identical to the pre-rendered path, which is what
        // stops a mid-flight redeploy double-sending.
        event.put("transactionSeed", String.join(":", serviceRequestId, action, toState));
        event.set("actors", actors(mapper, service, assignee));
        event.set("data", data(mapper, service, workflow, world, assignee));
        event.set("localized", localized(mapper, service, world, assignee));
        ArrayNode modules = event.putArray("localizationModules");
        modules.add("rainmaker-pgr");
        modules.add("rainmaker-common");
        // Errata 3: placeholder localization is driven by RequestInfo.msgId's locale and computed
        // ONCE per event, not per recipient.
        event.put("localizationLocale", localeFromMsgId(text(request.path("RequestInfo"), "msgId")));
        event.set("payload", payload(mapper, service, action, toState));
        return event;
    }

    // ---- actors ------------------------------------------------------------

    private static ObjectNode actors(ObjectMapper mapper, JsonNode service, Assignee assignee) {
        ObjectNode actors = mapper.createObjectNode();
        JsonNode citizen = service.path("citizen");
        if (citizen.isObject()) {
            // The citizen is sent INLINE, with contact and all. Two reasons, both PGR knowledge:
            // the uuid falls back to the complaint's accountId when the embedded citizen has none,
            // and the contact on the complaint is the contact the citizen filed with — hydrating
            // from egov-user would silently substitute a different record.
            ObjectNode ref = mapper.createObjectNode();
            String uuid = text(citizen, "uuid");
            put(ref, "userId", hasText(uuid) ? uuid : text(service, "accountId"));
            ref.put("type", "CITIZEN");
            put(ref, "name", text(citizen, "name"));
            put(ref, "phone", withCountryCode(text(citizen, "mobileNumber"), text(citizen, "countryCode")));
            put(ref, "email", text(citizen, "emailId"));
            actors.set("citizen", ref);
        }
        if (assignee != null) {
            ObjectNode ref = mapper.createObjectNode();
            put(ref, "userId", assignee.userId);
            ref.put("type", "EMPLOYEE");
            if (assignee.inline) {
                put(ref, "name", assignee.name);
                put(ref, "phone", assignee.phone);
            }
            actors.set("assignee", ref);
        }
        return actors;
    }

    /**
     * Who the complaint is with, by the producer's own rule — the live workflow assignee, else the
     * last {@code ASSIGN} in workflow history. Walking that history is PGR knowledge and stays in
     * PGR; the box is simply told the answer.
     *
     * <p>When the producer holds only a uuid it sends only the uuid and the box hydrates, which is
     * what keeps the assignee's phone and email off the broker. When its own lookup failed it sends
     * the workflow's user record inline, because that is then the only contact anyone has.
     */
    private static Assignee resolveAssignee(JsonNode workflow, JsonNode world) {
        JsonNode usersByUuid = world.path("usersByUuid");
        JsonNode assignes = workflow.path("assignes");
        if (assignes.isArray() && assignes.size() > 0 && hasText(assignes.get(0).asText(null))) {
            String uuid = assignes.get(0).asText();
            JsonNode user = usersByUuid.path(uuid);
            if (user.isObject()) {
                return new Assignee(uuid, text(user, "name"), null, false);
            }
        }
        for (JsonNode instance : world.path("workflowHistory").path("ProcessInstances")) {
            if (!"ASSIGN".equalsIgnoreCase(instance.path("action").asText(""))) {
                continue;
            }
            JsonNode historyAssignes = instance.path("assignes");
            if (!historyAssignes.isArray() || historyAssignes.isEmpty()) {
                continue;
            }
            JsonNode workflowUser = historyAssignes.get(0);
            String uuid = text(workflowUser, "uuid");
            JsonNode user = usersByUuid.path(uuid);
            if (hasText(uuid) && user.isObject()) {
                return new Assignee(uuid, text(user, "name"), null, false);
            }
            // The lookup failed: send what the workflow record holds, inline, uuid and all.
            return new Assignee(uuid, text(workflowUser, "name"), text(workflowUser, "mobileNumber"), true);
        }
        return null;
    }

    private static final class Assignee {
        final String userId;
        final String name;
        final String phone;
        final boolean inline;

        Assignee(String userId, String name, String phone, boolean inline) {
            this.userId = userId;
            this.name = name;
            this.phone = phone;
            this.inline = inline;
        }
    }

    // ---- placeholder values -------------------------------------------------

    /**
     * The literals. Note what is and is not here: {@code put} skips a null, so a token the producer
     * cannot fill is ABSENT rather than empty, and the renderer leaves its braces literal. That
     * distinction is not cosmetic — an empty variable is what a provider rejects.
     */
    private static ObjectNode data(ObjectMapper mapper, JsonNode service, JsonNode workflow, JsonNode world,
                                   Assignee assignee) {
        ObjectNode data = mapper.createObjectNode();
        put(data, "id", text(service, "serviceRequestId"));
        put(data, "date", formatCreatedDate(service));
        // The RAW service code and the RAW status. Both are enriched by a localization code below;
        // both survive a localization outage precisely because they are also literals.
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
        // The ONE token blanked rather than omitted on failure: a shortener outage must not ship a
        // message containing the literal text {download_link}.
        String shortUrl = shortUrl(world);
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
     */
    private static ObjectNode localized(ObjectMapper mapper, JsonNode service, JsonNode world, Assignee assignee) {
        ObjectNode localized = mapper.createObjectNode();
        String serviceCode = text(service, "serviceCode");
        if (hasText(serviceCode)) {
            // The current namespace first, then the pre-hierarchy one.
            codes(localized, "complaint_type",
                    List.of("COMPLAINT_HIERARCHY." + serviceCode, "pgr.complaint.category." + serviceCode));
        }
        String status = text(service, "applicationStatus");
        if (hasText(status)) {
            codes(localized, "status", List.of("CS_COMMON_" + status));
        }
        String district = text(service.path("address"), "district");
        if (hasText(district)) {
            codes(localized, "ulb", List.of(district));
        }
        codes(localized, "ao_designation", List.of("COMMON_MASTERS_DESIGNATION_AO"));

        // {emp_department} and {emp_designation} come from HRMS crossed with the MDMS
        // ComplaintHierarchy — a join only the producer can do, whose RESULT is a pair of codes.
        String department = mdmsDepartment(service, world);
        if (assignee != null && hasText(department)) {
            for (JsonNode employee : world.path("hrms").path("Employees")) {
                for (JsonNode assignment : employee.path("assignments")) {
                    if (!department.equals(text(assignment, "department"))) {
                        continue;
                    }
                    codes(localized, "emp_department", List.of("COMMON_MASTERS_DEPARTMENT_" + department));
                    String designation = text(assignment, "designation");
                    if (hasText(designation)) {
                        codes(localized, "emp_designation", List.of("COMMON_MASTERS_DESIGNATION_" + designation));
                    }
                    return localized;
                }
            }
        }
        return localized;
    }

    private static String mdmsDepartment(JsonNode service, JsonNode world) {
        String serviceCode = text(service, "serviceCode");
        for (JsonNode row : world.path("mdms").path("MdmsRes").path("RAINMAKER-PGR").path("ComplaintHierarchy")) {
            if (serviceCode != null && serviceCode.equals(text(row, "code"))) {
                return text(row, "department");
            }
        }
        return null;
    }

    /** The ledger's own vocabulary, echoed onto every envelope's {@code data} block. */
    private static ObjectNode payload(ObjectMapper mapper, JsonNode service, String action, String toState) {
        ObjectNode payload = mapper.createObjectNode();
        put(payload, "complaintNo", text(service, "serviceRequestId"));
        put(payload, "status", text(service, "applicationStatus"));
        put(payload, "action", action);
        put(payload, "toState", toState);
        return payload;
    }

    // ---- helpers -----------------------------------------------------------

    /** Mirrors {@code ScenarioWorld.shortUrl()}. */
    private static String shortUrl(JsonNode world) {
        return world.path("shortUrlFails").asBoolean(false) ? "" : world.path("shortUrl").asText(null);
    }

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

    private static void codes(ObjectNode node, String token, List<String> values) {
        ArrayNode array = node.putArray(token);
        values.forEach(array::add);
    }

    private static void put(ObjectNode node, String key, String value) {
        if (value != null) {
            node.put(key, value);
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
        return value == null ? null : value.toUpperCase(Locale.ROOT);
    }
}
