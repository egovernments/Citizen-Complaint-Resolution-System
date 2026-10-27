package org.egov.pgr.analytics;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.egov.common.utils.MultiStateInstanceUtil;
import org.egov.mdms.model.MdmsCriteriaReq;
import org.egov.pgr.config.PGRConfiguration;
import org.egov.pgr.repository.ServiceRequestRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * publicDashboardEnabled belongs to the root tenant that wrote it. A workspace
 * that enables its public dashboard must not enable the deployment root or a
 * sibling workspace, and vice versa.
 */
@ExtendWith(MockitoExtension.class)
public class KpiCatalogServicePublicDashboardTenantTest {

    @Mock private PGRConfiguration config;
    @Mock private ServiceRequestRepository repo;
    @Mock private MultiStateInstanceUtil multiStateInstanceUtil;

    private KpiCatalogService service;
    private final List<String> fetchedTenants = new ArrayList<>();

    @BeforeEach
    public void setUp() {
        when(config.getMdmsHost()).thenReturn("http://mdms-v2:8080");
        when(config.getMdmsEndPoint()).thenReturn("/mdms-v2/v1/_search");
        when(config.getAnalyticsConfigCacheTtlMs())
                .thenReturn(PGRConfiguration.DEFAULT_ANALYTICS_CONFIG_CACHE_TTL_MS);
        when(multiStateInstanceUtil.getStateLevelTenant(anyString()))
                .thenAnswer(inv -> inv.getArgument(0, String.class).split("\\.")[0]);
        // Only the `testtfour` workspace has turned its public dashboard on.
        when(repo.fetchResult(any(), any())).thenAnswer(inv -> {
            String tenant = inv.getArgument(1, MdmsCriteriaReq.class).getMdmsCriteria().getTenantId();
            fetchedTenants.add(tenant);
            boolean enabled = "testtfour".equals(tenant);
            return Map.of("MdmsRes", Map.of("dss", Map.of("DashboardConfig",
                    List.of(Map.of("id", "default", "publicDashboardEnabled", enabled)))));
        });
        service = new KpiCatalogService(config, repo, multiStateInstanceUtil, new ObjectMapper());
    }

    @Test
    public void enablingOneWorkspaceEnablesOnlyThatWorkspace() {
        // Cities first, while nothing is cached: their flag must be read at the root, never at the city itself.
        assertTrue(service.isPublicDashboardEnabled("testtfour.ward1"));
        assertFalse(service.isPublicDashboardEnabled("ke.bomet"));
        assertTrue(service.isPublicDashboardEnabled("testtfour"));

        assertFalse(service.isPublicDashboardEnabled("ke"), "deployment root must stay disabled");
        assertFalse(service.isPublicDashboardEnabled("testtone"), "sibling workspace must stay disabled");
        // A name that merely starts with the enabled id is a different tenant.
        assertFalse(service.isPublicDashboardEnabled("testtfourx"));

        assertEquals(List.of("testtfour", "ke", "testtone", "testtfourx"), fetchedTenants,
                "each root's own DashboardConfig is read, once, and never at a city tenant");
    }
}
