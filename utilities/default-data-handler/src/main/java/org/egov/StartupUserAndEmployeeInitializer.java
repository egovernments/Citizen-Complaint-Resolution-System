package org.egov;

import java.nio.charset.StandardCharsets;

import com.fasterxml.jackson.databind.JsonNode;
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
import lombok.extern.slf4j.Slf4j;
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

/**
 * Second phase of startup initialization.
 *
 * Runs periodically (every 4 minutes, up to 4 times) to provide fault tolerance.
 * All operations are idempotent - duplicates are handled gracefully by the APIs.
 *
 * This ensures data is loaded even if:
 * - External services weren't ready on first attempt
 * - Network issues occurred
 * - First initializer failed
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class StartupUserAndEmployeeInitializer {

    private final DataHandlerService dataHandlerService;
    private final ServiceConfiguration serviceConfig;
    private final ResourceLoader resourceLoader;
    private final ObjectMapper objectMapper;
    private final MdmsBulkLoader mdmsBulkLoader;
    private final LocalizationUtil localizationUtil;

    private int executionCount = 0;
    private static final int MAX_EXECUTIONS = 4;

    /**
     * Runs every 4 minutes for fault tolerance.
     * Stops after MAX_EXECUTIONS attempts.
     * All APIs handle duplicates gracefully (log and continue).
     */
    @Scheduled(initialDelay = 4 * 60 * 1000, fixedDelay = 4 * 60 * 1000)
    public void runPeriodically() {
        if (executionCount >= MAX_EXECUTIONS) return;

        executionCount++;
        log.info("[INIT] Attempt {}/{} starting at: {}", executionCount, MAX_EXECUTIONS, Instant.now());

        try {
            executeStartupLogic();
            log.info("[INIT] Attempt {}/{} completed", executionCount, MAX_EXECUTIONS);
        } catch (Exception e) {
            log.error("[INIT] Attempt {}/{} failed: {}", executionCount, MAX_EXECUTIONS, e.getMessage(), e);
        }
    }

    public void executeStartupLogic() throws Exception {
        String tenantCode = serviceConfig.getDefaultTenantId();

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
        TenantRequest tenantRequest = TenantRequest.builder().requestInfo(requestInfo).tenant(tenant).build();

        DefaultDataRequest defaultDataRequest = DefaultDataRequest.builder()
                .requestInfo(tenantRequest.getRequestInfo())
                .targetTenantId(tenantCode)
                .onlySchemas(Boolean.FALSE)
                .locales(serviceConfig.getDefaultLocalizationLocaleList())
                .modules(serviceConfig.getDefaultLocalizationModuleList())
                .build();

        // Load schemas and data (idempotent - duplicates handled gracefully)
        dataHandlerService.createMdmsSchemaFromFile(defaultDataRequest);
        mdmsBulkLoader.loadAllMdmsData(defaultDataRequest.getTargetTenantId(), defaultDataRequest.getRequestInfo());
        dataHandlerService.createBoundaryDataFromFile(defaultDataRequest);
        localizationUtil.upsertLocalizationFromFile(defaultDataRequest);

        // Create users (idempotent - duplicates logged and skipped)
        dataHandlerService.createUserFromFile(tenantRequest);

        // Create workflows for all enabled modules (idempotent)
        dataHandlerService.createAllModuleWorkflowConfigs(tenantRequest.getTenant().getCode());

        // Create employees for all enabled modules (idempotent)
        dataHandlerService.createAllModuleEmployees(defaultDataRequest.getRequestInfo());

        log.info("[INIT] All steps completed for tenant: {}", tenantCode);
    }
}

