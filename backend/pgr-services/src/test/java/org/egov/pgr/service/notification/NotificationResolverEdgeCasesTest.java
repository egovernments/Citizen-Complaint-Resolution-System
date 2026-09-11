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

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.atLeast;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Resolver edge cases at the emission level (PGR-1, gap G4): drives {@link NotificationService#process}
 * on the config-driven path and asserts how each audience/contact/failure shape maps to the number and
 * shape of events pushed. The harness is a copy of {@link NotificationConfigDrivenEmissionTest} (same 11
 * mocks, same setUp), so these tests exercise the real resolve/dedupe/contact-gate logic while stubbing
 * only the router, the renderer, and the egov-user/HRMS HTTP hops.
 *
 * Covers the resolver corners the happy-path emission test does not: empty role pools, per-member contact
 * gaps, per-channel contact filtering (post-W3), assignee-only collapse, the EMPLOYEE alias, the
 * defensive AUTO_ESCALATE/SYSTEM drop, cross-audience dedupe when a citizen also holds a routed role, and
 * graceful degradation when the user search fails. Also pins the single-locale KNOWN LIMITATION on
 * {@code processConfigDriven} (per-recipient locale is not implemented — every render uses the instance
 * default locale).
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
public class NotificationResolverEdgeCasesTest {

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

        // Default router stub (overridden per test). Mirrors the emission harness.
        when(notificationRouter.route(eq(TENANT), eq("PGR"), any(), eq("ASSIGN"), eq("PENDINGATLME")))
                .thenReturn(Collections.singletonList(new RoutingMatch("CITIZEN", "SMS")));

        // Renderer returns a per-channel body so we can assert each channel was rendered+emitted.
        when(templateRenderer.render(anyString(), anyString(), anyString(), anyString(),
                anyString(), anyString(), any()))
                .thenAnswer(inv -> "BODY-" + inv.getArgument(4)); // arg 4 = channel

        // Placeholder enrichment helpers (best-effort, all in try/catch in the service).
        when(notificationUtil.getLocalizationMessages(anyString(), any(), anyString())).thenReturn("{}");
        when(notificationUtil.getShortnerURL(anyString())).thenReturn("http://short/x");
    }

    // ----------------------------------------------------------------------------------------------
    // Request builders
    // ----------------------------------------------------------------------------------------------

    private ServiceRequest assignRequest(List<String> assignes) {
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
        Workflow workflow = Workflow.builder().action("ASSIGN").assignes(assignes).build();
        return ServiceRequest.builder()
                .requestInfo(new RequestInfo())
                .service(service)
                .workflow(workflow)
                .build();
    }

    private ServiceRequest assignRequest() {
        return assignRequest(Collections.emptyList());
    }

    // ----------------------------------------------------------------------------------------------
    // Role-pool stubbing (copied verbatim from NotificationConfigDrivenEmissionTest)
    // ----------------------------------------------------------------------------------------------

    /** Stub egov-user _search to return the given (uuid, mobile, email) users for a roleCodes query. */
    @SuppressWarnings("unchecked")
    private void stubRolePool(LinkedHashMap<String, Object>... users) {
        when(config.getUserHost()).thenReturn("http://user/");
        when(config.getUserSearchEndpoint()).thenReturn("user/_search");
        when(config.getEgovInternalMicroserviceUserUuid()).thenReturn("internal-uuid");
        LinkedHashMap<String, Object> response = new LinkedHashMap<>();
        response.put("user", Arrays.asList(users));
        when(serviceRequestRepository.fetchResult(any(StringBuilder.class), any()))
                .thenReturn(response);
    }

    private LinkedHashMap<String, Object> userRow(String uuid, String name, String mobile, String email) {
        LinkedHashMap<String, Object> m = new LinkedHashMap<>();
        m.put("uuid", uuid);
        m.put("name", name);
        m.put("mobileNumber", mobile);
        m.put("countryCode", "+254");
        m.put("emailId", email);
        m.put("createdDate", null);
        return m;
    }

    /** A holder with neither a phone nor an email (dropped by the contact-presence gate). */
    private LinkedHashMap<String, Object> userRowNoContact(String uuid, String name) {
        LinkedHashMap<String, Object> m = new LinkedHashMap<>();
        m.put("uuid", uuid);
        m.put("name", name);
        m.put("mobileNumber", null);
        m.put("countryCode", null);
        m.put("emailId", null);
        m.put("createdDate", null);
        return m;
    }

    /** A holder with a phone but no email — reachable for SMS/WHATSAPP, not for EMAIL. */
    private LinkedHashMap<String, Object> userRowPhoneOnly(String uuid, String name, String mobile) {
        return userRow(uuid, name, mobile, null);
    }

    /**
     * Stub egov-user _search + the (mocked) ObjectMapper so {@code fetchUserByUUID} resolves a single
     * assignee. The raw row carries a parseable createdDate so {@code parseResponse} doesn't blow up,
     * and {@code mapper.convertValue(..)} returns the mapped assignee User.
     */
    private void stubAssigneeUser(String uuid, String name, String mobile, String email) {
        when(config.getUserHost()).thenReturn("http://user/");
        when(config.getUserSearchEndpoint()).thenReturn("user/_search");
        when(config.getEgovInternalMicroserviceUserUuid()).thenReturn("internal-uuid");
        // fetchUserByUUID runs parseResponse, which MUTATES the raw row's createdDate String -> Long in
        // place. The assignee is resolved more than once per process() (once for placeholders, once in
        // the emission loop), so hand back a FRESH map every call — a shared map would blow up on the
        // second parseResponse with a ClassCastException.
        when(serviceRequestRepository.fetchResult(any(StringBuilder.class), any()))
                .thenAnswer(inv -> {
                    LinkedHashMap<String, Object> raw = new LinkedHashMap<>();
                    raw.put("uuid", uuid);
                    raw.put("name", name);
                    raw.put("mobileNumber", mobile);
                    raw.put("countryCode", "+254");
                    raw.put("emailId", email);
                    raw.put("createdDate", "01-01-2020 00:00:00"); // dd-MM-yyyy HH:mm:ss — parseResponse-safe
                    LinkedHashMap<String, Object> response = new LinkedHashMap<>();
                    response.put("user", new ArrayList<>(Collections.singletonList(raw)));
                    return response;
                });
        User mapped = User.builder()
                .uuid(uuid).name(name).mobileNumber(mobile).countryCode("+254").emailId(email).build();
        when(mapper.convertValue(any(), eq(User.class))).thenReturn(mapped);
    }

    /** Assert that no role-pool (roleCodes) user search was ever issued. */
    private void assertNoRolePoolSearch() {
        ArgumentCaptor<Object> req = ArgumentCaptor.forClass(Object.class);
        verify(serviceRequestRepository, atLeast(0)).fetchResult(any(), req.capture());
        for (Object o : req.getAllValues()) {
            if (o instanceof Map) {
                assertFalse(((Map<?, ?>) o).containsKey("roleCodes"),
                        "a role-pool (roleCodes) user search must NOT be issued for an assignee-only/EMPLOYEE audience");
            }
        }
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> asEvent(Object o) {
        return (Map<String, Object>) o;
    }

    // ----------------------------------------------------------------------------------------------
    // 1. Empty role pool
    // ----------------------------------------------------------------------------------------------

    @Test
    void roleWithZeroHolders_emitsNothing_noException() {
        when(notificationRouter.route(eq(TENANT), eq("PGR"), any(), eq("ASSIGN"), eq("PENDINGATLME")))
                .thenReturn(Collections.singletonList(new RoutingMatch("GRO", "SMS")));
        stubRolePool(); // {"user": []}

        notificationService.process(assignRequest(), "save-pgr-request");

        verify(producer, never()).push(anyString(), anyString(), any());
    }

    // ----------------------------------------------------------------------------------------------
    // 2. Empty pool row does not suppress a sibling row
    // ----------------------------------------------------------------------------------------------

    @Test
    void zeroHolderRole_doesNotAffect_otherMatches() {
        when(notificationRouter.route(eq(TENANT), eq("PGR"), any(), eq("ASSIGN"), eq("PENDINGATLME")))
                .thenReturn(Arrays.asList(new RoutingMatch("GRO", "SMS"), new RoutingMatch("CITIZEN", "SMS")));
        stubRolePool(); // GRO pool empty; CITIZEN comes from the request, not the pool.

        notificationService.process(assignRequest(), "save-pgr-request");

        ArgumentCaptor<Object> evt = ArgumentCaptor.forClass(Object.class);
        verify(producer, times(1)).push(eq(TENANT), eq(TOPIC), evt.capture());
        Map<String, Object> contact = asEvent(evt.getValue()).get("contact") == null
                ? Collections.emptyMap() : (Map<String, Object>) asEvent(evt.getValue()).get("contact");
        assertEquals("CITIZEN", contact.get("type"));
    }

    // ----------------------------------------------------------------------------------------------
    // 3. Contactless pool member is skipped, the rest are notified
    // ----------------------------------------------------------------------------------------------

    @Test
    void holderWithNoContact_isSkipped_restOfPoolNotified() {
        when(notificationRouter.route(eq(TENANT), eq("PGR"), any(), eq("ASSIGN"), eq("PENDINGATLME")))
                .thenReturn(Collections.singletonList(new RoutingMatch("GRO", "SMS")));
        // Middle member has neither phone nor email; the contact-presence gate drops only that member.
        stubRolePool(
                userRow("lme-1", "Officer One", "711111111", "one@gov.ke"),
                userRowNoContact("lme-2", "Officer Ghost"),
                userRow("lme-3", "Officer Three", "733333333", "three@gov.ke"));

        notificationService.process(assignRequest(), "save-pgr-request");

        verify(producer, times(2)).push(eq(TENANT), eq(TOPIC), any());
    }

    // ----------------------------------------------------------------------------------------------
    // 4. Per-channel contact filtering (post-W3): phone-only holder on an EMAIL row -> 0 pushes
    // ----------------------------------------------------------------------------------------------

    @Test
    void phoneOnlyHolder_onEmailRow_isSkippedPerChannel() {
        when(notificationRouter.route(eq(TENANT), eq("PGR"), any(), eq("ASSIGN"), eq("PENDINGATLME")))
                .thenReturn(Collections.singletonList(new RoutingMatch("GRO", "EMAIL")));
        // Holder is reachable by phone but has no email; an EMAIL row must NOT phantom-send to them.
        stubRolePool(userRowPhoneOnly("lme-1", "Officer One", "711111111"));

        notificationService.process(assignRequest(), "save-pgr-request");

        verify(producer, never()).push(anyString(), anyString(), any());
    }

    // ----------------------------------------------------------------------------------------------
    // 5. assigneeOnly=true collapses a role pool down to the named assignee (no pool search)
    // ----------------------------------------------------------------------------------------------

    @Test
    void assigneeOnlyTrue_restrictsPoolToAssignee() {
        when(notificationRouter.route(eq(TENANT), eq("PGR"), any(), eq("ASSIGN"), eq("PENDINGATLME")))
                .thenReturn(Collections.singletonList(new RoutingMatch("PGR_LME", "SMS", true)));
        stubAssigneeUser("assignee-uuid", "Assignee One", "799999999", "assignee@gov.ke");

        notificationService.process(assignRequest(Collections.singletonList("assignee-uuid")), "save-pgr-request");

        ArgumentCaptor<Object> evt = ArgumentCaptor.forClass(Object.class);
        verify(producer, times(1)).push(eq(TENANT), eq(TOPIC), evt.capture());
        Map<String, Object> contact = (Map<String, Object>) asEvent(evt.getValue()).get("contact");
        assertEquals("EMPLOYEE", contact.get("type"));
        assertEquals(TENANT + ":assignee-uuid", asEvent(evt.getValue()).get("subscriberId"));
        assertNoRolePoolSearch();
    }

    // ----------------------------------------------------------------------------------------------
    // 6. EMPLOYEE alias resolves the single assignee, never the role pool
    // ----------------------------------------------------------------------------------------------

    @Test
    void employeeAlias_resolvesAssignee_notRolePool() {
        when(notificationRouter.route(eq(TENANT), eq("PGR"), any(), eq("ASSIGN"), eq("PENDINGATLME")))
                .thenReturn(Collections.singletonList(new RoutingMatch("EMPLOYEE", "SMS")));
        stubAssigneeUser("assignee-uuid", "Assignee One", "799999999", "assignee@gov.ke");

        notificationService.process(assignRequest(Collections.singletonList("assignee-uuid")), "save-pgr-request");

        ArgumentCaptor<Object> evt = ArgumentCaptor.forClass(Object.class);
        verify(producer, times(1)).push(eq(TENANT), eq(TOPIC), evt.capture());
        Map<String, Object> contact = (Map<String, Object>) asEvent(evt.getValue()).get("contact");
        assertEquals("EMPLOYEE", contact.get("type"));
        assertNoRolePoolSearch();
    }

    // ----------------------------------------------------------------------------------------------
    // 7. AUTO_ESCALATE / SYSTEM audiences resolve to nobody (defensive, independent of the router drop)
    // ----------------------------------------------------------------------------------------------

    @Test
    void autoEscalateAndSystem_resolveToEmpty_defensively() {
        when(notificationRouter.route(eq(TENANT), eq("PGR"), any(), eq("ASSIGN"), eq("PENDINGATLME")))
                .thenReturn(Arrays.asList(
                        new RoutingMatch("AUTO_ESCALATE", "SMS"),
                        new RoutingMatch("SYSTEM", "SMS")));

        notificationService.process(assignRequest(), "save-pgr-request");

        verify(producer, never()).push(anyString(), anyString(), any());
    }

    // ----------------------------------------------------------------------------------------------
    // 8. A citizen who also holds a routed role gets exactly one message per channel (cross-audience dedupe)
    // ----------------------------------------------------------------------------------------------

    @Test
    void citizenAlsoHoldingRoutedRole_getsOneMessagePerChannel() {
        when(notificationRouter.route(eq(TENANT), eq("PGR"), any(), eq("ASSIGN"), eq("PENDINGATLME")))
                .thenReturn(Arrays.asList(new RoutingMatch("CITIZEN", "SMS"), new RoutingMatch("GRO", "SMS")));
        // GRO pool contains the citizen (same uuid) plus one other member.
        stubRolePool(
                userRow("citizen-uuid", "Jane Doe", "712345678", "jane@example.com"),
                userRow("other-uuid", "Officer Other", "722222222", "other@gov.ke"));

        notificationService.process(assignRequest(), "save-pgr-request");

        ArgumentCaptor<Object> evt = ArgumentCaptor.forClass(Object.class);
        verify(producer, times(2)).push(eq(TENANT), eq(TOPIC), evt.capture());

        java.util.Set<String> subscribers = new java.util.HashSet<>();
        for (Object o : evt.getAllValues()) {
            subscribers.add((String) asEvent(o).get("subscriberId"));
        }
        assertEquals(new java.util.HashSet<>(Arrays.asList(TENANT + ":citizen-uuid", TENANT + ":other-uuid")),
                subscribers);
    }

    // ----------------------------------------------------------------------------------------------
    // 9. User-search failure on one row degrades gracefully; sibling rows still notify
    // ----------------------------------------------------------------------------------------------

    @Test
    void userSearchFailure_gracefulSkip_othersUnaffected() {
        when(notificationRouter.route(eq(TENANT), eq("PGR"), any(), eq("ASSIGN"), eq("PENDINGATLME")))
                .thenReturn(Arrays.asList(new RoutingMatch("GRO", "SMS"), new RoutingMatch("CITIZEN", "SMS")));
        when(config.getUserHost()).thenReturn("http://user/");
        when(config.getUserSearchEndpoint()).thenReturn("user/_search");
        when(config.getEgovInternalMicroserviceUserUuid()).thenReturn("internal-uuid");
        // The role-pool search throws; the resolver swallows it and returns an empty pool for GRO.
        when(serviceRequestRepository.fetchResult(any(StringBuilder.class), any()))
                .thenThrow(new RuntimeException("user search down"));

        notificationService.process(assignRequest(), "save-pgr-request");

        // CITIZEN (resolved from the request, not the search) still gets its SMS.
        ArgumentCaptor<Object> evt = ArgumentCaptor.forClass(Object.class);
        verify(producer, times(1)).push(eq(TENANT), eq(TOPIC), evt.capture());
        Map<String, Object> contact = (Map<String, Object>) asEvent(evt.getValue()).get("contact");
        assertEquals("CITIZEN", contact.get("type"));
    }

    // ----------------------------------------------------------------------------------------------
    // PGR-4: single-locale KNOWN LIMITATION — every render uses the instance default locale.
    // ----------------------------------------------------------------------------------------------

    @Test
    void renderUsesInstanceDefaultLocale() {
        // Two audiences (CITIZEN + a role pool) so the renderer is driven for more than one recipient.
        when(notificationRouter.route(eq(TENANT), eq("PGR"), any(), eq("ASSIGN"), eq("PENDINGATLME")))
                .thenReturn(Arrays.asList(new RoutingMatch("CITIZEN", "SMS"), new RoutingMatch("GRO", "SMS")));
        stubRolePool(userRow("lme-1", "Officer One", "711111111", "one@gov.ke"));

        notificationService.process(assignRequest(), "save-pgr-request");

        // Renderer's locale argument (index 5) is the instance default for every recipient — per-recipient
        // locale is a documented KNOWN LIMITATION of processConfigDriven and is NOT resolved yet.
        ArgumentCaptor<String> localeArg = ArgumentCaptor.forClass(String.class);
        verify(templateRenderer, atLeastOnce()).render(anyString(), anyString(), anyString(), anyString(),
                anyString(), localeArg.capture(), any());
        for (String l : localeArg.getAllValues()) {
            assertEquals("en_IN", l);
        }

        // The event Contact.locale carried to the bridge is likewise the instance default for every recipient.
        ArgumentCaptor<Object> evt = ArgumentCaptor.forClass(Object.class);
        verify(producer, times(2)).push(eq(TENANT), eq(TOPIC), evt.capture());
        for (Object o : evt.getAllValues()) {
            Map<String, Object> contact = (Map<String, Object>) asEvent(o).get("contact");
            assertEquals("en_IN", contact.get("locale"));
        }
    }
}
