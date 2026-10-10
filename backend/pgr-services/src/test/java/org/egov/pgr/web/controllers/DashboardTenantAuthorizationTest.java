package org.egov.pgr.web.controllers;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.egov.pgr.config.PGRConfiguration;
import org.egov.pgr.service.DashboardService;
import org.egov.pgr.service.DashboardTenantGuard;
import org.egov.pgr.web.models.DashboardResponse;
import org.egov.tracer.model.CustomException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestTemplate;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * GET /v2/dashboard authorizes the requested tenant against the caller's own tenant, with the
 * same check complaint search uses (PolicyDrivenScopeResolver.isAuthorizedTenant). Before this, the
 * raw tenantId went straight to the aggregates, so a {@code ke} caller could read {@code kenya}.
 */
class DashboardTenantAuthorizationTest {

    private final ObjectMapper mapper = new ObjectMapper();
    private RestTemplate restTemplate;
    private DashboardService dashboardService;
    private RequestsApiController controller;

    @BeforeEach
    void setUp() {
        restTemplate = mock(RestTemplate.class);
        dashboardService = mock(DashboardService.class);
        PGRConfiguration config = mock(PGRConfiguration.class);
        when(config.getUserHost()).thenReturn("http://egov-user:8080/");
        when(dashboardService.getDashboardData(anyString(), any(), any())).thenReturn(new DashboardResponse());
        controller = new RequestsApiController(mapper, null, null, dashboardService, null,
                new DashboardTenantGuard(restTemplate, config));
    }

    private void callerTenant(String token, String tenantId) throws Exception {
        JsonNode user = mapper.readTree("{\"uuid\":\"u-1\",\"tenantId\":\"" + tenantId + "\"}");
        when(restTemplate.postForObject(contains("access_token=" + token), any(), eq(JsonNode.class))).thenReturn(user);
    }

    @Test
    void aCallerFromKeCannotReadTheSiblingRootKenya() throws Exception {
        callerTenant("ke-token", "ke");

        CustomException e = assertThrows(CustomException.class,
                () -> controller.dashboard("kenya", null, null, "ke-token", null));

        assertEquals("TENANT_NOT_AUTHORIZED", e.getCode());
        verify(dashboardService, never()).getDashboardData(anyString(), any(), any());
    }

    @Test
    void theCallersOwnTenantStillWorks() throws Exception {
        callerTenant("city-token", "ke.bomet");

        ResponseEntity<DashboardResponse> response = controller.dashboard("ke.bomet", null, null, "city-token", null);

        assertEquals(200, response.getStatusCode().value());
        verify(dashboardService).getDashboardData("ke.bomet", null, null);
        // Per-caller data: never cached by a shared cache for the next caller of the same URL.
        String cacheControl = response.getHeaders().getFirst(HttpHeaders.CACHE_CONTROL);
        assertTrue(cacheControl.contains("private"), cacheControl);
        assertFalse(cacheControl.contains("public"), cacheControl);
    }

    @Test
    void aStateLevelCallerStillReadsItsOwnSubtree() throws Exception {
        callerTenant("state-token", "ke");

        assertEquals(200, controller.dashboard("ke", null, null, "state-token", null).getStatusCode().value());
        assertEquals(200, controller.dashboard("ke.bomet", 1L, 2L, "state-token", null).getStatusCode().value());

        verify(dashboardService).getDashboardData("ke", null, null);
        verify(dashboardService).getDashboardData("ke.bomet", 1L, 2L);
    }

    @Test
    void aCityCallerCannotWidenToItsState() throws Exception {
        callerTenant("city-token", "ke.bomet");

        assertThrows(CustomException.class, () -> controller.dashboard("ke", null, null, "city-token", null));
    }

    @Test
    void theAccessTokenQueryParameterIsHonouredLikeTheGatewayDoes() throws Exception {
        callerTenant("q-token", "ke");

        assertEquals(200, controller.dashboard("ke", null, null, null, "q-token").getStatusCode().value());
        assertThrows(CustomException.class, () -> controller.dashboard("kenya", null, null, null, "q-token"));
    }

    @Test
    void noTokenOrAnUnverifiableTokenIsRefused() {
        assertThrows(CustomException.class, () -> controller.dashboard("ke", null, null, null, null));
        assertThrows(CustomException.class, () -> controller.dashboard("ke", null, null, " ", null));

        when(restTemplate.postForObject(anyString(), any(), eq(JsonNode.class)))
                .thenThrow(new ResourceAccessException("egov-user down"));
        assertThrows(CustomException.class, () -> controller.dashboard("ke", null, null, "any-token", null));

        verify(dashboardService, never()).getDashboardData(anyString(), any(), any());
    }
}
