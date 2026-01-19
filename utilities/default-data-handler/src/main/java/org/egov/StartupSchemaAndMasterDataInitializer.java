package org.egov;

import java.nio.charset.StandardCharsets;
import java.util.List;

import com.fasterxml.jackson.databind.JsonNode;
import lombok.extern.slf4j.Slf4j;
import org.egov.handler.util.LocalizationUtil;
import org.egov.handler.util.MdmsBulkLoader;
import org.egov.handler.util.SchemaLoader;
import org.egov.handler.util.WorkflowConfigLoader;
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
import java.util.concurrent.atomic.AtomicBoolean;

@Component
@Slf4j
@RequiredArgsConstructor
public class StartupSchemaAndMasterDataInitializer {

    private final DataHandlerService dataHandlerService;

    private final ServiceConfiguration serviceConfig;

    private final ResourceLoader resourceLoader;

    private final ObjectMapper objectMapper;

    private final MdmsBulkLoader mdmsBulkLoader;

    private final LocalizationUtil localizationUtil;

    private final SchemaLoader schemaLoader;

    private final WorkflowConfigLoader workflowConfigLoader;

    private final AtomicBoolean hasRun = new AtomicBoolean(false);

    // Delay 10 seconds after app startup
    @Scheduled(initialDelay =  1* 10 * 1000, fixedDelay = Long.MAX_VALUE)
    public void runOnceAfterStartup() {
        if (hasRun.get()) return;

        System.out.println("[DEBUG] Delayed startup logic executing at: " + Instant.now());
        try {
            executeStartupLogic();
            hasRun.set(true);
        } catch (Exception e) {
            System.err.println("StartupSchemaAndMasterDataInitializer failed: " + e.getMessage());
            e.printStackTrace();
        }
    }

    public void executeStartupLogic() throws Exception {
        log.info("Startup logic executing at: {}", Instant.now());
        try {
            String tenantCode = serviceConfig.getDefaultTenantId();
            List<String> moduleList = serviceConfig.getModuleList();

            log.info("Loading data for tenant: {}, modules: {}", tenantCode,
                    moduleList.isEmpty() ? "COMMON ONLY" : moduleList);

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
                    .schemaCodes(serviceConfig.getDefaultMdmsSchemaList())
                    .onlySchemas(Boolean.FALSE)
                    .locales(serviceConfig.getDefaultLocalizationLocaleList())
                    .modules(serviceConfig.getDefaultLocalizationModuleList())
                    .build();

            // ===== LOAD PROD COMMON DATA (always) =====
            log.info("Loading PROD common schemas...");
//            schemaLoader.loadSchemasFromPath(defaultDataRequest, serviceConfig.getProdCommonSchemaPath());

            log.info("Loading PROD common MDMS data...");
//            mdmsBulkLoader.loadAllMdmsData(tenantCode, requestInfo, serviceConfig.getProdCommonMdmsDataPath());

            log.info("Loading PROD common localization...");
//            localizationUtil.upsertLocalizationFromFile(defaultDataRequest, serviceConfig.getProdCommonLocalizationDataPath());

            log.info("Loading PROD common workflow config...");
//            workflowConfigLoader.loadWorkflowConfigFromPath(tenantCode, serviceConfig.getProdCommonWorkflowDataPath());

            // ===== LOAD PROD MODULE DATA (for each enabled module) =====
            for (String moduleName : moduleList) {
                log.info("Loading PROD data for module: {}", moduleName);

                String moduleSchemaPath = serviceConfig.getModulePath(
                        serviceConfig.getProdModuleSchemaPathPattern(), moduleName);
                String moduleMdmsPath = serviceConfig.getModulePath(
                        serviceConfig.getProdModuleMdmsDataPathPattern(), moduleName);
                String moduleLocalizationPath = serviceConfig.getModulePath(
                        serviceConfig.getProdModuleLocalizationDataPathPattern(), moduleName);
                String moduleWorkflowPath = serviceConfig.getModulePath(
                        serviceConfig.getProdModuleWorkflowDataPathPattern(), moduleName);

                schemaLoader.loadSchemasFromPath(defaultDataRequest, moduleSchemaPath);
                mdmsBulkLoader.loadAllMdmsData(tenantCode, requestInfo, moduleMdmsPath);
//                localizationUtil.upsertLocalizationFromFile(defaultDataRequest, moduleLocalizationPath);
//                workflowConfigLoader.loadWorkflowConfigFromPath(tenantCode, moduleWorkflowPath);
            }

            // ===== LOAD DEV DATA (only if dev.enabled=true) =====
            if (serviceConfig.isDevEnabled()) {
                log.info("Dev mode enabled, loading DEV data...");

                // Load DEV common data
                log.info("Loading DEV common schemas...");
                schemaLoader.loadSchemasFromPath(defaultDataRequest, serviceConfig.getDevCommonSchemaPath());

                log.info("Loading DEV common MDMS data...");
                mdmsBulkLoader.loadAllMdmsData(tenantCode, requestInfo, serviceConfig.getDevCommonMdmsDataPath());

                log.info("Loading DEV common localization...");
                localizationUtil.upsertLocalizationFromFile(defaultDataRequest, serviceConfig.getDevCommonLocalizationDataPath());

                log.info("Loading DEV common workflow config...");
                workflowConfigLoader.loadWorkflowConfigFromPath(tenantCode, serviceConfig.getDevCommonWorkflowDataPath());

                // Load DEV module data for each enabled module
                for (String moduleName : moduleList) {
                    log.info("Loading DEV data for module: {}", moduleName);

                    String moduleSchemaPath = serviceConfig.getModulePath(
                            serviceConfig.getDevModuleSchemaPathPattern(), moduleName);
                    String moduleMdmsPath = serviceConfig.getModulePath(
                            serviceConfig.getDevModuleMdmsDataPathPattern(), moduleName);
                    String moduleLocalizationPath = serviceConfig.getModulePath(
                            serviceConfig.getDevModuleLocalizationDataPathPattern(), moduleName);
                    String moduleWorkflowPath = serviceConfig.getModulePath(
                            serviceConfig.getDevModuleWorkflowDataPathPattern(), moduleName);

                    schemaLoader.loadSchemasFromPath(defaultDataRequest, moduleSchemaPath);
                    mdmsBulkLoader.loadAllMdmsData(tenantCode, requestInfo, moduleMdmsPath);
                    localizationUtil.upsertLocalizationFromFile(defaultDataRequest, moduleLocalizationPath);
                    workflowConfigLoader.loadWorkflowConfigFromPath(tenantCode, moduleWorkflowPath);
                }
            }

            log.info("Data loading completed successfully for tenant: {}", tenantCode);
        } catch (Exception e) {
            log.error("StartupDataInitializer failed: {}", e.getMessage(), e);
        }
    }
}
