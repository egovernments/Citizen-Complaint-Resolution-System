package org.egov;

import java.nio.charset.StandardCharsets;

import com.fasterxml.jackson.databind.JsonNode;
import lombok.extern.slf4j.Slf4j;
import org.egov.handler.util.LocalizationUtil;
import org.egov.handler.util.MdmsBulkLoader;
import org.egov.handler.web.models.User;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.annotation.Profile;
import org.springframework.context.event.EventListener;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.util.StreamUtils;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import org.egov.common.contract.request.RequestInfo;
import org.egov.handler.service.DataHandlerService;
import org.egov.handler.web.models.DefaultDataRequest;
import org.egov.handler.web.models.Tenant;
import org.egov.handler.web.models.TenantRequest;
import org.egov.handler.config.ServiceConfiguration;
import org.springframework.core.io.Resource;
import org.springframework.core.io.ResourceLoader;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * First phase of startup initialization - Schema and Master Data loading.
 *
 * Runs once at 10s after startup to:
 * 1. Create MDMS schemas for the default tenant
 * 2. Load MDMS master data from files
 * 3. Create boundary data
 * 4. Load localizations
 *
 * The second phase (StartupUserAndEmployeeInitializer) runs later and provides
 * fault tolerance by retrying all operations (APIs handle duplicates gracefully).
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class StartupSchemaAndMasterDataInitializer {

    private final DataHandlerService dataHandlerService;
    private final ServiceConfiguration serviceConfig;
    private final ResourceLoader resourceLoader;
    private final ObjectMapper objectMapper;
    private final MdmsBulkLoader mdmsBulkLoader;
    private final LocalizationUtil localizationUtil;

    private final AtomicBoolean hasRun = new AtomicBoolean(false);

    // Delay 10 seconds after app startup
    @Scheduled(initialDelay = 10 * 1000, fixedDelay = Long.MAX_VALUE)
    public void runOnceAfterStartup() {
        if (hasRun.get()) return;
        hasRun.set(true);

        log.info("[SCHEMA_INIT] Starting schema and master data initialization at: {}", Instant.now());
        try {
            executeStartupLogic();
            log.info("[SCHEMA_INIT] Completed successfully");
        } catch (Exception e) {
            log.error("[SCHEMA_INIT] Failed: {}. Will be retried by StartupUserAndEmployeeInitializer.", e.getMessage(), e);
        }
    }

    public void executeStartupLogic() throws Exception {
        String tenantCode = serviceConfig.getDefaultTenantId();
        log.info("[SCHEMA_INIT] Executing for tenant: {}", tenantCode);

        Resource resource = resourceLoader.getResource("classpath:requestInfo.json");
        Resource tenantJson = resourceLoader.getResource("classpath:tenant.json");

        String json = StreamUtils.copyToString(resource.getInputStream(), StandardCharsets.UTF_8);
        String jsonTenant = StreamUtils.copyToString(tenantJson.getInputStream(), StandardCharsets.UTF_8);

        json = json.replace("{tenantid}", tenantCode);
        jsonTenant = jsonTenant.replace("{tenantid}", tenantCode);

        Tenant tenant = objectMapper.readValue(jsonTenant, Tenant.class);

        JsonNode rootNode = objectMapper.readTree(json);
        JsonNode requestInfoNode = rootNode.get("RequestInfo");

        if (requestInfoNode == null) {
            throw new RuntimeException("Missing 'RequestInfo' node in JSON");
        }
        RequestInfo requestInfo = objectMapper.readValue(requestInfoNode.toString(), RequestInfo.class);

        TenantRequest tenantRequest = TenantRequest.builder()
                .requestInfo(requestInfo)
                .tenant(tenant)
                .build();

        DefaultDataRequest defaultDataRequest = DefaultDataRequest.builder()
                .requestInfo(tenantRequest.getRequestInfo())
                .targetTenantId(tenantCode)
                .onlySchemas(Boolean.FALSE)
                .locales(serviceConfig.getDefaultLocalizationLocaleList())
                .modules(serviceConfig.getDefaultLocalizationModuleList())
                .build();

        // STEP 1: Create all schemas for target tenant (tenant schema loaded first)
        log.info("[SCHEMA_INIT] Step 1: Creating schemas for tenant '{}'", tenantCode);
        dataHandlerService.createMdmsSchemaFromFile(defaultDataRequest);

        // STEP 2: Load all MDMS data for target tenant (tenant data loaded first from common)
        log.info("[SCHEMA_INIT] Step 2: Loading MDMS data for tenant '{}'", tenantCode);
        mdmsBulkLoader.loadAllMdmsData(defaultDataRequest.getTargetTenantId(), defaultDataRequest.getRequestInfo());

        // STEP 3: Create Boundary Data
        log.info("[SCHEMA_INIT] Step 3: Creating boundary data");
        dataHandlerService.createBoundaryDataFromFile(defaultDataRequest);

        // STEP 4: Upsert localization
        log.info("[SCHEMA_INIT] Step 4: Loading localizations");
        localizationUtil.upsertLocalizationFromFile(defaultDataRequest);

        log.info("[SCHEMA_INIT] Completed all steps for tenant '{}'", tenantCode);
    }
}
