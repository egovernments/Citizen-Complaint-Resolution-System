package org.egov;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.egov.common.contract.request.RequestInfo;
import org.egov.handler.config.ServiceConfiguration;
import org.egov.handler.service.DataHandlerService;
import org.egov.handler.util.ConfigDataBulkLoader;
import org.egov.handler.util.LocalizationUtil;
import org.egov.handler.util.MdmsBulkLoader;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.core.io.DefaultResourceLoader;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * The root-only seed bundle exists so a tenant created later inherits those rows
 * instead of owning a copy. That only holds if startup actually loads it — and
 * loads it for the state root, with the shared bundle, not in place of it.
 */
class StartupRootOnlyMdmsSeedTest {

    private static final String ROOT_TENANT = "ke";
    private static final String SHARED_PATH = "classpath:mdmsData/**/*.json";
    private static final String STATE_PATH = "classpath:stateMdmsData/**/*.json";

    @Test
    void startupLoadsTheRootOnlyBundleForTheStateRoot() throws Exception {
        ServiceConfiguration serviceConfig = mock(ServiceConfiguration.class);
        when(serviceConfig.getDefaultTenantId()).thenReturn(ROOT_TENANT);
        when(serviceConfig.getDefaultMdmsDataPath()).thenReturn(SHARED_PATH);
        when(serviceConfig.getStateMdmsDataPath()).thenReturn(STATE_PATH);
        when(serviceConfig.getDefaultConfigDataPath()).thenReturn("classpath:configData/**/*.json");
        when(serviceConfig.getDefaultLocalizationDataPath()).thenReturn("classpath:localisations/*/*.json");
        when(serviceConfig.isDevEnabled()).thenReturn(Boolean.FALSE);

        MdmsBulkLoader mdmsBulkLoader = mock(MdmsBulkLoader.class);

        new StartupSchemaAndMasterDataInitializer(
                mock(DataHandlerService.class),
                serviceConfig,
                new DefaultResourceLoader(),
                new ObjectMapper(),
                mdmsBulkLoader,
                mock(LocalizationUtil.class),
                mock(ConfigDataBulkLoader.class)
        ).executeStartupLogic();

        ArgumentCaptor<String> tenants = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<String> paths = ArgumentCaptor.forClass(String.class);
        verify(mdmsBulkLoader, times(2))
                .loadAllMdmsData(tenants.capture(), any(RequestInfo.class), paths.capture());

        List<String> loadedPaths = paths.getAllValues();
        assertTrue(loadedPaths.contains(STATE_PATH),
                "Root-only MDMS bundle was never loaded at startup: " + loadedPaths);
        assertTrue(loadedPaths.contains(SHARED_PATH),
                "Root-only bundle must be loaded in ADDITION to the shared one: " + loadedPaths);
        tenants.getAllValues().forEach(tenant ->
                assertEquals(ROOT_TENANT, tenant, "Startup seeds the state root only"));
    }
}
