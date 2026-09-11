package org.egov.pgr.analytics;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.egov.common.utils.MultiStateInstanceUtil;
import org.egov.pgr.config.PGRConfiguration;
import org.egov.pgr.repository.ServiceRequestRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** Fail-closed contract for dss.DashboardConfig.publicDashboardEnabled. */
@ExtendWith(MockitoExtension.class)
public class KpiCatalogServicePublicDashboardTest {

    @Mock private PGRConfiguration config;
    @Mock private ServiceRequestRepository repo;
    @Mock private MultiStateInstanceUtil multiStateInstanceUtil;

    private KpiCatalogService service;

    @BeforeEach
    public void setUp() {
        when(config.getMdmsHost()).thenReturn("http://mdms-v2:8080");
        when(config.getMdmsEndPoint()).thenReturn("/mdms-v2/v1/_search");
        when(config.getAnalyticsConfigCacheTtlMs())
                .thenReturn(PGRConfiguration.DEFAULT_ANALYTICS_CONFIG_CACHE_TTL_MS);
        when(multiStateInstanceUtil.getStateLevelTenant(anyString())).thenReturn("ke");
        service = new KpiCatalogService(config, repo, multiStateInstanceUtil, new ObjectMapper());
    }

    private static Map<String, Object> mdmsResult(Map<String, Object>... records) {
        Map<String, Object> result = new HashMap<>();
        result.put("MdmsRes", Map.of("dss", Map.of("DashboardConfig", List.of(records))));
        return result;
    }

    @Test
    public void onlyBooleanTrueEnablesPublicDashboard() {
        when(repo.fetchResult(any(), any())).thenReturn(mdmsResult(
                Map.of("id", "default", "publicDashboardEnabled", true)));

        assertTrue(service.isPublicDashboardEnabled("ke.bomet"));
        verify(repo, times(1)).fetchResult(any(), any());
    }

    @Test
    public void missingMalformedAndFalseValuesStayDisabled() {
        for (Object value : new Object[]{false, "true", 1, "", new Object()}) {
            service = new KpiCatalogService(config, repo, multiStateInstanceUtil, new ObjectMapper());
            Map<String, Object> record = new HashMap<>();
            record.put("id", "default");
            record.put("publicDashboardEnabled", value);
            when(repo.fetchResult(any(), any())).thenReturn(mdmsResult(record));
            assertFalse(service.isPublicDashboardEnabled("ke"), "value must not enable: " + value);
        }
    }

    @Test
    public void absentRecordMdmsFailureAndInvalidTenantStayDisabled() {
        when(repo.fetchResult(any(), any())).thenReturn(mdmsResult());
        assertFalse(service.isPublicDashboardEnabled("ke"));

        service = new KpiCatalogService(config, repo, multiStateInstanceUtil, new ObjectMapper());
        when(repo.fetchResult(any(), any())).thenThrow(new RuntimeException("mdms down"));
        assertFalse(service.isPublicDashboardEnabled("ke"));
        assertFalse(service.isPublicDashboardEnabled(null));
        assertFalse(service.isPublicDashboardEnabled(""));
    }

    @Test
    public void explicitRefreshEvictsCachedStateAndReturnsTheNewValue() {
        when(repo.fetchResult(any(), any()))
                .thenReturn(mdmsResult(Map.of("id", "default", "publicDashboardEnabled", false)))
                .thenReturn(mdmsResult(Map.of("id", "default", "publicDashboardEnabled", true)));

        assertFalse(service.isPublicDashboardEnabled("ke.bomet"));
        assertTrue(service.refreshPublicDashboardConfig("ke.bomet"));
        assertTrue(service.isPublicDashboardEnabled("ke"));
        verify(repo, times(2)).fetchResult(any(), any());
    }
}
