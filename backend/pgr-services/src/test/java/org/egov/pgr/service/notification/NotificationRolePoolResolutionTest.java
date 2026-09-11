package org.egov.pgr.service.notification;

import org.egov.common.contract.request.RequestInfo;
import org.egov.common.utils.MultiStateInstanceUtil;
import org.egov.pgr.config.PGRConfiguration;
import org.egov.pgr.producer.Producer;
import org.egov.pgr.repository.ServiceRequestRepository;
import org.egov.pgr.service.NotificationService;
import org.egov.pgr.service.WorkflowService;
import org.egov.pgr.util.HRMSUtil;
import org.egov.pgr.util.MDMSUtils;
import org.egov.pgr.util.NotificationUtil;
import org.egov.pgr.web.models.AuditDetails;
import org.egov.pgr.web.models.Service;
import org.egov.pgr.web.models.ServiceRequest;
import org.egov.pgr.web.models.User;
import org.egov.pgr.web.models.Workflow;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import com.fasterxml.jackson.databind.ObjectMapper;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Pins the role-pool resolver (B5): a role audience that spans more than one egov-user page must
 * be fully paginated (pageSize/pageNumber loop), and a uuid appearing on more than one page must be
 * notified exactly once. Without pagination a 100+ holder pool silently truncates to the first page.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
public class NotificationRolePoolResolutionTest {

    private static final String TENANT = "ke.bomet";
    private static final String TOPIC = "complaints.domain.events";

    @Mock private PGRConfiguration config;
    @Mock private NotificationUtil notificationUtil;
    @Mock private WorkflowService workflowService;
    @Mock private ServiceRequestRepository serviceRequestRepository;
    @Mock private MDMSUtils mdmsUtils;
    @Mock private HRMSUtil hrmsUtils;
    @Mock private ObjectMapper mapper;
    @Mock private MultiStateInstanceUtil centralInstanceUtil;
    @Mock private NotificationRouter notificationRouter;
    @Mock private TemplateRenderer templateRenderer;
    @Mock private Producer producer;

    @InjectMocks
    private NotificationService notificationService;

    @BeforeEach
    void setUp() {
        when(config.getNotificationConfigDriven()).thenReturn(true);
        when(config.getNotificationDefaultLocale()).thenReturn("en_IN");
        when(config.getComplaintsDomainEventsTopic()).thenReturn(TOPIC);
        when(config.getMobileDownloadLink()).thenReturn("http://app/download");
        when(config.getUserHost()).thenReturn("http://user/");
        when(config.getUserSearchEndpoint()).thenReturn("user/_search");
        when(config.getEgovInternalMicroserviceUserUuid()).thenReturn("internal-uuid");
        when(config.getNotificationRolePoolPageSize()).thenReturn(100);
        when(config.getNotificationRolePoolMaxPages()).thenReturn(10);

        // A single SMS row for a role-pool audience (not CITIZEN/EMPLOYEE).
        when(notificationRouter.route(eq(TENANT), eq("PGR"), any(), eq("ASSIGN"), eq("PENDINGATLME")))
                .thenReturn(Collections.singletonList(new RoutingMatch("PGR_LME", "SMS")));
        when(templateRenderer.render(anyString(), anyString(), anyString(), anyString(),
                anyString(), anyString(), any())).thenReturn("BODY-SMS");
        when(notificationUtil.getLocalizationMessages(anyString(), any(), anyString())).thenReturn("{}");
        when(notificationUtil.getShortnerURL(anyString())).thenReturn("http://short/x");
    }

    private ServiceRequest assignRequest() {
        User citizen = User.builder()
                .uuid("citizen-uuid").name("Jane Doe")
                .mobileNumber("712345678").countryCode("+254").emailId("jane@example.com")
                .build();
        Service service = Service.builder()
                .tenantId(TENANT)
                .serviceRequestId("PGR-2026-001")
                .applicationStatus("PENDINGATLME")
                .serviceCode("GarbageNeeds")
                .citizen(citizen)
                .auditDetails(AuditDetails.builder().createdTime(1719600000000L).createdBy("citizen-uuid").build())
                .build();
        Workflow workflow = Workflow.builder().action("ASSIGN").assignes(Collections.emptyList()).build();
        return ServiceRequest.builder()
                .requestInfo(new RequestInfo())
                .service(service)
                .workflow(workflow)
                .build();
    }

    private LinkedHashMap<String, Object> userRow(String uuid, String mobile) {
        LinkedHashMap<String, Object> m = new LinkedHashMap<>();
        m.put("uuid", uuid);
        m.put("name", uuid);
        m.put("mobileNumber", mobile);
        m.put("countryCode", "+254");
        m.put("emailId", uuid + "@gov.ke");
        return m;
    }

    private LinkedHashMap<String, Object> page(List<LinkedHashMap<String, Object>> users) {
        LinkedHashMap<String, Object> resp = new LinkedHashMap<>();
        resp.put("user", users);
        return resp;
    }

    /**
     * Answer only role-pool searches (the request map carries roleCodes); return page 0 or page 1
     * by pageNumber. Every other fetchResult call (placeholder enrichment via
     * getEmployeeName/getHRMSEmployee) returns null and is handled gracefully by the service.
     */
    @SuppressWarnings("unchecked")
    private void stubTwoPages(LinkedHashMap<String, Object> page0, LinkedHashMap<String, Object> page1) {
        when(serviceRequestRepository.fetchResult(any(StringBuilder.class), any()))
                .thenAnswer(inv -> {
                    Object req = inv.getArgument(1);
                    if (req instanceof Map && ((Map<String, Object>) req).containsKey("roleCodes")) {
                        int pg = (Integer) ((Map<String, Object>) req).get("pageNumber");
                        return pg == 0 ? page0 : page1;
                    }
                    return null;
                });
    }

    @Test
    void rolePool_paginatesAcrossTwoPages_emitsOneEventPerHolder() {
        List<LinkedHashMap<String, Object>> p0 = new ArrayList<>();
        for (int i = 0; i < 100; i++) p0.add(userRow("lme-" + i, "7" + String.format("%08d", i)));
        List<LinkedHashMap<String, Object>> p1 = new ArrayList<>();
        for (int i = 100; i < 103; i++) p1.add(userRow("lme-" + i, "7" + String.format("%08d", i)));
        stubTwoPages(page(p0), page(p1));

        notificationService.process(assignRequest(), "save-pgr-request");

        // First page (100, == pageSize) forces a second fetch; 100 + 3 distinct holders -> 103 events.
        verify(producer, times(103)).push(eq(TENANT), eq(TOPIC), any());
    }

    @Test
    void rolePool_duplicateUuidAcrossPages_countedOnce() {
        List<LinkedHashMap<String, Object>> p0 = new ArrayList<>();
        p0.add(userRow("dup", "711111111"));
        for (int i = 0; i < 99; i++) p0.add(userRow("lme-" + i, "7" + String.format("%08d", i)));
        // p0 size == 100 -> a second page is fetched; it re-lists the same uuid.
        List<LinkedHashMap<String, Object>> p1 = new ArrayList<>();
        p1.add(userRow("dup", "711111111"));
        stubTwoPages(page(p0), page(p1));

        notificationService.process(assignRequest(), "save-pgr-request");

        // 100 distinct holders on page 0; page 1's duplicate uuid is dropped -> 100 events, not 101.
        verify(producer, times(100)).push(eq(TENANT), eq(TOPIC), any());
    }
}
