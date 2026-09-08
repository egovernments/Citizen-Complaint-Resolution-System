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
        return Map.of(BID, new ComplaintContext(COMPLAINANT, confidential, "IGE"));
    }

    // ---------- complainant (citizen) view ----------

    @Test
    void complainantSeesStatusOnlyForInternalSteps() {
        ObjectNode root = fixture();
        ChronologyService.filterForRequester(root, requester("CITIZEN", COMPLAINANT, "CITIZEN"), ctx(false), false);
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
        ChronologyService.filterForRequester(root, requester("CITIZEN", COMPLAINANT, "CITIZEN"), ctx(false), false);
        JsonNode resolve = root.get("ProcessInstances").get(0);
        assertTrue(resolve.get("comment").asText().contains("closing entry"));
        assertEquals("closing-file-1", resolve.get("documents").get(0).get("fileStoreId").asText());
        assertTrue(resolve.get("assigner").isNull(), "closing entry must not name the employee");
        // the citizen's action buttons still work
        assertEquals("RATE", resolve.get("nextActions").get(0).get("action").asText());
    }

    @Test
    void complainantsOwnStepStaysWhole() {
        ObjectNode root = fixture();
        ChronologyService.filterForRequester(root, requester("CITIZEN", COMPLAINANT, "CITIZEN"), ctx(false), false);
        JsonNode apply = root.get("ProcessInstances").get(2);
        assertEquals("my own words", apply.get("comment").asText());
        assertEquals("Maria Cossa", apply.get("assigner").get("name").asText());
    }

    @Test
    void anotherCitizenGetsNothing() {
        ObjectNode root = fixture();
        ChronologyService.filterForRequester(root, requester("CITIZEN", "someone-else", "CITIZEN"), ctx(false), false);
        assertEquals(0, root.get("ProcessInstances").size());
    }

    // ---------- employee view ----------

    @Test
    void employeeKeepsEverythingOnANonConfidentialComplaint() {
        ObjectNode root = fixture();
        ChronologyService.filterForRequester(root, requester("EMPLOYEE", OFFICER, "EMPLOYEE"), ctx(false), false);
        JsonNode comment = root.get("ProcessInstances").get(1);
        assertTrue(comment.get("comment").asText().contains("INTERNAL NOTE"));
        assertEquals("Officer Nine", comment.get("assigner").get("name").asText());
        JsonNode apply = root.get("ProcessInstances").get(2);
        assertEquals("Maria Cossa", apply.get("assigner").get("name").asText());
    }

    @Test
    void employeeSeesComplainantMaskedOnAConfidentialComplaint() {
        ObjectNode root = fixture();
        ChronologyService.filterForRequester(root, requester("EMPLOYEE", OFFICER, "EMPLOYEE"), ctx(true), false);
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
                requester("EMPLOYEE", OFFICER, "EMPLOYEE", "CONFIDENTIAL_COMPLAINT_VIEWER"), ctx(true), true);
        assertEquals("Maria Cossa", root.get("ProcessInstances").get(2).get("assigner").get("name").asText());
    }

    @Test
    void internalCallerIsUntouchedPassthrough() {
        ObjectNode root = fixture();
        String before = root.toString();
        ChronologyService.filterForRequester(root,
                requester("EMPLOYEE", "svc", "INTERNAL_MICROSERVICE_ROLE"), ctx(true), false);
        assertEquals(before, root.toString());
    }

    @Test
    void missingUserInfoIsUntouchedPassthrough() {
        ObjectNode root = fixture();
        String before = root.toString();
        ChronologyService.filterForRequester(root, new RequestInfo(), ctx(true), false);
        assertEquals(before, root.toString());
    }

    @Test
    void payloadShapeIsPreservedForEmployees() {
        ObjectNode root = fixture();
        String before = root.toString();
        ChronologyService.filterForRequester(root, requester("EMPLOYEE", OFFICER, "EMPLOYEE"), ctx(false), false);
        assertEquals(before, root.toString(), "non-confidential employee payload must be byte-identical");
        assertFalse(root.toString().isEmpty());
    }
}
