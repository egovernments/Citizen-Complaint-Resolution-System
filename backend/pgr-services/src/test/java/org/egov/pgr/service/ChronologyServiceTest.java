package org.egov.pgr.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.egov.common.contract.request.RequestInfo;
import org.egov.common.contract.request.Role;
import org.egov.common.contract.request.User;
import org.egov.pgr.service.ChronologyService.ComplaintContext;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * CRQ v2 AC-03 — the filtering core, fed with a fixture modelled on a real
 * egov-workflow-v2 process/_search payload (captured live: an internal
 * COMMENT, a closing RESOLVE, and the citizen's own APPLY).
 */
class ChronologyServiceTest {

    private static final ObjectMapper M = new ObjectMapper();
    private static final String COMPLAINANT = "citizen-uuid-1";
    private static final String OFFICER = "officer-uuid-9";
    private static final String BID = "PG-PGR-2026-09-08-000001";

    private ObjectNode fixture() {
        try {
            return (ObjectNode) M.readTree("""
            {"ResponseInfo":{"status":"successful"},
             "ProcessInstances":[
               {"businessId":"%1$s","action":"RESOLVE",
                "comment":"Resolvido: closing entry - the citizen SHOULD read this",
                "documents":[{"documentType":"PHOTO","fileStoreId":"closing-file-1"}],
                "assigner":{"uuid":"%2$s","name":"Officer Nine","userName":"OFF9","mobileNumber":"840000009","roles":[{"code":"EMPLOYEE"}]},
                "assignes":null,
                "state":{"state":"RESOLVED","applicationStatus":"RESOLVED"},
                "nextActions":[{"action":"RATE","roles":["CITIZEN"]}],
                "auditDetails":{"createdTime":1},"escalated":false},
               {"businessId":"%1$s","action":"COMMENT",
                "comment":"INTERNAL NOTE - the citizen must NEVER read this",
                "documents":[{"documentType":"PHOTO","fileStoreId":"secret-file-7"}],
                "assigner":{"uuid":"%2$s","name":"Officer Nine","userName":"OFF9","mobileNumber":"840000009","roles":[{"code":"EMPLOYEE"}]},
                "assignes":[{"uuid":"%2$s","name":"Officer Nine","mobileNumber":"840000009"}],
                "state":{"state":"PENDING","applicationStatus":"PENDING"},
                "nextActions":[],"auditDetails":{"createdTime":2},"escalated":false},
               {"businessId":"%1$s","action":"APPLY",
                "comment":"my own words",
                "documents":[{"documentType":"PHOTO","fileStoreId":"my-file-2"}],
                "assigner":{"uuid":"%3$s","name":"Maria Cossa","userName":"841234567","mobileNumber":"841234567","roles":[{"code":"CITIZEN"}]},
                "assignes":null,
                "state":{"state":"PENDING","applicationStatus":"PENDING"},
                "nextActions":[],"auditDetails":{"createdTime":3},"escalated":false}
             ]}""".formatted(BID, OFFICER, COMPLAINANT));
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }

    private RequestInfo requester(String type, String uuid, String... roles) {
        User u = User.builder().type(type).uuid(uuid)
                .roles(java.util.Arrays.stream(roles).map(c -> Role.builder().code(c).build()).toList())
                .build();
        RequestInfo ri = new RequestInfo();
        ri.setUserInfo(u);
        return ri;
    }

    private Map<String, ComplaintContext> ctx(boolean confidential) {
        return ctx(confidential, false);
    }

    private Map<String, ComplaintContext> ctx(boolean confidential, boolean viewerAuthorized) {
        return Map.of(BID, new ComplaintContext(COMPLAINANT, confidential, "IGE", viewerAuthorized));
    }

    // ---------- complainant (citizen) view ----------

    @Test
    void complainantSeesStatusOnlyForInternalSteps() {
        ObjectNode root = fixture();
        ChronologyService.filterForRequester(root, requester("CITIZEN", COMPLAINANT, "CITIZEN"), ctx(false));
        JsonNode comment = root.get("ProcessInstances").get(1);
        assertEquals("COMMENT", comment.get("action").asText());
        assertTrue(comment.get("comment").isNull(), "internal comment must be stripped");
        assertTrue(comment.get("documents").isNull(), "internal attachments must be stripped");
        assertTrue(comment.get("assigner").isNull(), "employee identity must be stripped");
        assertTrue(comment.get("assignes").isNull());
        // status survives: the citizen still sees the complaint moved
        assertEquals("PENDING", comment.get("state").get("state").asText());
        assertEquals(2, comment.get("auditDetails").get("createdTime").asInt());
    }

    @Test
    void complainantKeepsTheClosingEntryContentWithoutTheEmployeeIdentity() {
        ObjectNode root = fixture();
        ChronologyService.filterForRequester(root, requester("CITIZEN", COMPLAINANT, "CITIZEN"), ctx(false));
        JsonNode resolve = root.get("ProcessInstances").get(0);
        assertTrue(resolve.get("comment").asText().contains("closing entry"));
        assertEquals("closing-file-1", resolve.get("documents").get(0).get("fileStoreId").asText());
        assertTrue(resolve.get("assigner").isNull(), "closing entry must not name the employee");
        // the citizen's action buttons still work
        assertEquals("RATE", resolve.get("nextActions").get(0).get("action").asText());
    }

    @Test
    void complainantKeepsTheQuestionPutToThem() {
        // igsae CMS workflow: INVESTIGATION --AWAITINGINFORMATION--> INFOFROMCITIZEN.
        // The officer's comment IS the question, and the timeline is the
        // citizen's one reliable channel for it (the reply transition belongs
        // to staff; no notification reliably carries the comment). Stripping
        // it stalls the complaint on a question the citizen cannot see.
        // Identity still never survives.
        ObjectNode root = fixture();
        ObjectNode question = (ObjectNode) root.get("ProcessInstances").get(1);
        question.put("action", "AWAITINGINFORMATION");
        question.put("comment", "Por favor indique o numero do processo.");
        ChronologyService.filterForRequester(root, requester("CITIZEN", COMPLAINANT, "CITIZEN"), ctx(false));
        JsonNode filtered = root.get("ProcessInstances").get(1);
        assertEquals("Por favor indique o numero do processo.", filtered.get("comment").asText(),
                "the request-for-information comment must reach the citizen");
        assertEquals("secret-file-7", filtered.get("documents").get(0).get("fileStoreId").asText());
        assertTrue(filtered.get("assigner").isNull(), "but never the employee identity");
    }

    @Test
    void supervisorResolutionStaysStatusOnly_parityWithTheCitizenUi() {
        // Deliberate: the citizen UI has never shown the RESOLVEBYSUPERVISOR
        // comment, so the endpoint strips it too — parity, not a new rule.
        ObjectNode root = fixture();
        ((ObjectNode) root.get("ProcessInstances").get(0)).put("action", "RESOLVEBYSUPERVISOR");
        ChronologyService.filterForRequester(root, requester("CITIZEN", COMPLAINANT, "CITIZEN"), ctx(false));
        JsonNode resolve = root.get("ProcessInstances").get(0);
        assertTrue(resolve.get("comment").isNull());
        assertTrue(resolve.get("assigner").isNull());
    }

    @Test
    void aMissingActionDegradesToStatusOnlyInsteadOf500() {
        // Set.of collections throw on contains(null); a migrated row without an
        // action must degrade to status-only, not NPE the whole chronology.
        ObjectNode root = fixture();
        ((ObjectNode) root.get("ProcessInstances").get(1)).remove("action");
        assertDoesNotThrow(() ->
                ChronologyService.filterForRequester(root, requester("CITIZEN", COMPLAINANT, "CITIZEN"), ctx(false)));
        JsonNode step = root.get("ProcessInstances").get(1);
        assertTrue(step.get("comment").isNull());
        assertTrue(step.get("assigner").isNull());
    }

    @Test
    void complainantsOwnStepStaysWhole() {
        ObjectNode root = fixture();
        ChronologyService.filterForRequester(root, requester("CITIZEN", COMPLAINANT, "CITIZEN"), ctx(false));
        JsonNode apply = root.get("ProcessInstances").get(2);
        assertEquals("my own words", apply.get("comment").asText());
        assertEquals("Maria Cossa", apply.get("assigner").get("name").asText());
    }

    @Test
    void complainantsOwnStepDropsTheOfficerItWasRoutedTo() {
        // Regression (UAT PRD-2026-000001): a citizen's own REOPEN/APPLY names,
        // in assignes, the OFFICER it was routed TO. That is an employee
        // identity and must not reach the citizen even on their own step.
        ObjectNode root = fixture();
        ObjectNode apply = (ObjectNode) root.get("ProcessInstances").get(2);
        apply.set("assignes", M.createArrayNode().add(
                M.createObjectNode().put("uuid", "officer-routed-to").put("name", "MISAU Supervisor 1")));
        ChronologyService.filterForRequester(root, requester("CITIZEN", COMPLAINANT, "CITIZEN"), ctx(false));
        JsonNode own = root.get("ProcessInstances").get(2);
        assertEquals("my own words", own.get("comment").asText(), "own comment stays");
        assertEquals("Maria Cossa", own.get("assigner").get("name").asText(), "the citizen's own identity stays");
        assertTrue(own.get("assignes").isNull(), "but the officer it was routed to must be stripped");
    }

    @Test
    void anotherCitizenGetsNothing() {
        ObjectNode root = fixture();
        ChronologyService.filterForRequester(root, requester("CITIZEN", "someone-else", "CITIZEN"), ctx(false));
        assertEquals(0, root.get("ProcessInstances").size());
    }

    // ---------- employee view ----------

    @Test
    void employeeKeepsEverythingOnANonConfidentialComplaint() {
        ObjectNode root = fixture();
        ChronologyService.filterForRequester(root, requester("EMPLOYEE", OFFICER, "EMPLOYEE"), ctx(false));
        JsonNode comment = root.get("ProcessInstances").get(1);
        assertTrue(comment.get("comment").asText().contains("INTERNAL NOTE"));
        assertEquals("Officer Nine", comment.get("assigner").get("name").asText());
        JsonNode apply = root.get("ProcessInstances").get(2);
        assertEquals("Maria Cossa", apply.get("assigner").get("name").asText());
    }

    @Test
    void employeeSeesComplainantMaskedOnAConfidentialComplaint() {
        ObjectNode root = fixture();
        ChronologyService.filterForRequester(root, requester("EMPLOYEE", OFFICER, "EMPLOYEE"), ctx(true));
        JsonNode apply = root.get("ProcessInstances").get(2);
        assertEquals("****", apply.get("assigner").get("name").asText());
        assertEquals("****", apply.get("assigner").get("mobileNumber").asText());
        // uuid survives (opaque; the frontend matches on it)
        assertEquals(COMPLAINANT, apply.get("assigner").get("uuid").asText());
        // employee identities untouched
        assertEquals("Officer Nine", root.get("ProcessInstances").get(1).get("assigner").get("name").asText());
    }

    @Test
    void confidentialViewerSeesEverythingInClear() {
        ObjectNode root = fixture();
        ChronologyService.filterForRequester(root,
                requester("EMPLOYEE", OFFICER, "EMPLOYEE", "CONFIDENTIAL_COMPLAINT_VIEWER"), ctx(true, true));
        assertEquals("Maria Cossa", root.get("ProcessInstances").get(2).get("assigner").get("name").asText());
    }

    @Test
    void viewerAuthorizationIsPerComplaintNotGlobal() {
        // One request spanning two confidential complaints of different
        // templates: authorization for the first must not unlock the second.
        ObjectNode root = fixture();
        String otherBid = "PG-PGR-2026-09-08-000002";
        ((ObjectNode) root.get("ProcessInstances").get(1)).put("businessId", otherBid);
        Map<String, ComplaintContext> contexts = Map.of(
                BID, new ComplaintContext(COMPLAINANT, true, "IGE", true),
                otherBid, new ComplaintContext(OFFICER, true, "IGSAE", false));
        ChronologyService.filterForRequester(root, requester("EMPLOYEE", "emp-3", "EMPLOYEE"), contexts);
        // authorized template: complainant stays clear
        assertEquals("Maria Cossa", root.get("ProcessInstances").get(2).get("assigner").get("name").asText());
        // unauthorized template: its complainant (the actor on that step) is masked
        assertEquals("****", root.get("ProcessInstances").get(1).get("assigner").get("name").asText());
    }

    // ---------- internal & anonymous ----------

    @Test
    void internalCallerIsUntouchedPassthrough() {
        ObjectNode root = fixture();
        String before = root.toString();
        ChronologyService.filterForRequester(root,
                requester("EMPLOYEE", "svc", "INTERNAL_MICROSERVICE_ROLE"), ctx(true));
        assertEquals(before, root.toString());
    }

    @Test
    void missingUserInfoGetsNothing() {
        // The gateway strips client-supplied userInfo from token-less requests
        // and (audit mode) still forwards them. Absent identity is ANONYMOUS —
        // least privilege, never the internal passthrough.
        ObjectNode root = fixture();
        ChronologyService.filterForRequester(root, new RequestInfo(), ctx(true));
        assertEquals(0, root.get("ProcessInstances").size(),
                "an anonymous caller must receive an empty chronology");
    }

    @Test
    void nullRequestInfoGetsNothing() {
        ObjectNode root = fixture();
        ChronologyService.filterForRequester(root, null, ctx(true));
        assertEquals(0, root.get("ProcessInstances").size());
    }

    @Test
    void payloadShapeIsPreservedForEmployees() {
        ObjectNode root = fixture();
        String before = root.toString();
        ChronologyService.filterForRequester(root, requester("EMPLOYEE", OFFICER, "EMPLOYEE"), ctx(false));
        assertEquals(before, root.toString(), "non-confidential employee payload must be byte-identical");
        assertFalse(root.toString().isEmpty());
    }
}
