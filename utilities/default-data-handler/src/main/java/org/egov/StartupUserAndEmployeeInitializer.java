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

@Component
@RequiredArgsConstructor
public class StartupUserAndEmployeeInitializer {

    private final DataHandlerService dataHandlerService;
    private final ServiceConfiguration serviceConfig;
    private final ResourceLoader resourceLoader;
    private final ObjectMapper objectMapper;
    private final MdmsBulkLoader mdmsBulkLoader;
    private final LocalizationUtil localizationUtil;

    private final AtomicBoolean hasStarted = new AtomicBoolean(false);
    private int executionCount = 0;
    private static final int MAX_EXECUTIONS = 4;

    @Scheduled(initialDelay = 4 * 60 * 1000, fixedDelay = 4 * 60 * 1000) // 4 minutes
    public void runPeriodically() {
        if (executionCount >= MAX_EXECUTIONS) return;

        System.out.println("[DEBUG] Scheduled startup logic executing at: " + Instant.now());

        try {
            executeStartupLogic();
            executionCount++;
        } catch (Exception e) {
            System.err.println("StartupSchemaAndMasterDataInitializer failed on attempt " + (executionCount + 1) + ": " + e.getMessage());
            e.printStackTrace();
            executionCount++; // Even on failure, count the attempt
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
                .schemaCodes(serviceConfig.getDefaultMdmsSchemaList())
                .onlySchemas(Boolean.FALSE)
                .locales(serviceConfig.getDefaultLocalizationLocaleList())
                .modules(serviceConfig.getDefaultLocalizationModuleList())
                .build();

        // Execute your logic
        dataHandlerService.createMdmsSchemaFromFile(defaultDataRequest);

        // Load default MDMS data (always)
        mdmsBulkLoader.loadAllMdmsData(defaultDataRequest.getTargetTenantId(),
                defaultDataRequest.getRequestInfo(),
                serviceConfig.getDefaultMdmsDataPath());

        // Load default localization (always)
        localizationUtil.upsertLocalizationFromFile(defaultDataRequest,
                serviceConfig.getDefaultLocalizationDataPath());

        // Load default user (always)
        dataHandlerService.createUserFromFile(tenantRequest, serviceConfig.getDefaultUserDataFile());

        // Load default employee (always)
        dataHandlerService.createEmployeeFromFile(defaultDataRequest.getRequestInfo(),
                serviceConfig.getDefaultEmployeeDataFile());

        // Load boundary, localization, user, employee, and workflow config data only if enabled
        if (serviceConfig.isDevEnabled()) {
            // Load dev MDMS data
            mdmsBulkLoader.loadAllMdmsData(defaultDataRequest.getTargetTenantId(),
                    defaultDataRequest.getRequestInfo(),
                    serviceConfig.getDevMdmsDataPath());

            // Load dev localization
            localizationUtil.upsertLocalizationFromFile(defaultDataRequest,
                    serviceConfig.getDevLocalizationDataPath());

            // Create boundary data from both boundary and boundary-root folders
            dataHandlerService.createBoundaryDataFromFile(defaultDataRequest, "boundary");
            dataHandlerService.createBoundaryDataFromFile(defaultDataRequest, "boundary-root");

            // Load dev users
            dataHandlerService.createUserFromFile(tenantRequest, serviceConfig.getDevUserDataFile());
            dataHandlerService.createPgrWorkflowConfig(tenantRequest.getTenant().getCode());
            // create employee (dev)
            dataHandlerService.createEmployeeFromFile(defaultDataRequest.getRequestInfo(),
                    serviceConfig.getDevEmployeeDataFile());
        }
    }
}

