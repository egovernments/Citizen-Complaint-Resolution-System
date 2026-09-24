package org.egov.pgr.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.MapperFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.egov.common.contract.request.RequestInfo;
import org.egov.pgr.config.PGRConfiguration;
import org.egov.pgr.producer.Producer;
import org.egov.pgr.repository.ServiceRequestRepository;
import org.egov.pgr.service.notification.ThinEventBuilder;
import org.egov.pgr.service.notification.ThinEventContract;
import org.egov.pgr.util.HRMSUtil;
import org.egov.pgr.util.MDMSUtils;
import org.egov.pgr.util.NotificationUtil;
import org.egov.pgr.web.models.Service;
import org.egov.pgr.web.models.ServiceRequest;
import org.egov.pgr.web.models.User;
import org.egov.pgr.web.models.Workflow;
import org.egov.pgr.web.models.workflow.ProcessInstance;
import org.egov.pgr.web.models.workflow.ProcessInstanceResponse;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.Spy;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * {@link NotificationService#process}: who the complaint is with, the HRMS join, and the thin event
 * that goes on the topic. The downstream services are stubbed at the one seam they share,
 * {@link ServiceRequestRepository#fetchResult}, routed by URL.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class NotificationServiceTest {

    private static final String TENANT = "ke.bomet";
    private static final String COMPLAINT = "PGR-2026-000123";
    private static final String TOPIC = "complaints.domain.events";
    private static final String LIVE_UUID = "11111111-live-assignee";
    private static final String HISTORY_UUID = "22222222-history-assignee";
    private static final String PI_ID = "7d2c4b1e-5f60-4a8b-9c3d-2e1f0a9b8c7d";

    @Mock private PGRConfiguration config;
    @Mock private NotificationUtil notificationUtil;
    @Mock private WorkflowService workflowService;
    @Mock private ServiceRequestRepository serviceRequestRepository;
    @Mock private MDMSUtils mdmsUtils;
    @Mock private HRMSUtil hrmsUtils;
    @Mock private Producer producer;
    // The application's own mapper settings (PGRApp#objectMapper).
    @Spy private ObjectMapper mapper = new ObjectMapper()
            .configure(MapperFeature.ACCEPT_CASE_INSENSITIVE_PROPERTIES, true)
            .disable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES);
    @Spy private ThinEventBuilder thinEventBuilder = new ThinEventBuilder();

    @InjectMocks private NotificationService service;

    /** Workflow history the process-instance search returns; empty means "none found". */
    private final List<ProcessInstance> history = new ArrayList<>();
    /** Users egov-user knows; a uuid missing here makes the lookup fail. */
    private final Map<String, String> users = new LinkedHashMap<>();
    private boolean userServiceDown;

    @BeforeEach
    void setUp() {
        when(config.getUserHost()).thenReturn("http://user");
        when(config.getUserSearchEndpoint()).thenReturn("/user/_search");
        when(config.getMobileDownloadLink()).thenReturn("http://app/pgr");
        when(config.getComplaintsDomainEventsTopic()).thenReturn(TOPIC);
        when(config.getEgovInternalMicroserviceUserUuid()).thenReturn("internal-user");
        when(notificationUtil.getShortnerURL(anyString())).thenReturn("https://s.gov/x1");
        when(workflowService.getprocessInstanceSearchURL(anyString(), anyString()))
                .thenAnswer(inv -> new StringBuilder("http://wf/process/_search?tenantId=" + inv.getArgument(0)));
        when(hrmsUtils.getHRMSURI(anyList(), anyString()))
                .thenAnswer(inv -> new StringBuilder("http://hrms/employees/_search?uuids=" + String.join(",", (List<String>) inv.getArgument(0))));
        when(mdmsUtils.mDMSCall(any())).thenReturn(Map.of("MdmsRes", Map.of("RAINMAKER-PGR",
                Map.of("ComplaintHierarchy", List.of(Map.of("code", "StreetLight", "department", "DEPT_25"))))));
        when(serviceRequestRepository.fetchResult(any(), any()))
                .thenAnswer(inv -> route(inv.getArgument(0).toString(), inv.getArgument(1)));
        users.put(LIVE_UUID, "Live Assignee");
        users.put(HISTORY_UUID, "History Assignee");
    }

    @SuppressWarnings("unchecked")
    private Object route(String url, Object body) {
        if (url.startsWith("http://user")) {
            if (userServiceDown) throw new RuntimeException("egov-user unavailable");
            List<Object> found = new ArrayList<>();
            for (String uuid : (Iterable<String>) ((Map<String, Object>) body).get("uuid")) {
                if (users.containsKey(uuid)) {
                    found.add(new LinkedHashMap<>(Map.of(
                            "uuid", uuid, "name", users.get(uuid), "createdDate", "01-01-2026 10:00:00")));
                }
            }
            LinkedHashMap<String, Object> response = new LinkedHashMap<>();
            response.put("user", found);
            return response;
        }
        if (url.startsWith("http://wf")) {
            return mapper.convertValue(ProcessInstanceResponse.builder().processInstances(history).build(),
                    new TypeReference<Map<String, Object>>() { });
        }
        if (url.startsWith("http://hrms")) {
            // egov-hrms reads an empty uuids filter as "no filter": the whole tenant comes back,
            // led here by somebody else who also works in the complaint's department.
            String uuids = url.substring(url.indexOf("uuids=") + "uuids=".length());
            String designation = uuids.isEmpty() ? "SOMEBODY_ELSES_JOB" : "AE_OF_" + uuids;
            return Map.of("Employees", List.of(Map.of("assignments",
                    List.of(Map.of("department", "DEPT_25", "designation", designation)))));
        }
        throw new AssertionError("unexpected call to " + url);
    }

    private static ServiceRequest request(String action, String toState, List<String> assignes) {
        Service service = Service.builder()
                .tenantId(TENANT)
                .serviceCode("StreetLight")
                .serviceRequestId(COMPLAINT)
                .applicationStatus(toState)
                .citizen(User.builder().uuid("citizen-uuid").name("Amina Chebet").mobileNumber("712345678").build())
                .processInstance(ProcessInstance.builder().id(PI_ID).build())
                .build();
        return ServiceRequest.builder()
                .requestInfo(RequestInfo.builder().msgId("1790000000000|en_IN").build())
                .service(service)
                .workflow(Workflow.builder().action(action).assignes(assignes).build())
                .build();
    }

    private static ProcessInstance assignInHistory(String uuid) {
        return ProcessInstance.builder().id("pi-assign").action("ASSIGN")
                .assignes(List.of(org.egov.common.contract.request.User.builder()
                        .uuid(uuid).name("History Assignee").mobileNumber("0722000111").build()))
                .build();
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> published() {
        ArgumentCaptor<Object> event = ArgumentCaptor.forClass(Object.class);
        verify(producer).push(eq(TENANT), eq(TOPIC), event.capture());
        Map<String, Object> captured = (Map<String, Object>) event.getValue();
        ThinEventContract.assertConforms(captured);
        return captured;
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> at(Map<String, Object> map, String... path) {
        Map<String, Object> out = map;
        for (String key : path) out = (Map<String, Object>) out.get(key);
        return out;
    }

    @Test
    void applyWithNoAssigneePublishesWithoutAnHrmsCall() {
        history.add(ProcessInstance.builder().id("pi-apply").action("APPLY").build());

        service.process(request("APPLY", "PENDINGFORASSIGNMENT", null), "save-pgr-request");

        Map<String, Object> event = published();
        assertEquals("COMPLAINTS.WORKFLOW.APPLY.PENDINGFORASSIGNMENT", event.get("eventName"));
        assertEquals(COMPLAINT + ":APPLY:PENDINGFORASSIGNMENT:" + PI_ID, event.get("transactionSeed"));
        assertFalse(at(event, "actors").containsKey("assignee"));
        verify(hrmsUtils, never()).getHRMSURI(anyList(), anyString());
    }

    @Test
    void assignSendsTheLiveAssigneeUuidOnlyAndKeysHrmsOnIt() {
        service.process(request("ASSIGN", "PENDINGATLME", List.of(LIVE_UUID)), "update-pgr-request");

        Map<String, Object> event = published();
        assertEquals(Map.of("userId", LIVE_UUID, "type", "EMPLOYEE"), at(event, "actors", "assignee"));
        assertEquals("Live Assignee", at(event, "data").get("emp_name"));
        verify(hrmsUtils).getHRMSURI(List.of(LIVE_UUID), TENANT);
        assertEquals(List.of("COMMON_MASTERS_DEPARTMENT_DEPT_25"), at(event, "localized").get("emp_department"));
        assertEquals(List.of("COMMON_MASTERS_DESIGNATION_AE_OF_" + LIVE_UUID), at(event, "localized").get("emp_designation"));
    }

    /** Vinoth #10: RESOLVE carries no assignes; the designation must be the history assignee's own. */
    @Test
    void resolveTakesTheAssigneeFromHistoryAndKeysHrmsOnThatUuid() {
        history.add(assignInHistory(HISTORY_UUID));

        service.process(request("RESOLVE", "RESOLVED", new ArrayList<>()), "update-pgr-request");

        Map<String, Object> event = published();
        assertEquals(Map.of("userId", HISTORY_UUID, "type", "EMPLOYEE"), at(event, "actors", "assignee"));
        verify(hrmsUtils).getHRMSURI(List.of(HISTORY_UUID), TENANT);
        verify(hrmsUtils, never()).getHRMSURI(eq(List.of()), anyString());
        assertEquals(List.of("COMMON_MASTERS_DESIGNATION_AE_OF_" + HISTORY_UUID),
                at(event, "localized").get("emp_designation"));
    }

    @Test
    void failedUserLookupSendsTheHistoryRecordInline() {
        userServiceDown = true;
        history.add(assignInHistory(HISTORY_UUID));

        service.process(request("REOPEN", "PENDINGATLME", null), "update-pgr-request");

        Map<String, Object> event = published();
        assertEquals(Map.of("userId", HISTORY_UUID, "type", "EMPLOYEE", "name", "History Assignee", "phone", "0722000111"),
                at(event, "actors", "assignee"));
        assertEquals("History Assignee", at(event, "data").get("emp_name"));
    }

    @Test
    void noProcessInstanceInHistoryStillPublishesWithNobodyAssigned() {
        // history stays empty: the search answers with no process instances (WORKFLOW_NOT_FOUND).
        service.process(request("RATE", "CLOSEDAFTERRESOLUTION", null), "update-pgr-request");

        Map<String, Object> event = published();
        assertEquals("COMPLAINTS.WORKFLOW.RATE.CLOSEDAFTERRESOLUTION", event.get("eventName"));
        assertEquals("COMPLAINTS.WORKFLOW.RATE", event.get("ledgerEventName"));
        assertFalse(at(event, "actors").containsKey("assignee"));
        assertFalse(at(event, "localized").containsKey("emp_designation"));
        verify(hrmsUtils, never()).getHRMSURI(anyList(), anyString());
    }

    @Test
    void shortenerFailureBlanksTheDownloadLink() {
        when(notificationUtil.getShortnerURL(anyString())).thenThrow(new RuntimeException("shortener down"));

        service.process(request("APPLY", "PENDINGFORASSIGNMENT", null), "save-pgr-request");

        assertEquals("", at(published(), "data").get("download_link"));
    }

    @Test
    void noActionMeansNoEvent() {
        service.process(request(null, "PENDINGFORASSIGNMENT", null), "save-pgr-request");
        verify(producer, never()).push(any(), any(), any());
    }
}
