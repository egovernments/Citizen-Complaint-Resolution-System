package org.egov.pgr.service.notification;

import org.egov.common.contract.request.RequestInfo;
import org.egov.pgr.config.PGRConfiguration;
import org.egov.pgr.producer.Producer;
import org.egov.pgr.repository.ServiceRequestRepository;
import org.egov.pgr.service.NotificationService;
import org.egov.pgr.service.WorkflowService;
import org.egov.pgr.util.HRMSUtil;
import org.egov.pgr.util.MDMSUtils;
import org.egov.pgr.util.NotificationUtil;
import org.egov.pgr.web.models.Address;
import org.egov.pgr.web.models.AuditDetails;
import org.egov.pgr.web.models.ServiceRequest;
import org.egov.pgr.web.models.Workflow;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * What {@code NotificationService} still owns after the thin-event cutover, behaviour by behaviour:
 * deciding a transition is describable at all, resolving who the complaint is with, building the
 * placeholder values that need PGR context, and publishing exactly one event without ever letting a
 * failure reach the complaint transaction that triggered it.
 *
 * <p>It is deliberately NOT a second copy of the golden master. The golden master proves the whole
 * event is right for 26 real scenarios; this proves the branches that scenario matrix cannot reach —
 * a producer that throws, a shortener that is down, an egov-user lookup that fails mid-history-walk.
 *
 * <p>Everything routing-, recipient-, locale-, template- and envelope-shaped that used to be tested
 * here moved to novu-bridge with the code
 * ({@code org.egov.novubridge.service.resolution.NotificationResolverEdgeCasesTest} and its
 * siblings).
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class ThinEventProducerTest {

    private static final String TENANT = "ke.bomet";
    private static final String COMPLAINT = "PGR-2026-000123";
    private static final String TOPIC = "complaints.domain.events";
    private static final String ASSIGNEE_UUID = "3c2b1a09-7f6e-4d5c-8b2a-1e0f9d8c7b6a";

    @Mock private PGRConfiguration config;
    @Mock private ServiceRequestRepository repository;
    @Mock private MDMSUtils mdmsUtils;
    @Mock private NotificationUtil notificationUtil;
    @Mock private WorkflowService workflowService;
    @Mock private Producer producer;

    private NotificationService service;

    @BeforeEach
    void setUp() {
        when(config.getComplaintsDomainEventsTopic()).thenReturn(TOPIC);
        when(config.getMobileDownloadLink()).thenReturn("https://citizen.example.gov/download");
        when(config.getUserHost()).thenReturn("http://user/");
        when(config.getUserSearchEndpoint()).thenReturn("user/_search");
        when(config.getHrmsHost()).thenReturn("http://hrms/");
        when(config.getHrmsEndPoint()).thenReturn("egov-hrms/employees/_search");
        when(config.getEgovInternalMicroserviceUserUuid()).thenReturn("internal-uuid");
        when(notificationUtil.getShortnerURL(anyString())).thenReturn("https://sho.rt/dl1");
        when(workflowService.getprocessInstanceSearchURL(anyString(), anyString()))
                .thenAnswer(inv -> new StringBuilder("http://workflow/egov-wf/process/_search?tenantId=")
                        .append((String) inv.getArgument(0)));

        service = new NotificationService();
        ReflectionTestUtils.setField(service, "config", config);
        ReflectionTestUtils.setField(service, "notificationUtil", notificationUtil);
        ReflectionTestUtils.setField(service, "workflowService", workflowService);
        ReflectionTestUtils.setField(service, "serviceRequestRepository", repository);
        ReflectionTestUtils.setField(service, "mdmsUtils", mdmsUtils);
        ReflectionTestUtils.setField(service, "hrmsUtils", new HRMSUtil(repository, config));
        // Configured as MainConfiguration does it: an egov-user row carries fields the PGR User
        // model has never had, and a strict mapper would turn every lookup into "no assignee".
        ReflectionTestUtils.setField(service, "mapper", new com.fasterxml.jackson.databind.ObjectMapper()
                .disable(com.fasterxml.jackson.databind.DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES));
        ReflectionTestUtils.setField(service, "thinEventBuilder", new ThinEventBuilder());
        ReflectionTestUtils.setField(service, "producer", producer);
    }

    // ---- is there anything to describe --------------------------------------------------------

    @Test
    @DisplayName("a transition with no action publishes nothing — there is no transition to describe")
    void blankAction_publishesNothing() {
        ServiceRequest request = request("APPLY", "PENDINGFORASSIGNMENT");
        request.getWorkflow().setAction("  ");
        world(noUsers());

        service.process(request, "update-pgr-request");

        verify(producer, never()).push(anyString(), anyString(), any());
    }

    @Test
    @DisplayName("a transition with no target state publishes nothing")
    void blankToState_publishesNothing() {
        ServiceRequest request = request("APPLY", null);
        world(noUsers());

        service.process(request, "update-pgr-request");

        verify(producer, never()).push(anyString(), anyString(), any());
    }

    @Test
    @DisplayName("a transition nobody is routed for STILL publishes — routing is the bridge's decision")
    void unroutedTransition_stillPublishes() {
        // ESCALATE has no routing row in the shipped seed and used to be dropped silently here.
        // It now reaches the bridge, which records a visible SKIPPED / NB_NO_ROUTING ledger row.
        world(noUsers());

        service.process(request("ESCALATE", "PENDINGATLME"), "update-pgr-request");

        assertEquals("COMPLAINTS.WORKFLOW.ESCALATE.PENDINGATLME", published().get("eventName"));
    }

    // ---- the event itself ---------------------------------------------------------------------

    @Test
    @DisplayName("one event, on the complaints topic, keyed by tenant")
    void publishesExactlyOneEventOnTheComplaintsTopic() {
        world(noUsers());

        service.process(request("APPLY", "PENDINGFORASSIGNMENT"), "save-pgr-request");

        ArgumentCaptor<String> tenant = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<String> topic = ArgumentCaptor.forClass(String.class);
        verify(producer).push(tenant.capture(), topic.capture(), any());
        assertEquals(TENANT, tenant.getValue());
        assertEquals(TOPIC, topic.getValue());
    }

    @Test
    @DisplayName("the config key carries the target state; the ledger label does not")
    void eventNameCarriesTheTargetState_ledgerNameDoesNot() {
        world(noUsers());

        service.process(request("rate", "closedafterresolution"), "update-pgr-request");

        Map<String, Object> event = published();
        assertEquals("COMPLAINTS.WORKFLOW.RATE.CLOSEDAFTERRESOLUTION", event.get("eventName"));
        assertEquals("COMPLAINTS.WORKFLOW.RATE", event.get("ledgerEventName"));
    }

    @Test
    @DisplayName("the transaction seed keeps the RAW action and state, so transaction ids do not move")
    void transactionSeedUsesTheRawActionAndState() {
        world(noUsers());

        service.process(request("rate", "closedafterresolution"), "update-pgr-request");

        // Uppercasing here would change every transactionId the bridge completes, and a redeploy
        // mid-flight would then double-send instead of upserting the same ledger row.
        assertEquals(COMPLAINT + ":rate:closedafterresolution", published().get("transactionSeed"));
    }

    @Test
    @DisplayName("the citizen travels inline; their uuid falls back to the complaint's accountId")
    void citizenActorFallsBackToAccountId_andIsNotRePrefixed() {
        ServiceRequest request = request("APPLY", "PENDINGFORASSIGNMENT");
        request.getService().getCitizen().setUuid("   ");
        request.getService().setAccountId("account-99");
        request.getService().getCitizen().setMobileNumber("+254712345678");
        world(noUsers());

        service.process(request, "save-pgr-request");

        Map<String, Object> citizen = actor("citizen");
        assertEquals("account-99", citizen.get("userId"));
        assertEquals("CITIZEN", citizen.get("type"));
        // Already E.164: prefixing it again would produce +254+254712345678.
        assertEquals("+254712345678", citizen.get("phone"));
    }

    @Test
    @DisplayName("a token the producer cannot fill is OMITTED, never blanked")
    void unfillableTokensAreOmittedFromData() {
        ServiceRequest request = request("APPLY", "PENDINGFORASSIGNMENT");
        request.getService().setRating(null);
        request.getWorkflow().setComments(null);
        world(noUsers());

        service.process(request, "save-pgr-request");

        Map<String, Object> data = block("data");
        // An empty variable is what a provider rejects (Twilio 21656); an absent one leaves the
        // renderer's braces literal, which is the behaviour being preserved.
        assertFalse(data.containsKey("rating"), "rating must be absent, not blank");
        assertFalse(data.containsKey("additional_comments"), "additional_comments must be absent, not blank");
        assertEquals(COMPLAINT, data.get("id"));
    }

    @Test
    @DisplayName("localized carries CODES only — ulb and ao_designation have no literal at all")
    void localizedCarriesCodesNotText() {
        world(noUsers());

        service.process(request("APPLY", "PENDINGFORASSIGNMENT"), "save-pgr-request");

        Map<String, Object> localized = block("localized");
        assertEquals(List.of("COMPLAINT_HIERARCHY.GarbageNeedsTobeCleared",
                        "pgr.complaint.category.GarbageNeedsTobeCleared"),
                localized.get("complaint_type"));
        assertEquals(List.of("CS_COMMON_PENDINGFORASSIGNMENT"), localized.get("status"));
        assertEquals(List.of("KE_BOMET"), localized.get("ulb"));
        assertEquals(List.of("COMMON_MASTERS_DESIGNATION_AO"), localized.get("ao_designation"));
        // ulb and ao_designation exist ONLY as codes: a localization outage must leave them as
        // literal braces, which it cannot do if the producer also ships a literal.
        assertFalse(block("data").containsKey("ulb"));
        assertFalse(block("data").containsKey("ao_designation"));
    }

    @Test
    @DisplayName("the locale the values are built in comes from RequestInfo.msgId, once per event")
    void localizationLocaleComesFromMsgId() {
        ServiceRequest request = request("APPLY", "PENDINGFORASSIGNMENT");
        request.getRequestInfo().setMsgId("1690000000000|hi_IN");
        world(noUsers());

        service.process(request, "save-pgr-request");

        assertEquals("hi_IN", published().get("localizationLocale"));
    }

    @Test
    @DisplayName("no msgId locale means the deployment default")
    void localizationLocaleDefaultsToEnIn() {
        ServiceRequest request = request("APPLY", "PENDINGFORASSIGNMENT");
        request.getRequestInfo().setMsgId("1690000000000");
        world(noUsers());

        service.process(request, "save-pgr-request");

        assertEquals("en_IN", published().get("localizationLocale"));
    }

    // ---- assignee resolution ------------------------------------------------------------------

    @Test
    @DisplayName("the live workflow assignee is sent as a uuid only — the bridge hydrates the rest")
    void liveAssigneeIsSentAsUuidOnly() {
        ServiceRequest request = request("ASSIGN", "PENDINGATLME");
        request.getWorkflow().setAssignes(List.of(ASSIGNEE_UUID));
        world(user(ASSIGNEE_UUID, "Peter Kirui"));

        service.process(request, "update-pgr-request");

        Map<String, Object> assignee = actor("assignee");
        assertEquals(ASSIGNEE_UUID, assignee.get("userId"));
        assertEquals("EMPLOYEE", assignee.get("type"));
        // No phone, no email on the broker: that is the whole PII win of the uuid-only form.
        assertFalse(assignee.containsKey("phone"));
        assertFalse(assignee.containsKey("name"));
        assertEquals("Peter Kirui", block("data").get("emp_name"));
    }

    @Test
    @DisplayName("with no live assignee the last ASSIGN in workflow history is used")
    void assigneeFallsBackToWorkflowHistory() {
        ServiceRequest request = request("RATE", "CLOSEDAFTERRESOLUTION");
        request.getWorkflow().setAssignes(new ArrayList<>());
        world(user(ASSIGNEE_UUID, "Peter Kirui"), history(ASSIGNEE_UUID, "Peter K", "722000111"));

        service.process(request, "update-pgr-request");

        assertEquals(ASSIGNEE_UUID, actor("assignee").get("userId"));
        // The egov-user record wins over the workflow's copy of the name.
        assertEquals("Peter Kirui", block("data").get("emp_name"));
        assertFalse(actor("assignee").containsKey("phone"));
    }

    @Test
    @DisplayName("when egov-user cannot be reached the workflow's own record travels INLINE")
    void assigneeIsSentInlineWhenTheUserLookupFails() {
        ServiceRequest request = request("RATE", "CLOSEDAFTERRESOLUTION");
        request.getWorkflow().setAssignes(new ArrayList<>());
        world(noUsers(), history(ASSIGNEE_UUID, "Peter K", "722000111"));

        service.process(request, "update-pgr-request");

        Map<String, Object> assignee = actor("assignee");
        // Design errata 6: the same person, published under a different identity, because this is
        // then the only contact anyone holds. No country code is added — the workflow has none.
        assertEquals(ASSIGNEE_UUID, assignee.get("userId"));
        assertEquals("Peter K", assignee.get("name"));
        assertEquals("722000111", assignee.get("phone"));
        assertEquals("Peter K", block("data").get("emp_name"));
    }

    @Test
    @DisplayName("no assignee means no assignee actor, no {emp_name} and no HRMS call at all")
    void noAssignee_meansNoActorAndNoHrmsCall() {
        world(noUsers());

        service.process(request("APPLY", "PENDINGFORASSIGNMENT"), "save-pgr-request");

        assertFalse(block("actors").containsKey("assignee"));
        assertFalse(block("data").containsKey("emp_name"));
        assertFalse(block("localized").containsKey("emp_department"));
        verify(repository, never()).fetchResult(
                org.mockito.ArgumentMatchers.argThat(uri -> String.valueOf(uri).startsWith("http://hrms/")), any());
    }

    // ---- the HRMS x MDMS join -----------------------------------------------------------------

    @Test
    @DisplayName("emp_department and emp_designation are codes, and only for a matching assignment")
    void hrmsJoinYieldsCodesForAMatchingAssignment() {
        ServiceRequest request = request("ASSIGN", "PENDINGATLME");
        request.getWorkflow().setAssignes(List.of(ASSIGNEE_UUID));
        world(user(ASSIGNEE_UUID, "Peter Kirui"));
        hrms("DEPT_3", "DESIG_5");

        service.process(request, "update-pgr-request");

        Map<String, Object> localized = block("localized");
        assertEquals(List.of("COMMON_MASTERS_DEPARTMENT_DEPT_3"), localized.get("emp_department"));
        assertEquals(List.of("COMMON_MASTERS_DESIGNATION_DESIG_5"), localized.get("emp_designation"));
    }

    @Test
    @DisplayName("an assignment in a different department names the wrong job — so neither code is sent")
    void hrmsDepartmentMismatch_yieldsNoCodes() {
        ServiceRequest request = request("ASSIGN", "PENDINGATLME");
        request.getWorkflow().setAssignes(List.of(ASSIGNEE_UUID));
        world(user(ASSIGNEE_UUID, "Peter Kirui"));
        hrms("DEPT_9", "DESIG_5");

        service.process(request, "update-pgr-request");

        assertFalse(block("localized").containsKey("emp_department"));
        assertFalse(block("localized").containsKey("emp_designation"));
        // …and the rest of the event is unharmed.
        assertEquals("Peter Kirui", block("data").get("emp_name"));
    }

    // ---- failure isolation --------------------------------------------------------------------

    @Test
    @DisplayName("a shortener outage blanks {download_link} and leaves every other value intact")
    void shortenerOutageBlanksOnlyTheDownloadLink() {
        when(notificationUtil.getShortnerURL(anyString()))
                .thenThrow(new IllegalStateException("egov-url-shortening unavailable"));
        world(noUsers());

        service.process(request("APPLY", "PENDINGFORASSIGNMENT"), "save-pgr-request");

        Map<String, Object> data = block("data");
        // Blanked, not omitted: a message containing the literal text {download_link} must never ship.
        assertEquals("", data.get("download_link"));
        assertEquals(COMPLAINT, data.get("id"));
        assertEquals("GarbageNeedsTobeCleared", data.get("complaint_type"));
        assertEquals("Amina Chebet", data.get("citizen_name"));
    }

    @Test
    @DisplayName("a Kafka failure is logged, never thrown — it must not break the complaint transaction")
    void producerFailureDoesNotEscape() {
        doThrow(new IllegalStateException("kafka is down")).when(producer)
                .push(anyString(), anyString(), any());
        world(noUsers());

        service.process(request("APPLY", "PENDINGFORASSIGNMENT"), "save-pgr-request");
        // no exception
    }

    @Test
    @DisplayName("a workflow-history outage costs the assignee, not the event")
    void workflowOutageStillPublishes() {
        ServiceRequest request = request("RATE", "CLOSEDAFTERRESOLUTION");
        request.getWorkflow().setAssignes(new ArrayList<>());
        when(repository.fetchResult(any(StringBuilder.class), any()))
                .thenThrow(new IllegalStateException("egov-workflow-v2 unavailable"));

        service.process(request, "update-pgr-request");

        assertFalse(block("actors").containsKey("assignee"));
        assertEquals(COMPLAINT, published().get("entityId"));
    }

    // ------------------------------------------------------------------------------------------
    // fixtures
    // ------------------------------------------------------------------------------------------

    private ServiceRequest request(String action, String toState) {
        org.egov.pgr.web.models.User citizen = new org.egov.pgr.web.models.User();
        citizen.setUuid("9a1f2e77-0c3b-4c2a-9f3e-5a1d2c3b4e5f");
        citizen.setName("Amina Chebet");
        citizen.setMobileNumber("712345678");
        citizen.setCountryCode("+254");
        citizen.setEmailId("amina@example.com");

        org.egov.pgr.web.models.Service complaint = new org.egov.pgr.web.models.Service();
        complaint.setTenantId(TENANT);
        complaint.setServiceRequestId(COMPLAINT);
        complaint.setServiceCode("GarbageNeedsTobeCleared");
        complaint.setApplicationStatus(toState);
        complaint.setAccountId("account-1");
        complaint.setRating(4);
        complaint.setCitizen(citizen);
        complaint.setAddress(Address.builder().district("KE_BOMET").build());
        complaint.setAuditDetails(AuditDetails.builder().createdTime(1_751_155_200_000L).build());

        Workflow workflow = new Workflow();
        workflow.setAction(action);
        workflow.setComments("Please clear the dump site");
        workflow.setAssignes(new ArrayList<>());

        return ServiceRequest.builder()
                .requestInfo(RequestInfo.builder().msgId("1690000000000|en_IN").build())
                .service(complaint)
                .workflow(workflow)
                .build();
    }

    /** The whole outside world this test can see, behind the single HTTP funnel. */
    private void world(Map<String, Object> userSearchResponse) {
        world(userSearchResponse, Map.of("ProcessInstances", List.of()));
    }

    private void world(Map<String, Object> userSearchResponse, Map<String, Object> workflowResponse) {
        when(repository.fetchResult(any(StringBuilder.class), any())).thenAnswer(inv -> {
            String uri = String.valueOf(inv.<StringBuilder>getArgument(0));
            if (uri.startsWith("http://user/")) return userSearchResponse;
            if (uri.startsWith("http://hrms/")) return hrmsResponse;
            if (uri.contains("egov-wf/process/_search")) return workflowResponse;
            throw new IllegalStateException("unexpected outbound call to " + uri);
        });
        when(mdmsUtils.mDMSCall(any(ServiceRequest.class))).thenReturn(Map.of("MdmsRes",
                Map.of("RAINMAKER-PGR", Map.of("ComplaintHierarchy",
                        List.of(Map.of("code", "GarbageNeedsTobeCleared", "department", "DEPT_3"))))));
    }

    /** Read lazily by the funnel above, so a test may call {@link #hrms} after {@link #world}. */
    private Object hrmsResponse = null;

    private void hrms(String department, String designation) {
        hrmsResponse = Map.of("Employees", List.of(Map.of(
                "user", Map.of("name", "Peter Kirui"),
                "assignments", List.of(Map.of(
                        "department", department,
                        "designation", designation,
                        "isCurrentAssignment", true)))));
    }

    private static LinkedHashMap<String, Object> noUsers() {
        LinkedHashMap<String, Object> res = new LinkedHashMap<>();
        res.put("user", Collections.emptyList());
        return res;
    }

    /** An egov-user _search response. {@code createdDate} is mandatory: parseResponse NPEs without it. */
    private static LinkedHashMap<String, Object> user(String uuid, String name) {
        LinkedHashMap<String, Object> row = new LinkedHashMap<>();
        row.put("uuid", uuid);
        row.put("name", name);
        row.put("mobileNumber", "733000222");
        row.put("countryCode", "+254");
        row.put("emailId", "peter@bomet.go.ke");
        row.put("createdDate", "01-01-2026 10:00:00");
        LinkedHashMap<String, Object> res = new LinkedHashMap<>();
        res.put("user", List.of(row));
        return res;
    }

    private static Map<String, Object> history(String uuid, String name, String mobile) {
        return Map.of("ProcessInstances", List.of(
                Map.of("action", "APPLY", "assignes", List.of()),
                Map.of("action", "ASSIGN", "assignes",
                        List.of(Map.of("uuid", uuid, "name", name, "mobileNumber", mobile)))));
    }

    // ---- assertions helpers -------------------------------------------------------------------

    @SuppressWarnings("unchecked")
    private Map<String, Object> published() {
        ArgumentCaptor<Object> event = ArgumentCaptor.forClass(Object.class);
        verify(producer).push(anyString(), anyString(), event.capture());
        return (Map<String, Object>) event.getValue();
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> block(String name) {
        Object value = published().get(name);
        assertTrue(value instanceof Map, name + " is not an object: " + value);
        return (Map<String, Object>) value;
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> actor(String name) {
        Object value = block("actors").get(name);
        assertNotNull(value, "actor '" + name + "' is missing from the event");
        return (Map<String, Object>) value;
    }
}
