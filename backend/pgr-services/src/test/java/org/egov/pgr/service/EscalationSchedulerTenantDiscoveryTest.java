package org.egov.pgr.service;

import org.egov.common.contract.request.RequestInfo;
import org.egov.pgr.config.PGRConfiguration;
import org.egov.pgr.onboarding.WorkspaceRepository;
import org.egov.pgr.repository.PGRRepository;
import org.egov.pgr.web.models.RequestSearchCriteria;
import org.junit.Before;
import org.junit.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.*;

import static org.junit.Assert.assertEquals;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** Onboarded root tenants are scanned without being listed under the state tenant, each as its own SYSTEM principal. */
public class EscalationSchedulerTenantDiscoveryTest {
    private PGRRepository repository;
    private EscalationConfigurationService configurationService;
    private WorkspaceRepository workspaces;
    private EscalationScheduler scheduler;

    @Before public void setup() {
        PGRConfiguration config = mock(PGRConfiguration.class);
        when(config.getEscalationEnabled()).thenReturn(true);
        when(config.getEscalationBatchSize()).thenReturn(50);
        repository = mock(PGRRepository.class);
        when(repository.getServiceWrappers(any())).thenReturn(List.of());
        configurationService = mock(EscalationConfigurationService.class);
        when(configurationService.resolve(any(), anyString())).thenReturn(new EscalationConfigurationService.ResolvedEscalationConfig(
                1, List.of(), List.of(), List.of(), List.of("PENDINGATLME"), Map.of(), Map.of()));
        workspaces = mock(WorkspaceRepository.class);
        scheduler = new EscalationScheduler(config, repository, mock(EscalationService.class), configurationService,
                mock(PGRService.class), workspaces);
        ReflectionTestUtils.setField(scheduler, "stateLevelTenantId", "ke");
    }

    @Test public void scansStateCitiesAndDoneWorkspacesOnceEachWithTheirOwnSystemRole() {
        when(configurationService.resolveStateTenants(any(), eq("ke"))).thenReturn(List.of("ke.bomet"));
        when(workspaces.doneTenantIds()).thenReturn(List.of("ke.bomet", "riverside"));

        scheduler.scanAndEscalate();

        ArgumentCaptor<RequestInfo> infos = ArgumentCaptor.forClass(RequestInfo.class);
        ArgumentCaptor<String> tenants = ArgumentCaptor.forClass(String.class);
        verify(configurationService, times(2)).resolve(infos.capture(), tenants.capture());
        assertEquals(List.of("ke.bomet", "riverside"), tenants.getAllValues());
        for (int i = 0; i < 2; i++) {
            assertEquals(tenants.getAllValues().get(i), infos.getAllValues().get(i).getUserInfo().getRoles().get(0).getTenantId());
        }
        ArgumentCaptor<RequestSearchCriteria> searches = ArgumentCaptor.forClass(RequestSearchCriteria.class);
        verify(repository, times(2)).getServiceWrappers(searches.capture());
        assertEquals(List.of("ke.bomet", "riverside"), searches.getAllValues().stream().map(RequestSearchCriteria::getTenantId).toList());
    }

    @Test public void workspaceTenantsStillScanWhenStateDiscoveryFailsAndViceVersa() {
        when(configurationService.resolveStateTenants(any(), eq("ke"))).thenReturn(List.of());
        when(repository.getComplaintTenantIds("ke")).thenThrow(new RuntimeException("db"));
        when(workspaces.doneTenantIds()).thenReturn(List.of("riverside"));
        scheduler.scanAndEscalate();
        verify(configurationService).resolve(any(), eq("riverside"));

        reset(workspaces);
        when(workspaces.doneTenantIds()).thenThrow(new RuntimeException("db"));
        when(configurationService.resolveStateTenants(any(), eq("ke"))).thenReturn(List.of("ke.bomet"));
        scheduler.scanAndEscalate();
        verify(configurationService).resolve(any(), eq("ke.bomet"));
    }
}
