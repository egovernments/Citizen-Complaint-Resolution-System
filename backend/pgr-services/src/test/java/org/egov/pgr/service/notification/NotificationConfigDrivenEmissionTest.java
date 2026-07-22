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
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import com.fasterxml.jackson.databind.ObjectMapper;

import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.startsWith;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * End-to-end (service-layer) proof of the TRIGGER: a single workflow transition (ASSIGN), processed
 * with the config-driven flag ON, fans out to ONE pre-rendered event per (recipient x channel) on
 * complaints.domain.events — including SMS, WHATSAPP and EMAIL. This is the "drive an action ->
 * notification triggered" assertion; novu-bridge's pass-through tests then prove each event is
 * dispatched via the per-channel Novu workflow (channels without an enabled provider are SKIPPED at the bridge).
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
public class NotificationConfigDrivenEmissionTest {

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
        when(config.getNotificationRolePoolPageSize()).thenReturn(100);
        when(config.getNotificationRolePoolMaxPages()).thenReturn(10);

        // Routing: CITIZEN over all three channels for ASSIGN -> PENDINGATLME (one flat row per channel).
        when(notificationRouter.route(eq(TENANT), eq("PGR"), any(), eq("ASSIGN"), eq("PENDINGATLME")))
                .thenReturn(Arrays.asList(
                        new RoutingMatch("CITIZEN", "SMS"),
                        new RoutingMatch("CITIZEN", "WHATSAPP"),
                        new RoutingMatch("CITIZEN", "EMAIL")));

        // Renderer returns a per-channel body so we can assert each channel was rendered+emitted.
        when(templateRenderer.render(anyString(), anyString(), anyString(), anyString(),
                anyString(), anyString(), any()))
                .thenAnswer(inv -> "BODY-" + inv.getArgument(4)); // arg 4 = channel

        // Placeholder enrichment helpers (best-effort, all in try/catch in the service).
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

    @Test
    @SuppressWarnings("unchecked")
    void assignTransition_emitsOneEventPerChannel_smsWhatsappEmail() {
        notificationService.process(assignRequest(), "save-pgr-request");

        ArgumentCaptor<Object> evt = ArgumentCaptor.forClass(Object.class);
        verify(producer, times(3)).push(eq(TENANT), eq(TOPIC), evt.capture());

        List<Object> events = evt.getAllValues();
        // Index by channel
        java.util.Map<String, Map<String, Object>> byChannel = new java.util.HashMap<>();
        for (Object o : events) {
            Map<String, Object> e = (Map<String, Object>) o;
            byChannel.put((String) e.get("channel"), e);
        }

        assertEquals(new java.util.HashSet<>(Arrays.asList("SMS", "WHATSAPP", "EMAIL")),
                byChannel.keySet());

        for (String ch : Arrays.asList("SMS", "WHATSAPP", "EMAIL")) {
            Map<String, Object> e = byChannel.get(ch);
            assertEquals("BODY-" + ch, e.get("renderedBody"));
            assertEquals("COMPLAINTS.WORKFLOW.ASSIGN", e.get("eventName"));
            assertEquals(TENANT + ":citizen-uuid", e.get("subscriberId"));
            assertEquals("PGR-2026-001:ASSIGN:PENDINGATLME:" + TENANT + ":citizen-uuid:" + ch,
                    e.get("transactionId"));
            Map<String, Object> contact = (Map<String, Object>) e.get("contact");
            assertEquals("CITIZEN", contact.get("type"));
            assertEquals("+254712345678", contact.get("phone"));
            assertEquals("jane@example.com", contact.get("email"));
        }
    }

    @Test
    void flagOff_doesNotUseConfigDrivenPath() {
        when(config.getNotificationConfigDriven()).thenReturn(false);
        // Legacy path will bail early (no NOTIFICATION_ENABLE_FOR_STATUS match / missing deps),
        // but crucially it must NOT invoke the config-driven router.
        notificationService.process(assignRequest(), "save-pgr-request");
        verify(notificationRouter, org.mockito.Mockito.never())
                .route(anyString(), anyString(), any(), anyString(), anyString());
    }

    /**
     * Pins the localization key prefix used in the legacy (config-driven=false) path.
     * NotificationService.getFinalMessage() must call getCustomizedMsgForPlaceholder with
     * "COMPLAINT_HIERARCHY.<serviceCode>", NOT the old "pgr.complaint.category.<serviceCode>".
     *
     * The test drives the APPLY->PENDINGFORASSIGNMENT transition because "APPLY_PENDINGFORASSIGNMENT"
     * is in NOTIFICATION_ENABLE_FOR_STATUS and the branch reaches line 522 without any HTTP calls
     * (no assignee lookup needed).
     */
    @Test
    void legacyPath_complaintLocalizationLookup_usesComplaintHierarchyPrefix() {
        when(config.getNotificationConfigDriven()).thenReturn(false);

        // Stub the citizen body and default msg so getFinalMessage() does not bail before line 522.
        when(notificationUtil.getCustomizedMsg(eq("APPLY"), eq("PENDINGFORASSIGNMENT"), eq("CITIZEN"), anyString()))
                .thenReturn("Dear Citizen, your complaint {complaint_type} has been filed.");
        when(notificationUtil.getDefaultMsg(eq("CITIZEN"), anyString())).thenReturn("Default notification.");
        when(notificationUtil.getCustomizedMsgForPlaceholder(anyString(), startsWith("COMPLAINT_HIERARCHY.")))
                .thenReturn("Garbage Not Collected");
        when(notificationUtil.getShortnerURL(anyString())).thenReturn("http://short/x");

        User citizen = User.builder()
                .uuid("citizen-uuid").name("Jane Doe")
                .mobileNumber("712345678").countryCode("+254").emailId("jane@example.com")
                .build();
        Service service = Service.builder()
                .tenantId(TENANT)
                .serviceRequestId("PGR-2026-001")
                .applicationStatus("PENDINGFORASSIGNMENT")
                .serviceCode("GarbageNeeds")
                .citizen(citizen)
                .auditDetails(AuditDetails.builder().createdTime(1719600000000L).createdBy("citizen-uuid").build())
                .build();
        Workflow workflow = Workflow.builder().action("APPLY").assignes(Collections.emptyList()).build();
        ServiceRequest applyRequest = ServiceRequest.builder()
                .requestInfo(new RequestInfo()).service(service).workflow(workflow).build();

        notificationService.process(applyRequest, "save-pgr-request");

        // The localization key for complaint type MUST use the COMPLAINT_HIERARCHY prefix.
        verify(notificationUtil).getCustomizedMsgForPlaceholder(anyString(), eq("COMPLAINT_HIERARCHY.GarbageNeeds"));
    }

    /** Stub egov-user _search to return the given (uuid, mobile, email) users for a roleCodes query. */
    @SuppressWarnings("unchecked")
    private void stubRolePool(java.util.LinkedHashMap<String, Object>... users) {
        when(config.getUserHost()).thenReturn("http://user/");
        when(config.getUserSearchEndpoint()).thenReturn("user/_search");
        when(config.getEgovInternalMicroserviceUserUuid()).thenReturn("internal-uuid");
        java.util.LinkedHashMap<String, Object> response = new java.util.LinkedHashMap<>();
        response.put("user", Arrays.asList(users));
        when(serviceRequestRepository.fetchResult(any(StringBuilder.class), any()))
                .thenReturn(response);
    }

    private java.util.LinkedHashMap<String, Object> userRow(String uuid, String name,
                                                            String mobile, String email) {
        java.util.LinkedHashMap<String, Object> m = new java.util.LinkedHashMap<>();
        m.put("uuid", uuid);
        m.put("name", name);
        m.put("mobileNumber", mobile);
        m.put("countryCode", "+254");
        m.put("emailId", email);
        m.put("createdDate", null);
        return m;
    }

    @Test
    @SuppressWarnings("unchecked")
    void roleAudience_fansOutToPool_oneEventPerPoolMember() {
        // Routing: a single SMS row for role PGR_LME (a pool audience, not CITIZEN/EMPLOYEE).
        when(notificationRouter.route(eq(TENANT), eq("PGR"), any(), eq("ASSIGN"), eq("PENDINGATLME")))
                .thenReturn(Collections.singletonList(new RoutingMatch("PGR_LME", "SMS")));
        // Pool has two members with valid contacts -> two events.
        stubRolePool(
                userRow("lme-1", "Officer One", "711111111", "one@gov.ke"),
                userRow("lme-2", "Officer Two", "722222222", "two@gov.ke"));

        notificationService.process(assignRequest(), "save-pgr-request");

        ArgumentCaptor<Object> evt = ArgumentCaptor.forClass(Object.class);
        verify(producer, times(2)).push(eq(TENANT), eq(TOPIC), evt.capture());

        java.util.Set<String> subscribers = new java.util.HashSet<>();
        for (Object o : evt.getAllValues()) {
            Map<String, Object> e = (Map<String, Object>) o;
            assertEquals("SMS", e.get("channel"));
            assertEquals("BODY-SMS", e.get("renderedBody"));
            Map<String, Object> contact = (Map<String, Object>) e.get("contact");
            assertEquals("PGR_LME", contact.get("type"));
            subscribers.add((String) e.get("subscriberId"));
        }
        assertEquals(new java.util.HashSet<>(Arrays.asList(TENANT + ":lme-1", TENANT + ":lme-2")),
                subscribers);
    }

    @Test
    @SuppressWarnings("unchecked")
    void dedupe_collapsesDuplicateChannelSubscriber_acrossTwoRoles() {
        // The same user holds two notified roles (PGR_LME and GRO), both over SMS. The user must
        // get exactly ONE message per channel: dedupe key is (channel|subscriber), not audience.
        when(notificationRouter.route(eq(TENANT), eq("PGR"), any(), eq("ASSIGN"), eq("PENDINGATLME")))
                .thenReturn(Arrays.asList(
                        new RoutingMatch("PGR_LME", "SMS"),
                        new RoutingMatch("GRO", "SMS")));
        // Both role searches return the same single user -> 2 matches but 1 emitted event.
        stubRolePool(userRow("dual-role", "Dual Holder", "733333333", "dual@gov.ke"));

        notificationService.process(assignRequest(), "save-pgr-request");

        ArgumentCaptor<Object> evt = ArgumentCaptor.forClass(Object.class);
        verify(producer, times(1)).push(eq(TENANT), eq(TOPIC), evt.capture());
        Map<String, Object> e = (Map<String, Object>) evt.getValue();
        assertEquals(TENANT + ":dual-role", e.get("subscriberId"));
        assertEquals("SMS", e.get("channel"));
    }

    @Test
    void emailRow_citizenWithoutEmail_isNotEmittedForEmail() {
        // Channel-appropriate contact filtering (B6): a citizen with a phone but no email must NOT
        // produce an EMAIL event (Novu would accept it and the email step would fail invisibly).
        when(notificationRouter.route(eq(TENANT), eq("PGR"), any(), eq("ASSIGN"), eq("PENDINGATLME")))
                .thenReturn(Collections.singletonList(new RoutingMatch("CITIZEN", "EMAIL")));

        User citizen = User.builder()
                .uuid("citizen-uuid").name("Jane Doe")
                .mobileNumber("712345678").countryCode("+254").emailId(null)
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
        ServiceRequest request = ServiceRequest.builder()
                .requestInfo(new RequestInfo()).service(service).workflow(workflow).build();

        notificationService.process(request, "save-pgr-request");

        verify(producer, org.mockito.Mockito.never()).push(anyString(), anyString(), any());
    }

    @Test
    void missingTemplateOnFirstRow_doesNotBlockSecondRowSameSubscriber() {
        // B8: the dedupe key must be consumed only after a successful publish. Two role rows over
        // the same channel resolve to the same single holder; the first row's template is missing.
        when(notificationRouter.route(eq(TENANT), eq("PGR"), any(), eq("ASSIGN"), eq("PENDINGATLME")))
                .thenReturn(Arrays.asList(
                        new RoutingMatch("ROLE_A", "SMS"),
                        new RoutingMatch("ROLE_B", "SMS")));
        // Both role searches return the same single holder.
        stubRolePool(userRow("holder", "Holder", "744444444", "holder@gov.ke"));
        // ROLE_A's template is missing (null); ROLE_B's renders a body.
        when(templateRenderer.render(anyString(), anyString(), anyString(), anyString(),
                anyString(), anyString(), any()))
                .thenAnswer(inv -> "ROLE_A".equals(inv.getArgument(1)) ? null : "BODY");

        notificationService.process(assignRequest(), "save-pgr-request");

        // The burned-early bug would skip ROLE_B; the fix lets ROLE_B publish exactly one event.
        verify(producer, times(1)).push(eq(TENANT), eq(TOPIC), any());
    }
}
