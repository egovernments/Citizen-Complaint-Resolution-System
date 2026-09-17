package org.egov.pgr.service.notification;

import com.fasterxml.jackson.databind.ObjectMapper;
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

import java.util.*;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * Each recipient renders in their own preferredLanguage (digit-user-preferences-service),
 * falling back to the instance default; the event's contact.locale carries what was used.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class NotificationPerRecipientLocaleTest {

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
        when(config.getNotificationDefaultLocale()).thenReturn("en_IN");
        when(config.getComplaintsDomainEventsTopic()).thenReturn(TOPIC);
        when(config.getNotificationRolePoolPageSize()).thenReturn(100);
        when(config.getNotificationRolePoolMaxPages()).thenReturn(10);
        when(config.getNotificationLocalePerRecipient()).thenReturn(true);
        when(config.getUserPreferenceHost()).thenReturn("http://prefs");
        when(config.getUserPreferenceSearchPath()).thenReturn("/user-preference/v1/_search");
        when(config.getNotificationPreferenceCode()).thenReturn("USER_NOTIFICATION_PREFERENCES");
        when(config.getUserHost()).thenReturn("http://user");
        when(config.getUserSearchEndpoint()).thenReturn("/user/_search");
        when(centralInstanceUtil.getStateLevelTenant(anyString())).thenReturn("ke");

        when(notificationRouter.route(eq(TENANT), eq("PGR"), any(), eq("ASSIGN"), eq("PENDINGATLME")))
                .thenReturn(List.of(new RoutingMatch("GRO", "SMS")));
        when(templateRenderer.render(anyString(), anyString(), anyString(), anyString(), anyString(), anyString(), any()))
                .thenAnswer(inv -> "BODY-" + inv.getArgument(5));   // arg 5 = locale
        when(templateRenderer.resolveTemplateKey(anyString(), anyString(), anyString(), anyString(), anyString(), anyString()))
                .thenAnswer(inv -> "GRO.ASSIGN.PENDINGATLME.SMS." + inv.getArgument(5));
        when(notificationUtil.getLocalizationMessages(anyString(), any(), anyString())).thenReturn("{}");
        when(notificationUtil.getShortnerURL(anyString())).thenReturn("http://short/x");

        // One repository answers both the role-pool user search and the preference search.
        when(serviceRequestRepository.fetchResult(any(StringBuilder.class), any())).thenAnswer(inv -> {
            String uri = inv.getArgument(0).toString();
            if (uri.contains("user-preference")) {
                return prefs(Map.of("u1", "hi_IN"));   // u2 has no preference
            }
            Object body = inv.getArgument(1);
            if (body instanceof Map && ((Map<?, ?>) body).containsKey("roleCodes")) {
                LinkedHashMap<String, Object> page = new LinkedHashMap<>();
                page.put("user", List.of(userRow("u1", "Amina"), userRow("u2", "Brian")));
                return page;
            }
            return null;
        });
    }

    private static LinkedHashMap<String, Object> prefs(Map<String, String> langByUuid) {
        List<Map<String, Object>> rows = new ArrayList<>();
        langByUuid.forEach((uuid, lang) -> rows.add(Map.of("userId", uuid, "tenantId", "ke", "payload", Map.of("preferredLanguage", lang))));
        LinkedHashMap<String, Object> res = new LinkedHashMap<>();
        res.put("preferences", rows);
        return res;
    }

    private static LinkedHashMap<String, Object> userRow(String uuid, String name) {
        LinkedHashMap<String, Object> u = new LinkedHashMap<>();
        u.put("uuid", uuid); u.put("name", name); u.put("mobileNumber", "7000000" + uuid.charAt(1)); u.put("countryCode", "+254");
        return u;
    }

    private ServiceRequest assignRequest() {
        Service service = Service.builder().tenantId(TENANT).serviceRequestId("PGR-2026-001")
                .applicationStatus("PENDINGATLME").serviceCode("GarbageNeeds")
                .citizen(User.builder().uuid("citizen-uuid").name("Jane").mobileNumber("712345678").countryCode("+254").build())
                .auditDetails(AuditDetails.builder().createdTime(1719600000000L).createdBy("citizen-uuid").build())
                .build();
        return ServiceRequest.builder().requestInfo(new RequestInfo()).service(service)
                .workflow(Workflow.builder().action("ASSIGN").assignes(Collections.emptyList()).build()).build();
    }

    @Test
    @SuppressWarnings("unchecked")
    void eachRecipientRendersInTheirPreferredLanguage_defaultOtherwise() {
        notificationService.process(assignRequest(), "update-pgr-request");

        verify(templateRenderer).render(eq(TENANT), eq("GRO"), eq("ASSIGN"), eq("PENDINGATLME"), eq("SMS"), eq("hi_IN"), any());
        verify(templateRenderer).render(eq(TENANT), eq("GRO"), eq("ASSIGN"), eq("PENDINGATLME"), eq("SMS"), eq("en_IN"), any());

        ArgumentCaptor<Object> events = ArgumentCaptor.forClass(Object.class);
        verify(producer, times(2)).push(eq(TENANT), eq(TOPIC), events.capture());
        Map<String, String> localeByUser = new HashMap<>();
        for (Object o : events.getAllValues()) {
            Map<String, Object> e = (Map<String, Object>) o;
            Map<String, Object> contact = (Map<String, Object>) e.get("contact");
            localeByUser.put((String) contact.get("userId"), (String) contact.get("locale"));
            assertEquals("BODY-" + contact.get("locale"), e.get("renderedBody"));
            assertEquals("GRO.ASSIGN.PENDINGATLME.SMS." + contact.get("locale"), e.get("templateKey"));
        }
        assertEquals("hi_IN", localeByUser.get("u1"));
        assertEquals("en_IN", localeByUser.get("u2"));
    }

    @Test
    void preferenceServiceOff_orDown_meansDefaultLocaleForEveryone() {
        when(config.getUserPreferenceHost()).thenReturn("");
        notificationService.process(assignRequest(), "update-pgr-request");
        verify(templateRenderer, times(1)).render(anyString(), anyString(), anyString(), anyString(), anyString(), eq("en_IN"), any());
        verify(templateRenderer, never()).render(anyString(), anyString(), anyString(), anyString(), anyString(), eq("hi_IN"), any());
    }
}
