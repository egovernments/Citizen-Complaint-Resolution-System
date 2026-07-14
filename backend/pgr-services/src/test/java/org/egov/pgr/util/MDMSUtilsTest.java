package org.egov.pgr.util;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.egov.common.contract.request.RequestInfo;
import org.egov.common.contract.request.Role;
import org.egov.common.contract.request.User;
import org.egov.pgr.config.PGRConfiguration;
import org.egov.pgr.repository.ServiceRequestRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * Locks in the exact request contract for egov-accesscontrol's role-scoped
 * /access/v1/actions/mdms/_get: roleCodes/tenantId/actionMaster/RequestInfo are sent, and
 * "enabled" is deliberately OMITTED so the call returns every action mapped to the caller's
 * roles regardless of its enabled flag (accesscontrol only applies an enabled constraint when
 * that field is present in the request).
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class MDMSUtilsTest {

    @Mock
    private PGRConfiguration config;
    @Mock
    private ServiceRequestRepository serviceRequestRepository;

    private MDMSUtils mdmsUtils;

    @BeforeEach
    void setup() {
        when(config.getAccessControlHost()).thenReturn("http://localhost:8080");
        when(config.getAccessControlActionsMdmsGetPath()).thenReturn("/access/v1/actions/mdms/_get");
        mdmsUtils = new MDMSUtils(config, serviceRequestRepository, new ObjectMapper());
    }

    @Test
    @SuppressWarnings("unchecked")
    void sendsRoleScopedRequestWithoutAnEnabledFilter() {
        RequestInfo requestInfo = requestInfo("CITIZEN");
        Map<String, Object> mdmsResponse = Map.of("actions", List.of(
                Map.of("id", 2008, "url", "/pgr-services/v2/request/_search", "condition", Map.of("==", List.of(1, 1)))));
        when(serviceRequestRepository.fetchResult(any(StringBuilder.class), any())).thenReturn(mdmsResponse);

        List<Map<String, Object>> result = mdmsUtils.fetchAccessControlActions(
                requestInfo, "pg.city", "/pgr-services/v2/request/_search");

        assertEquals(1, result.size());

        ArgumentCaptor<Object> bodyCaptor = ArgumentCaptor.forClass(Object.class);
        verify(serviceRequestRepository).fetchResult(any(StringBuilder.class), bodyCaptor.capture());
        Map<String, Object> body = (Map<String, Object>) bodyCaptor.getValue();

        assertEquals(List.of("CITIZEN"), body.get("roleCodes"));
        assertEquals("pg.city", body.get("tenantId"));
        assertEquals("actions-test", body.get("actionMaster"));
        assertEquals(requestInfo, body.get("RequestInfo"));
        assertFalse(body.containsKey("enabled"), "request must not filter by enabled — see class javadoc");
    }

    @Test
    void returnsEmptyWithoutCallingOutWhenRequestInfoHasNoRoles() {
        RequestInfo requestInfo = new RequestInfo();
        requestInfo.setUserInfo(new User());

        List<Map<String, Object>> result = mdmsUtils.fetchAccessControlActions(
                requestInfo, "pg.city", "/pgr-services/v2/request/_search");

        assertTrue(result.isEmpty());
        verifyNoInteractions(serviceRequestRepository);
    }

    @Test
    void returnsEmptyWhenTheOutboundCallFails() {
        RequestInfo requestInfo = requestInfo("EMPLOYEE");
        when(serviceRequestRepository.fetchResult(any(), any())).thenThrow(new RuntimeException("connection refused"));

        List<Map<String, Object>> result = mdmsUtils.fetchAccessControlActions(
                requestInfo, "pg.city", "/pgr-services/v2/request/_search");

        assertTrue(result.isEmpty());
    }

    @Test
    void returnsEmptyWhenNoActionMatchesTheUrl() {
        RequestInfo requestInfo = requestInfo("CITIZEN");
        Map<String, Object> mdmsResponse = Map.of("actions", List.of(
                Map.of("id", 1, "url", "/some/other/url")));
        when(serviceRequestRepository.fetchResult(any(), any())).thenReturn(mdmsResponse);

        List<Map<String, Object>> result = mdmsUtils.fetchAccessControlActions(
                requestInfo, "pg.city", "/pgr-services/v2/request/_search");

        assertTrue(result.isEmpty());
    }

    private RequestInfo requestInfo(String roleCode) {
        User user = new User();
        user.setRoles(List.of(Role.builder().code(roleCode).build()));
        RequestInfo requestInfo = new RequestInfo();
        requestInfo.setUserInfo(user);
        return requestInfo;
    }
}
