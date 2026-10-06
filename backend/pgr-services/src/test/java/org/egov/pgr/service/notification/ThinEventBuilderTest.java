package org.egov.pgr.service.notification;

import org.egov.common.contract.request.RequestInfo;
import org.egov.pgr.web.models.Address;
import org.egov.pgr.web.models.AuditDetails;
import org.egov.pgr.web.models.Service;
import org.egov.pgr.web.models.ServiceRequest;
import org.egov.pgr.web.models.User;
import org.egov.pgr.web.models.Workflow;
import org.egov.pgr.web.models.workflow.ProcessInstance;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * The thin event pgr-services publishes per workflow transition. What is pinned here keeps the
 * dispatch-log keys and message parity intact across the cutover: the event and ledger names, the
 * idempotency seed, the "absent, not blank" rule, uuid-only versus inline assignees, and the split
 * between literals ({@code data}) and localization codes ({@code localized}).
 */
class ThinEventBuilderTest {

    private static final String COMPLAINT = "PGR-2026-000123";
    private static final String TENANT = "ke.bomet";
    private static final String CITIZEN_UUID = "9a1f2e77-0c3b-4c2a-9f3e-5a1d2c3b4e5f";
    private static final String ASSIGNEE_UUID = "3c2b1a09-7f6e-4d5c-8b2a-1e0f9d8c7b6a";
    private static final String PI_ID = "7d2c4b1e-5f60-4a8b-9c3d-2e1f0a9b8c7d";

    private final ThinEventBuilder builder = new ThinEventBuilder();

    private static ServiceRequest request(String action, String toState, String processInstanceId) {
        Service service = Service.builder()
                .tenantId(TENANT)
                .serviceCode("StreetLight")
                .serviceRequestId(COMPLAINT)
                .accountId(CITIZEN_UUID)
                .applicationStatus(toState)
                .citizen(User.builder().uuid(CITIZEN_UUID).name("Amina Chebet")
                        .mobileNumber("712345678").countryCode("+254").emailId("amina@example.com").build())
                .address(Address.builder().district("BOMET").build())
                .auditDetails(AuditDetails.builder().createdTime(1_790_000_000_000L).lastModifiedTime(1_790_000_500_000L).build())
                .processInstance(processInstanceId == null ? null : ProcessInstance.builder().id(processInstanceId).build())
                .build();
        return ServiceRequest.builder()
                .requestInfo(RequestInfo.builder().msgId("1790000000000|sw_KE").build())
                .service(service)
                .workflow(Workflow.builder().action(action).comments("Assigned to the ward team").build())
                .build();
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> map(Map<String, Object> event, String key) {
        return (Map<String, Object>) event.get(key);
    }

    @Test
    void applyWithNoAssignee() {
        ServiceRequest request = request("APPLY", "PENDINGFORASSIGNMENT", PI_ID);
        request.getWorkflow().setComments(null);

        Map<String, Object> event = builder.build(request, null, "https://s.gov/x1", null, null);

        ThinEventContract.assertConforms(event);
        assertEquals("COMPLAINTS.WORKFLOW.APPLY.PENDINGFORASSIGNMENT", event.get("eventName"));
        assertEquals("COMPLAINTS.WORKFLOW.APPLY", event.get("ledgerEventName"));
        assertEquals("COMPLAINTS_WORKFLOW_TRANSITIONED", event.get("eventType"));
        assertEquals(COMPLAINT, event.get("entityId"));
        assertEquals(TENANT, event.get("tenantId"));
        assertEquals(Set.of("citizen"), map(event, "actors").keySet());

        Map<String, Object> data = map(event, "data");
        assertFalse(data.containsKey("emp_name"), "no assignee, no {emp_name}");
        assertFalse(data.containsKey("additional_comments"), "a null comment is absent, not blank");
        assertFalse(data.containsKey("rating"));
        assertEquals("https://s.gov/x1", data.get("download_link"));

        Map<String, Object> localized = map(event, "localized");
        assertFalse(localized.containsKey("emp_department"));
        assertFalse(localized.containsKey("emp_designation"));
    }

    @Test
    void assignWithUuidOnlyAssignee() {
        Map<String, Object> event = builder.build(request("ASSIGN", "PENDINGATLME", PI_ID),
                ResolvedAssignee.ofUuid(ASSIGNEE_UUID, "Peter Kirui"), "https://s.gov/x1", "DEPT_25", "AE");

        ThinEventContract.assertConforms(event);
        assertEquals("COMPLAINTS.WORKFLOW.ASSIGN.PENDINGATLME", event.get("eventName"));
        assertEquals("COMPLAINTS.WORKFLOW.ASSIGN", event.get("ledgerEventName"));
        // Same top-level shape as contract/examples/thin/02-pgr-assign.json.
        assertEquals(Set.of("kind", "schemaVersion", "eventId", "eventType", "eventTime", "producer", "module",
                "eventName", "entityType", "entityId", "tenantId", "transactionSeed", "actors", "data", "localized",
                "localizationModules", "localizationLocale", "ledgerEventName", "payload"), event.keySet());

        // uuid-only: the bridge hydrates, and no employee contact reaches Kafka.
        assertEquals(Map.of("userId", ASSIGNEE_UUID, "type", "EMPLOYEE"), map(map(event, "actors"), "assignee"));
        // The citizen travels inline, with the country code applied once.
        Map<String, Object> citizen = map(map(event, "actors"), "citizen");
        assertEquals(CITIZEN_UUID, citizen.get("userId"));
        assertEquals("CITIZEN", citizen.get("type"));
        assertEquals("+254712345678", citizen.get("phone"));

        Map<String, Object> data = map(event, "data");
        assertEquals("Peter Kirui", data.get("emp_name"));
        assertEquals("Assigned to the ward team", data.get("additional_comments"));
        assertEquals("StreetLight", data.get("complaint_type"));
        assertEquals("PENDINGATLME", data.get("status"));

        Map<String, Object> localized = map(event, "localized");
        assertEquals(List.of("COMMON_MASTERS_DEPARTMENT_DEPT_25"), localized.get("emp_department"));
        assertEquals(List.of("COMMON_MASTERS_DESIGNATION_AE"), localized.get("emp_designation"));
        assertEquals(List.of("COMPLAINT_HIERARCHY.StreetLight", "pgr.complaint.category.StreetLight"),
                localized.get("complaint_type"));
        assertEquals(List.of("CS_COMMON_PENDINGATLME"), localized.get("status"));
        assertEquals(List.of("BOMET"), localized.get("ulb"));
        // Codes only, no literal: these four exist only if localization resolves them.
        for (String token : List.of("ulb", "ao_designation", "emp_department", "emp_designation")) {
            assertFalse(data.containsKey(token), token + " must not carry a literal");
        }
        assertEquals(List.of("rainmaker-pgr", "rainmaker-common"), event.get("localizationModules"));
        assertEquals("sw_KE", event.get("localizationLocale"));
        assertEquals(Map.of("complaintNo", COMPLAINT, "status", "PENDINGATLME", "action", "ASSIGN",
                "toState", "PENDINGATLME"), event.get("payload"));
    }

    @Test
    void inlineAssigneeCarriesTheWorkflowRecord() {
        Map<String, Object> event = builder.build(request("REOPEN", "PENDINGATLME", PI_ID),
                ResolvedAssignee.inline(ASSIGNEE_UUID, "Peter Kirui", "0722000111"), "", null, null);

        ThinEventContract.assertConforms(event);
        assertEquals(Map.of("userId", ASSIGNEE_UUID, "type", "EMPLOYEE", "name", "Peter Kirui", "phone", "0722000111"),
                map(map(event, "actors"), "assignee"));
    }

    @Test
    void employmentCodesOnlyForANamedAssigneeInTheDepartment() {
        Map<String, Object> noDepartment = builder.build(request("ASSIGN", "PENDINGATLME", PI_ID),
                ResolvedAssignee.ofUuid(ASSIGNEE_UUID, "Peter Kirui"), "", null, "AE");
        assertFalse(map(noDepartment, "localized").containsKey("emp_designation"),
                "a designation without the confirmed department names the wrong job");

        Map<String, Object> noAssignee = builder.build(request("ASSIGN", "PENDINGATLME", PI_ID), null, "", "DEPT_25", "AE");
        assertFalse(map(noAssignee, "localized").containsKey("emp_department"));
    }

    @Test
    void seedIsOnePerTransitionAndIncludesTheProcessInstanceId() {
        Map<String, Object> first = builder.build(request("ASSIGN", "PENDINGATLME", PI_ID), null, "", null, null);
        assertEquals(COMPLAINT + ":ASSIGN:PENDINGATLME:" + PI_ID, first.get("transactionSeed"));

        // A redelivery of the same transition keeps the seed although eventId is minted per build.
        Map<String, Object> redelivered = builder.build(request("ASSIGN", "PENDINGATLME", PI_ID), null, "", null, null);
        assertEquals(first.get("transactionSeed"), redelivered.get("transactionSeed"));
        assertNotEquals(first.get("eventId"), redelivered.get("eventId"));

        // A second ASSIGN into the same state is a new transition, so a new seed.
        Map<String, Object> again = builder.build(request("ASSIGN", "PENDINGATLME", "0b9e1d2c-other"), null, "", null, null);
        assertNotEquals(first.get("transactionSeed"), again.get("transactionSeed"));
    }

    @Test
    void missingProcessInstanceFallsBackToLastModifiedTimeThenOmitsTheSeed() {
        ServiceRequest request = request("RESOLVE", "RESOLVED", null);
        assertEquals(COMPLAINT + ":RESOLVE:RESOLVED:1790000500000",
                builder.build(request, null, "", null, null).get("transactionSeed"));

        request.getService().setAuditDetails(null);
        Map<String, Object> event = builder.build(request, null, "", null, null);
        assertFalse(event.containsKey("transactionSeed"), "no seed rather than a seed that collides");
        ThinEventContract.assertConforms(event);
    }

    @Test
    void downloadLinkIsBlankedNotOmitted() {
        Map<String, Object> event = builder.build(request("RESOLVE", "RESOLVED", PI_ID), null, null, null, null);
        assertEquals("", map(event, "data").get("download_link"));
        ThinEventContract.assertConforms(event);
    }

    @Test
    void citizenWithoutUuidFallsBackToTheAccountId() {
        ServiceRequest request = request("APPLY", "PENDINGFORASSIGNMENT", PI_ID);
        request.getService().getCitizen().setUuid(null);
        request.getService().getCitizen().setEmailId(null);
        Map<String, Object> citizen = map(map(builder.build(request, null, "", null, null), "actors"), "citizen");
        assertEquals(CITIZEN_UUID, citizen.get("userId"));
        assertFalse(citizen.containsKey("email"), "absent, not null");
    }

    @Test
    void localeComesFromMsgIdElseTheDefault() {
        assertEquals("hi_IN", ThinEventBuilder.localeFromMsgId(RequestInfo.builder().msgId("123|hi_IN").build()));
        assertEquals("en_IN", ThinEventBuilder.localeFromMsgId(RequestInfo.builder().msgId("123").build()));
        assertEquals("en_IN", ThinEventBuilder.localeFromMsgId(null));
    }

    @Test
    void countryCodeIsAppliedOnce() {
        assertEquals("+254712345678", ThinEventBuilder.withCountryCode("712345678", "+254"));
        assertEquals("+254712345678", ThinEventBuilder.withCountryCode("+254712345678", "+254"));
        assertEquals("712345678", ThinEventBuilder.withCountryCode("712345678", null));
        assertTrue(ThinEventBuilder.withCountryCode(null, "+254") == null);
    }
}
