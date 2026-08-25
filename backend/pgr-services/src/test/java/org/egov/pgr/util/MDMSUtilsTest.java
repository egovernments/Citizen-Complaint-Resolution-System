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

import org.egov.pgr.policy.AccessControlUnavailableException;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
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
    void throwsWithoutCallingOutWhenRequestInfoHasNoRoles() {
        // An unidentifiable caller is NOT the same as "call succeeded, no action visible for these
        // roles" — the latter is what AccessPolicyRegistry treats as "policy not defined, allow"
        // for backward compatibility. Collapsing the two would disable the Tier-2 per-row re-check
        // for exactly the caller whose identity is least trustworthy (#1441 review).
        RequestInfo requestInfo = new RequestInfo();
        requestInfo.setUserInfo(new User());

        assertThrows(AccessControlUnavailableException.class, () -> mdmsUtils.fetchAccessControlActions(
                requestInfo, "pg.city", "/pgr-services/v2/request/_search"));
        verifyNoInteractions(serviceRequestRepository);
    }

    @Test
    void throwsWhenTheOutboundCallFails() {
        // Distinct from a confirmed-empty result (returnsEmptyWhenNoActionMatchesTheUrl below): the
        // call itself failing must be distinguishable from "no policy configured", since
        // AccessPolicyRegistry treats the latter as backward-compatible allow but must still fail
        // closed on an actual accesscontrol outage.
        RequestInfo requestInfo = requestInfo("EMPLOYEE");
        when(serviceRequestRepository.fetchResult(any(), any())).thenThrow(new RuntimeException("connection refused"));

        assertThrows(AccessControlUnavailableException.class, () -> mdmsUtils.fetchAccessControlActions(
                requestInfo, "pg.city", "/pgr-services/v2/request/_search"));
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

    // --- getDepartmentCodeToNameMap: cached, never-cache-empty, serve-stale-on-failure ----------

    @Test
    void departmentCodeToNameMapIsCachedWithinTtl() {
        when(config.getNotificationMdmsCacheTtlMs()).thenReturn(60_000L);
        when(config.getMdmsHost()).thenReturn("http://localhost:8094");
        when(config.getMdmsEndPoint()).thenReturn("/mdms-v2/v2/_search");
        Map<String, Object> mdmsResponse = Map.of("MdmsRes", Map.of("common-masters", Map.of(
                "Department", List.of(Map.of("code", "DEPT_1", "name", "Public Works")))));
        when(serviceRequestRepository.fetchResult(any(), any())).thenReturn(mdmsResponse);

        Map<String, String> first = mdmsUtils.getDepartmentCodeToNameMap(new RequestInfo(), "pg.city");
        Map<String, String> second = mdmsUtils.getDepartmentCodeToNameMap(new RequestInfo(), "pg.city");

        assertEquals(Map.of("DEPT_1", "Public Works"), first);
        assertEquals(first, second);
        verify(serviceRequestRepository, org.mockito.Mockito.times(1)).fetchResult(any(), any());
    }

    @Test
    void departmentCodeToNameMapServesTheStaleEntryOnAFailureRatherThanDroppingIt() {
        // TTL=0 means the cached entry is never considered fresh, so every call attempts a real
        // fetch — but a FAILED re-fetch must fall back to the last-known-good map, not silently
        // return empty and drop every dual-read match until the next successful fetch (#1441 review).
        when(config.getNotificationMdmsCacheTtlMs()).thenReturn(0L);
        when(config.getMdmsHost()).thenReturn("http://localhost:8094");
        when(config.getMdmsEndPoint()).thenReturn("/mdms-v2/v2/_search");
        Map<String, Object> mdmsResponse = Map.of("MdmsRes", Map.of("common-masters", Map.of(
                "Department", List.of(Map.of("code", "DEPT_1", "name", "Public Works")))));
        when(serviceRequestRepository.fetchResult(any(), any()))
                .thenReturn(mdmsResponse)
                .thenThrow(new RuntimeException("mdms down"));

        Map<String, String> first = mdmsUtils.getDepartmentCodeToNameMap(new RequestInfo(), "pg.city");
        Map<String, String> second = mdmsUtils.getDepartmentCodeToNameMap(new RequestInfo(), "pg.city");

        assertEquals(Map.of("DEPT_1", "Public Works"), first);
        assertEquals(first, second, "a failed re-fetch must serve the stale cached map, not empty");
    }

    @Test
    void departmentCodeToNameMapReturnsEmptyOnFailureWithNothingCachedYet() {
        when(config.getNotificationMdmsCacheTtlMs()).thenReturn(60_000L);
        when(config.getMdmsHost()).thenReturn("http://localhost:8094");
        when(config.getMdmsEndPoint()).thenReturn("/mdms-v2/v2/_search");
        when(serviceRequestRepository.fetchResult(any(), any())).thenThrow(new RuntimeException("mdms down"));

        Map<String, String> result = mdmsUtils.getDepartmentCodeToNameMap(new RequestInfo(), "pg.city");

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
