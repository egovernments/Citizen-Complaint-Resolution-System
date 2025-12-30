package org.egov.handler.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import jakarta.annotation.PostConstruct;
import lombok.extern.slf4j.Slf4j;
import org.apache.kafka.clients.producer.KafkaProducer;
import org.egov.common.contract.request.RequestInfo;
import org.egov.handler.config.ServiceConfiguration;
import org.egov.handler.util.*;
import org.egov.handler.web.models.*;
import org.egov.tracer.kafka.CustomKafkaTemplate;
import org.egov.tracer.model.CustomException;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.io.Resource;
import org.springframework.core.io.ResourceLoader;
import org.springframework.core.io.support.PathMatchingResourcePatternResolver;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.util.StreamUtils;
import org.springframework.web.client.RestTemplate;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.util.*;

import static org.egov.handler.config.ServiceConstants.TENANT_BOUNDARY_SCHEMA;
import static org.egov.handler.constants.UserConstants.*;

@Slf4j
@Service
public class DataHandlerService {

    private final MdmsV2Util mdmsV2Util;

    private final HrmsUtil hrmsUtil;

    private final LocalizationUtil localizationUtil;

    private final TenantManagementUtil tenantManagementUtil;

    private final ServiceConfiguration serviceConfig;

    private final ObjectMapper objectMapper;

    private final ResourceLoader resourceLoader;

    private final WorkflowUtil workflowUtil;

    private final CustomKafkaTemplate producer;

    private final MdmsBulkLoader mdmsBulkLoader;

    private final RestTemplate restTemplate;

    @Autowired
    public DataHandlerService(MdmsV2Util mdmsV2Util, HrmsUtil hrmsUtil, LocalizationUtil localizationUtil, TenantManagementUtil tenantManagementUtil, ServiceConfiguration serviceConfig, ObjectMapper objectMapper, ResourceLoader resourceLoader, WorkflowUtil workflowUtil, CustomKafkaTemplate producer, MdmsBulkLoader mdmsBulkLoader, RestTemplate restTemplate) {
        this.mdmsV2Util = mdmsV2Util;
        this.hrmsUtil = hrmsUtil;
        this.localizationUtil = localizationUtil;
        this.tenantManagementUtil = tenantManagementUtil;
        this.serviceConfig = serviceConfig;
        this.objectMapper = objectMapper;
        this.resourceLoader = resourceLoader;
        this.workflowUtil = workflowUtil;
        this.producer = producer;
        this.mdmsBulkLoader = mdmsBulkLoader;
        this.restTemplate = restTemplate;
    }

    public void createDefaultData(DefaultDataRequest defaultDataRequest) {
        List<String> schemaCodes;

        // Auto-discover schema codes if not provided
        if (defaultDataRequest.getSchemaCodes() != null) {
            schemaCodes = new ArrayList<>(defaultDataRequest.getSchemaCodes());
        } else {
            // Discover schema codes for all enabled modules
            schemaCodes = discoverAllEnabledModuleSchemaCodes();
            if (schemaCodes.isEmpty()) {
                log.warn("No schema codes found for enabled modules. Skipping data copy.");
                return;
            }
            log.info("Auto-discovered {} schema codes for all enabled modules", schemaCodes.size());
        }

        if (schemaCodes.contains(TENANT_BOUNDARY_SCHEMA)) {
            createTenantBoundarydata(defaultDataRequest.getRequestInfo(), defaultDataRequest.getTargetTenantId());
            schemaCodes.remove(TENANT_BOUNDARY_SCHEMA);
        }

        DefaultMdmsDataRequest defaultMdmsDataRequest = DefaultMdmsDataRequest.builder()
                .requestInfo(defaultDataRequest.getRequestInfo())
                .targetTenantId(defaultDataRequest.getTargetTenantId())
                .schemaCodes(schemaCodes)
                .onlySchemas(defaultDataRequest.getOnlySchemas())
                .defaultTenantId(serviceConfig.getDefaultTenantId())
                .build();
        mdmsV2Util.createDefaultMdmsData(defaultMdmsDataRequest);
    }

    public User createUserFromFile(TenantRequest tenantRequest) throws IOException {
        String tenantCode = tenantRequest.getTenant().getCode();
        StringBuilder uri = new StringBuilder(serviceConfig.getUserHost())
                .append(serviceConfig.getUserContextPath())
                .append(serviceConfig.getUserCreateEndpoint());

        ArrayList<User> userList = new ArrayList<>();

        try {
            log.info("Reading User.json for tenant: {}", tenantCode);
            Resource resource = resourceLoader.getResource("classpath:User.json");
            String rawJson = StreamUtils.copyToString(resource.getInputStream(), StandardCharsets.UTF_8);

            rawJson = rawJson.replace("{tenantid}", tenantCode);

            // Parse as array
            JsonNode userArray = objectMapper.readTree(rawJson);

            // Prepare requestInfo
            RequestInfo requestInfo = tenantRequest.getRequestInfo();
            JsonNode requestInfoNode = objectMapper.valueToTree(requestInfo);

            for (JsonNode userNode : userArray) {
                try {
                    ObjectNode requestPayload = objectMapper.createObjectNode();
                    requestPayload.set("requestInfo", requestInfoNode);
                    requestPayload.set("user", userNode);

                    String finalPayload = objectMapper.writeValueAsString(requestPayload);
                    HttpHeaders headers = new HttpHeaders();
                    headers.setContentType(MediaType.APPLICATION_JSON);
                    HttpEntity<String> entity = new HttpEntity<>(finalPayload, headers);

                    User user = restTemplate.postForObject(uri.toString(), entity, User.class);
                    userList.add(user);
                    log.info("User created successfully with username: {}", user.getUserName());
                } catch (Exception e) {
                    log.error("Failed to create user from payload: {} | Error: {}", userNode, e.getMessage());
                }
            }

            for (User user : userList) {
                if (user.getRoles() != null && user.getRoles().stream()
                        .anyMatch(role -> "SUPERUSER".equalsIgnoreCase(role.getCode()))) {
                    log.info("Returning SUPERUSER: {}", user.getUserName());
                    return user;
                }
            }

        } catch (Exception e) {
            log.error("Error creating users from User.json for tenant {}: {}", tenantCode, e.getMessage(), e);
            throw new CustomException("USER_CREATION_FAILED", "Failed to create users for tenant: " + tenantCode);
        }

        return null;
    }


    public void createEmployeeFromFile(RequestInfo requestInfo) throws IOException {
        String uri = serviceConfig.getHrmsHost() + serviceConfig.getHrmsCreatePath();
        String userUpdateUrl = serviceConfig.getUserHost() +serviceConfig.getUserContextPath() + serviceConfig.getUserUpdateEndpoint();
        String tenantId = requestInfo.getUserInfo().getTenantId();

        try {
            Resource resource = resourceLoader.getResource("classpath:HRMS.json");
            String rawJson = StreamUtils.copyToString(resource.getInputStream(), StandardCharsets.UTF_8);

            // Replace placeholders with tenant ID
            rawJson = rawJson.replace("{tenantid}", tenantId);

            // Parse the raw JSON into an array of employees
            ArrayNode employeesArray = (ArrayNode) objectMapper.readTree(rawJson);

            for (JsonNode employeeNode : employeesArray) {
                try {
                    // Build individual payload
                    ObjectNode payload = objectMapper.createObjectNode();
                    payload.set("Employees", objectMapper.createArrayNode().add(employeeNode));
                    payload.set("RequestInfo", objectMapper.valueToTree(requestInfo));

                    HttpHeaders headers = new HttpHeaders();
                    headers.setContentType(MediaType.APPLICATION_JSON);

                    HttpEntity<JsonNode> entity = new HttpEntity<>(payload, headers);
                    Object response = restTemplate.postForObject(uri, entity, Object.class);
                    log.info("Employee created successfully: {}", employeeNode.get("code").asText());

                    // Convert response to JsonNode
                    JsonNode responseJson = objectMapper.convertValue(response, JsonNode.class);

                    // Extract user from response
                    JsonNode userNode = responseJson.at("/Employees/0/user");
                    if (!userNode.isMissingNode()) {
                        ObjectNode updatedUser = (ObjectNode) userNode.deepCopy();

                        // Set password
                        updatedUser.put("password", "eGov@123");

                        // Prepare update payload
                        ObjectNode updatePayload = objectMapper.createObjectNode();
                        updatePayload.set("user", updatedUser);
                        updatePayload.set("requestInfo", objectMapper.valueToTree(requestInfo)); // Use appropriate requestInfo

                        // Send update request
                        HttpHeaders updateHeaders = new HttpHeaders();
                        updateHeaders.setContentType(MediaType.APPLICATION_JSON);

                        HttpEntity<JsonNode> updateEntity = new HttpEntity<>(updatePayload, updateHeaders);

                        restTemplate.postForObject(userUpdateUrl, updateEntity, Object.class);

                        log.info("Password updated for user: {}", updatedUser.get("userName").asText());
                    } else {
                        log.error("User node missing in HRMS response for employee: {}", employeeNode.get("code").asText());
                    }

                } catch (Exception e) {
                    log.error("Failed to create employee: {} | Error: {}",
                            employeeNode.get("code").asText(), e.getMessage(), e);
                }
            }

        } catch (Exception e) {
            log.error("Failed to read HRMS.json or create employees for tenant: {}", tenantId, e);
        }
    }

    /**
     * Create MDMS schemas from files
     * Loading order (tenant schema loaded first for dependency):
     * 1. Tenant schema (schema/common/tenant.json) - Must be first
     * 2. Other common schemas (schema/common/*.json) - Shared across all modules
     * 3. Module schemas (schema/modules/{MODULE}/*.json) - Loaded only if module enabled
     * 4. Legacy schemas (schema/*.json) - For backward compatibility
     */
    public void createMdmsSchemaFromFile(DefaultDataRequest defaultDataRequest) throws IOException {
        String tenantId = defaultDataRequest.getTargetTenantId();
        RequestInfo requestInfo = defaultDataRequest.getRequestInfo();

        // Step 1: Load TENANT schema FIRST (required before other schemas)
        log.info("Loading tenant schema first...");
        loadSchemasFromPattern("classpath:schema/common/tenant.json", tenantId, requestInfo, "tenant");

        // Step 2: Load other COMMON schemas (excluding tenant.json which is already loaded)
        loadCommonSchemasExcludingTenant(tenantId, requestInfo);

        // Step 3: Load MODULE-SPECIFIC schemas (only for enabled modules)
        List<String> enabledModules = serviceConfig.getEnabledModules();
        if (enabledModules != null && !enabledModules.isEmpty()) {
            for (String module : enabledModules) {
                String pattern = "classpath:schema/modules/" + module.trim() + "/*.json";
                loadSchemasFromPattern(pattern, tenantId, requestInfo, module.trim());
            }
        }

        // Step 4: Load LEGACY schemas (schema/*.json - for backward compatibility)
        loadLegacySchemas(tenantId, requestInfo);
    }

    /**
     * Load common schemas excluding tenant.json (which is loaded first separately)
     */
    private void loadCommonSchemasExcludingTenant(String tenantId, RequestInfo requestInfo) {
        try {
            PathMatchingResourcePatternResolver resolver = new PathMatchingResourcePatternResolver();
            Resource[] resources = resolver.getResources("classpath:schema/common/*.json");

            for (Resource resource : resources) {
                // Skip tenant.json (already loaded in Step 1)
                if ("tenant.json".equals(resource.getFilename())) {
                    continue;
                }
                processSchemaResource(resource, tenantId, requestInfo, "common");
            }
        } catch (IOException e) {
            log.error("Failed to load common schemas: {}", e.getMessage());
        }
    }

    /**
     * Load schemas from a specific pattern
     */
    private void loadSchemasFromPattern(String pattern, String tenantId, RequestInfo requestInfo, String source) {
        try {
            PathMatchingResourcePatternResolver resolver = new PathMatchingResourcePatternResolver();
            Resource[] resources = resolver.getResources(pattern);

            if (resources.length == 0) {
                log.info("No schema files found at pattern: {}", pattern);
                return;
            }

            log.info("Found {} schema files for {}", resources.length, source);

            for (Resource resource : resources) {
                processSchemaResource(resource, tenantId, requestInfo, source);
            }
        } catch (IOException e) {
            log.error("Failed to scan schema directory for {}: {}", source, e.getMessage());
        }
    }

    /**
     * Load legacy schemas from schema/*.json (excluding common/ and modules/ folders)
     */
    private void loadLegacySchemas(String tenantId, RequestInfo requestInfo) {
        try {
            PathMatchingResourcePatternResolver resolver = new PathMatchingResourcePatternResolver();
            Resource[] resources = resolver.getResources("classpath:schema/*.json");

            for (Resource resource : resources) {
                // Skip if this is inside common/ or modules/ folder
                String path = resource.getURL().getPath();
                if (path.contains("/common/") || path.contains("/modules/")) {
                    continue;
                }
                processSchemaResource(resource, tenantId, requestInfo, "legacy");
            }
        } catch (IOException e) {
            log.error("Failed to load legacy schemas: {}", e.getMessage());
        }
    }

    /**yes
     * Process a single schema resource file
     */
    private void processSchemaResource(Resource resource, String tenantId, RequestInfo requestInfo, String source) {
        try {
            String mdmsSchemaCreateUri = serviceConfig.getMdmsSchemaCreateURI();
            String rawJson = StreamUtils.copyToString(resource.getInputStream(), StandardCharsets.UTF_8);
            rawJson = rawJson.replace("{tenantid}", tenantId);

            // Parse schema array from file
            JsonNode schemaArray = objectMapper.readTree(rawJson);

            // Handle both array and single object formats
            if (!schemaArray.isArray()) {
                schemaArray = objectMapper.createArrayNode().add(schemaArray);
            }

            for (JsonNode schemaNode : schemaArray) {
                try {
                    ObjectNode payload = objectMapper.createObjectNode();
                    payload.set("RequestInfo", objectMapper.valueToTree(requestInfo));
                    payload.set("SchemaDefinition", schemaNode);

                    HttpHeaders headers = new HttpHeaders();
                    headers.setContentType(MediaType.APPLICATION_JSON);
                    HttpEntity<JsonNode> request = new HttpEntity<>(payload, headers);

                    restTemplate.postForObject(mdmsSchemaCreateUri, request, Object.class);
                    log.info("[{}] Schema created: {}", source, schemaNode.get("code").asText());
                } catch (Exception innerEx) {
                    log.error("[{}] Failed to create schema: {} for tenant: {}. Skipping...",
                            source, schemaNode.get("code"), tenantId);
                }
            }
        } catch (Exception e) {
            log.error("Error processing schema file {}: {}", resource.getFilename(), e.getMessage());
        }
    }

    public void createBoundaryDataFromFile(DefaultDataRequest defaultDataRequest) throws IOException {

        createBoundaryDefinitionFromFile(defaultDataRequest.getRequestInfo(), defaultDataRequest.getTargetTenantId());
        createBoundaryEntityFromFile(defaultDataRequest.getRequestInfo(), defaultDataRequest.getTargetTenantId());
        createBoundaryRelationshipFromFile(defaultDataRequest.getRequestInfo(), defaultDataRequest.getTargetTenantId());
    }

    public void createBoundaryDefinitionFromFile(RequestInfo requestInfo, String targetTenantId) throws IOException {
        try{
            String hierarchyDefinitionCreateUri = serviceConfig.getHierarchyDefinitionCreateUri();

            Resource resource = resourceLoader.getResource("classpath:boundary/hierarchy-definition/hierarchy.json");
            InputStream inputStream = resource.getInputStream();

            // Read file content as raw JSON string
            String rawJson = StreamUtils.copyToString(inputStream, StandardCharsets.UTF_8);

            rawJson = rawJson.replace("{tenantid}", targetTenantId);

            JsonNode boundaryPayload = objectMapper.readTree(rawJson);

            Map<String, Object> payload = new HashMap<>();
            payload.put("RequestInfo", requestInfo);
            payload.put("BoundaryHierarchy", boundaryPayload.get("BoundaryHierarchy"));
            System.out.println(payload);

            restTemplate.postForObject(hierarchyDefinitionCreateUri, payload, Object.class);
            log.info("Created boundary hierarchy for tenant: {}", targetTenantId);
        }
        catch (Exception e) {
            log.error("Failed to create boundary hierarchy for tenant: {}", targetTenantId);
//            throw new CustomException("BOUNDARY_DATA_CREATE_FAILED", "Failed to create boundary data for " + targetTenantId + " : " + e.getMessage());
        }
    }

    public void createBoundaryEntityFromFile(RequestInfo requestInfo, String targetTenantId) throws IOException {
        try{
            String hierarchyEntityCreateUri = serviceConfig.getBoundaryEntityCreateUri();

            Resource resource = resourceLoader.getResource("classpath:boundary/entity/entity.json");
            InputStream inputStream = resource.getInputStream();

            // Read file content as raw JSON string
            String rawJson = StreamUtils.copyToString(inputStream, StandardCharsets.UTF_8);

            rawJson = rawJson.replace("{tenantid}", targetTenantId);

            JsonNode boundaryArrayNode = objectMapper.readTree(rawJson);

            Map<String, Object> payload = new HashMap<>();
            payload.put("RequestInfo", requestInfo);
            payload.put("Boundary", objectMapper.convertValue(boundaryArrayNode, List.class));
            System.out.println(payload);

            restTemplate.postForObject(hierarchyEntityCreateUri, payload, Object.class);
            log.info("Created boundary hierarchy entity for tenant: {}", targetTenantId);
        }
        catch (Exception e) {
            log.error("Failed to create boundary hierarchy entity for tenant: {}", targetTenantId);
//            throw new CustomException("BOUNDARY_DATA_CREATE_FAILED", "Failed to create boundary data for " + targetTenantId + " : " + e.getMessage());
        }
    }

    public void createBoundaryRelationshipFromFile(RequestInfo requestInfo, String targetTenantId) throws IOException {
        try{
            String hierarchyRelationshipCreateUri = serviceConfig.getBoundaryRelationshipCreateUri();

            Resource resource = resourceLoader.getResource("classpath:boundary/relationship/relationship.json");
            InputStream inputStream = resource.getInputStream();

            // Read file content as raw JSON string
            String rawJson = StreamUtils.copyToString(inputStream, StandardCharsets.UTF_8);

            rawJson = rawJson.replace("{tenantid}", targetTenantId);
            JsonNode relationshipArray = objectMapper.readTree(rawJson);
            JsonNode requestInfoNode = objectMapper.valueToTree(requestInfo);

            for (JsonNode relationship : relationshipArray) {
                try {
                    ObjectNode payload = objectMapper.createObjectNode();
                    payload.set("RequestInfo", requestInfoNode);
                    payload.set("BoundaryRelationship", relationship);

                    HttpHeaders headers = new HttpHeaders();
                    headers.setContentType(MediaType.APPLICATION_JSON);

                    HttpEntity<JsonNode> entity = new HttpEntity<>(payload, headers);

                    restTemplate.postForObject(hierarchyRelationshipCreateUri, entity, Object.class);

                    log.info("Created boundary relationship entry for tenant: {}", targetTenantId);
                } catch (Exception ex) {
                    log.error("Failed to create individual boundary relationship entry for tenant: {}. Skipping...",
                            targetTenantId, ex);
                    // continue with next entry
                }
            }
            log.info("Created boundary hierarchy relationship for tenant: {}", targetTenantId);
        }
        catch (Exception e) {
            log.error("Failed to create boundary hierarchy relationship for tenant: {}", targetTenantId);
//            throw new CustomException("BOUNDARY_DATA_CREATE_FAILED", "Failed to create boundary data for " + targetTenantId + " : " + e.getMessage());
        }
    }


    private void createTenantBoundarydata(RequestInfo requestInfo, String targetTenantId) {
        List<String> schemaCodes = new ArrayList<>(Collections.singletonList(TENANT_BOUNDARY_SCHEMA));

        DefaultMdmsDataRequest defaultMdmsDataRequest = DefaultMdmsDataRequest.builder().requestInfo(requestInfo).targetTenantId(targetTenantId).schemaCodes(schemaCodes).onlySchemas(Boolean.TRUE).defaultTenantId(serviceConfig.getDefaultTenantId()).build();
        mdmsV2Util.createDefaultMdmsData(defaultMdmsDataRequest);

        // Search data for the schema code in default tenetId
        List<Mdms> mdmsList = getAllMdmsResults(serviceConfig.getDefaultTenantId(), TENANT_BOUNDARY_SCHEMA, requestInfo);
        // Create schema data in the given tenantId
        for (Mdms mdms : mdmsList) {
            mdms.setTenantId(targetTenantId);

            JsonNode dataNode = mdms.getData();
            if (dataNode.has("boundary")) {
                // Cast the 'boundary' node to ObjectNode so that we can modify it
                ObjectNode boundaryNode = (ObjectNode) dataNode.get("boundary");

                // Modify the 'code' field within the 'boundary' node
                boundaryNode.put("code", targetTenantId);

                // Set the modified 'data' back to the Mdms object (optional, since it's mutable)
                ((ObjectNode) dataNode).set("boundary", boundaryNode);
                mdms.setData(dataNode);
            } else {
                log.info("Boundary node does not exist in the data.");
            }
            MdmsRequest mdmsRequest = MdmsRequest.builder().requestInfo(requestInfo).mdms(mdms).build();
            log.info("{} : {}", mdms.getSchemaCode(), mdms.getUniqueIdentifier());
            mdmsV2Util.createMdmsData(mdmsRequest);
        }
    }

    // Method to get all search results with pagination
    public List<Mdms> getAllMdmsResults(String tenantId, String schemaCode, RequestInfo requestInfo) {
        List<Mdms> allMdmsResults = new ArrayList<>();
        int limit = 100; // Default limit
        int offset = 0; // Default offset

        while (true) {
            // Create MdmsCriteriaV2 with current offset and limit
            MdmsCriteriaV2 mdmsCriteria = MdmsCriteriaV2.builder().tenantId(tenantId).schemaCode(schemaCode).offset(offset).limit(limit).build();

            MdmsCriteriaReqV2 mdmsCriteriaReq = MdmsCriteriaReqV2.builder().requestInfo(requestInfo).mdmsCriteria(mdmsCriteria).build();

            // Fetch results from the repository
            MdmsResponseV2 dataSearchResponse = mdmsV2Util.searchMdmsData(mdmsCriteriaReq);
            List<Mdms> mdmsList = dataSearchResponse.getMdms();

            // Add the current batch of results to the list
            allMdmsResults.addAll(mdmsList);

            // Check if there are fewer results than the limit; if so, this is the last page
            if (mdmsList.size() < limit) {
                break;
            }

            // Update offset for the next batch
            offset += limit;
        }
        return allMdmsResults;
    }

    public void createTenantConfig(TenantRequest tenantRequest) {
        TenantConfigResponse tenantConfigSearchResponse = tenantManagementUtil.searchTenantConfig(serviceConfig.getDefaultTenantId(), tenantRequest.getRequestInfo());
        List<TenantConfig> tenantConfigList = tenantConfigSearchResponse.getTenantConfigs();

        for (TenantConfig tenantConfig : tenantConfigList) {
            // Set code and name according to target tenant
            tenantConfig.setCode(tenantRequest.getTenant().getCode());
            tenantConfig.setName(tenantRequest.getTenant().getName());

            TenantConfigRequest tenantConfigRequest = TenantConfigRequest.builder().requestInfo(tenantRequest.getRequestInfo()).tenantConfig(tenantConfig).build();

            tenantManagementUtil.createTenantConfig(tenantConfigRequest);
        }
    }

    public DefaultDataRequest setupDefaultData(DataSetupRequest dataSetupRequest) {
        DefaultDataRequest defaultDataRequest = DefaultDataRequest.builder().requestInfo(dataSetupRequest.getRequestInfo()).targetTenantId(dataSetupRequest.getTargetTenantId()).onlySchemas(dataSetupRequest.getOnlySchemas()).build();

        // Create workflow for the specified module (module-aware, not just PGR)
        if (dataSetupRequest.getModule() != null) {
            createModuleWorkflowConfig(dataSetupRequest.getTargetTenantId(), dataSetupRequest.getModule());
        }

        // Get schema codes - auto-discover from schema files
        if (dataSetupRequest.getSchemaCodes() == null && dataSetupRequest.getModule() != null) {
            List<String> discoveredCodes = discoverSchemaCodesForModule(dataSetupRequest.getModule());
            if (!discoveredCodes.isEmpty()) {
                defaultDataRequest.setSchemaCodes(discoveredCodes);
                log.info("Auto-discovered {} schema codes for module: {}", discoveredCodes.size(), dataSetupRequest.getModule());
            }
        } else {
            defaultDataRequest.setSchemaCodes(dataSetupRequest.getSchemaCodes());
        }

        try {
            createDefaultData(defaultDataRequest);
        } catch (Exception e) {
            log.error("Failed to create default data for : {}", dataSetupRequest.getTargetTenantId(), e);
            throw new CustomException("DEFAULT_DATA_CREATE_FAILED", "Failed to create default data ");
        }
        return defaultDataRequest;
    }

    public void createPgrWorkflowConfig(String targetTenantId) {
        // Load the JSON file
        Resource resource = resourceLoader.getResource("classpath:PgrWorkflowConfig.json");
        try (InputStream inputStream = resource.getInputStream()) {
            BusinessServiceRequest businessServiceRequest = objectMapper.readValue(inputStream, BusinessServiceRequest.class);
            businessServiceRequest.getBusinessServices().forEach(service -> service.setTenantId(targetTenantId));
            workflowUtil.createWfConfig(businessServiceRequest);
        } catch (IOException e) {
            log.error("Error reading or mapping JSON file: {}", e.getMessage());
//            throw new CustomException("IO_EXCEPTION", "Error reading or mapping JSON file: " + e.getMessage());
        }
    }

    /**
     * Create workflow configurations for all enabled modules
     * Loads from workflow/modules/{MODULE}/*.json
     */
    public void createAllModuleWorkflowConfigs(String targetTenantId) {
        List<String> enabledModules = serviceConfig.getEnabledModules();

        if (enabledModules == null || enabledModules.isEmpty()) {
            log.warn("No modules enabled for workflow config. Falling back to PGR workflow.");
            createPgrWorkflowConfig(targetTenantId);
            return;
        }

        log.info("Creating workflow configs for enabled modules: {}", enabledModules);

        for (String module : enabledModules) {
            createModuleWorkflowConfig(targetTenantId, module.trim());
        }
    }

    /**
     * Create workflow config for a specific module
     */
    public void createModuleWorkflowConfig(String targetTenantId, String moduleName) {
        try {
            PathMatchingResourcePatternResolver resolver = new PathMatchingResourcePatternResolver();
            String pattern = "classpath:workflow/modules/" + moduleName + "/*.json";

            Resource[] resources = resolver.getResources(pattern);

            if (resources.length == 0) {
                log.warn("No workflow config files found for module: {} at path: {}", moduleName, pattern);
                return;
            }

            log.info("Found {} workflow config files for module: {}", resources.length, moduleName);

            for (Resource resource : resources) {
                try (InputStream inputStream = resource.getInputStream()) {
                    String rawJson = StreamUtils.copyToString(inputStream, StandardCharsets.UTF_8);
                    rawJson = rawJson.replace("{tenantid}", targetTenantId);

                    BusinessServiceRequest businessServiceRequest = objectMapper.readValue(rawJson, BusinessServiceRequest.class);
                    businessServiceRequest.getBusinessServices().forEach(service -> service.setTenantId(targetTenantId));
                    workflowUtil.createWfConfig(businessServiceRequest);

                    log.info("Created workflow config from {} for module: {}", resource.getFilename(), moduleName);
                } catch (Exception e) {
                    log.error("Failed to create workflow config from {} for module {}: {}",
                            resource.getFilename(), moduleName, e.getMessage());
                }
            }
        } catch (Exception e) {
            log.error("Failed to load workflow configs for module {}: {}", moduleName, e.getMessage());
        }
    }

    /**
     * Create employees for all enabled modules
     * Loads from employees/modules/{MODULE}/HRMS.json
     */
    public void createAllModuleEmployees(RequestInfo requestInfo) {
        List<String> enabledModules = serviceConfig.getEnabledModules();

        if (enabledModules == null || enabledModules.isEmpty()) {
            log.warn("No modules enabled for employee creation. Falling back to legacy HRMS.json.");
            try {
                createEmployeeFromFile(requestInfo);
            } catch (IOException e) {
                log.error("Failed to create employees from legacy HRMS.json: {}", e.getMessage());
            }
            return;
        }

        log.info("Creating employees for enabled modules: {}", enabledModules);

        for (String module : enabledModules) {
            createModuleEmployees(requestInfo, module.trim());
        }
    }

    /**
     * Create employees for a specific module
     */
    public void createModuleEmployees(RequestInfo requestInfo, String moduleName) {
        String uri = serviceConfig.getHrmsHost() + serviceConfig.getHrmsCreatePath();
        String userUpdateUrl = serviceConfig.getUserHost() + serviceConfig.getUserContextPath() + serviceConfig.getUserUpdateEndpoint();
        String tenantId = requestInfo.getUserInfo().getTenantId();

        try {
            PathMatchingResourcePatternResolver resolver = new PathMatchingResourcePatternResolver();
            String pattern = "classpath:employees/modules/" + moduleName + "/*.json";

            Resource[] resources = resolver.getResources(pattern);

            if (resources.length == 0) {
                log.warn("No employee files found for module: {} at path: {}", moduleName, pattern);
                return;
            }

            log.info("Found {} employee files for module: {}", resources.length, moduleName);

            for (Resource resource : resources) {
                try {
                    String rawJson = StreamUtils.copyToString(resource.getInputStream(), StandardCharsets.UTF_8);
                    rawJson = rawJson.replace("{tenantid}", tenantId);

                    ArrayNode employeesArray = (ArrayNode) objectMapper.readTree(rawJson);

                    for (JsonNode employeeNode : employeesArray) {
                        try {
                            ObjectNode payload = objectMapper.createObjectNode();
                            payload.set("Employees", objectMapper.createArrayNode().add(employeeNode));
                            payload.set("RequestInfo", objectMapper.valueToTree(requestInfo));

                            HttpHeaders headers = new HttpHeaders();
                            headers.setContentType(MediaType.APPLICATION_JSON);

                            HttpEntity<JsonNode> entity = new HttpEntity<>(payload, headers);
                            Object response = restTemplate.postForObject(uri, entity, Object.class);
                            log.info("Employee created successfully for module {}: {}", moduleName,
                                    employeeNode.has("code") ? employeeNode.get("code").asText() : "unknown");

                            // Update password
                            JsonNode responseJson = objectMapper.convertValue(response, JsonNode.class);
                            JsonNode userNode = responseJson.at("/Employees/0/user");
                            if (!userNode.isMissingNode()) {
                                ObjectNode updatedUser = (ObjectNode) userNode.deepCopy();
                                updatedUser.put("password", "eGov@123");

                                ObjectNode updatePayload = objectMapper.createObjectNode();
                                updatePayload.set("user", updatedUser);
                                updatePayload.set("RequestInfo", objectMapper.valueToTree(requestInfo));

                                HttpEntity<JsonNode> updateEntity = new HttpEntity<>(updatePayload, headers);
                                restTemplate.postForObject(userUpdateUrl, updateEntity, Object.class);

                                log.info("Password updated for user: {}", updatedUser.get("userName").asText());
                            }
                        } catch (Exception e) {
                            log.error("Failed to create employee for module {}: {}", moduleName, e.getMessage());
                        }
                    }
                } catch (Exception e) {
                    log.error("Failed to process employee file {} for module {}: {}",
                            resource.getFilename(), moduleName, e.getMessage());
                }
            }
        } catch (Exception e) {
            log.error("Failed to load employee files for module {}: {}", moduleName, e.getMessage());
        }
    }

    /**
     * Discover schema codes for all enabled modules.
     * Scans common schemas and all module-specific schemas for enabled modules.
     * @return List of all schema codes found
     */
    public List<String> discoverAllEnabledModuleSchemaCodes() {
        Set<String> allSchemaCodes = new LinkedHashSet<>(); // Use Set to avoid duplicates

        try {
            PathMatchingResourcePatternResolver resolver = new PathMatchingResourcePatternResolver();

            // First, add common schemas (shared by all modules)
            Resource[] commonResources = resolver.getResources("classpath:schema/common/*.json");
            for (Resource resource : commonResources) {
                allSchemaCodes.addAll(extractSchemaCodesFromFile(resource));
            }
            log.info("Discovered {} common schema codes", allSchemaCodes.size());

            // Then add schema codes for each enabled module
            List<String> enabledModules = serviceConfig.getEnabledModules();
            if (enabledModules != null && !enabledModules.isEmpty()) {
                for (String module : enabledModules) {
                    String modulePattern = "classpath:schema/modules/" + module.trim() + "/*.json";
                    Resource[] moduleResources = resolver.getResources(modulePattern);
                    int beforeCount = allSchemaCodes.size();
                    for (Resource resource : moduleResources) {
                        allSchemaCodes.addAll(extractSchemaCodesFromFile(resource));
                    }
                    log.info("Discovered {} schema codes for module {}", allSchemaCodes.size() - beforeCount, module.trim());
                }
            }

            log.info("Total discovered schema codes for all enabled modules: {}", allSchemaCodes.size());
        } catch (Exception e) {
            log.error("Failed to discover schema codes for enabled modules: {}", e.getMessage());
        }

        return new ArrayList<>(allSchemaCodes);
    }

    /**
     * Discover schema codes from schema files for a given module.
     * Scans both common schemas and module-specific schemas.
     * @param moduleName The module name (e.g., "PGR", "TL")
     * @return List of schema codes found in schema files
     */
    public List<String> discoverSchemaCodesForModule(String moduleName) {
        List<String> schemaCodes = new ArrayList<>();

        try {
            PathMatchingResourcePatternResolver resolver = new PathMatchingResourcePatternResolver();

            // Scan common schemas
            Resource[] commonResources = resolver.getResources("classpath:schema/common/*.json");
            for (Resource resource : commonResources) {
                schemaCodes.addAll(extractSchemaCodesFromFile(resource));
            }

            // Scan module-specific schemas
            String modulePattern = "classpath:schema/modules/" + moduleName + "/*.json";
            Resource[] moduleResources = resolver.getResources(modulePattern);
            for (Resource resource : moduleResources) {
                schemaCodes.addAll(extractSchemaCodesFromFile(resource));
            }

            log.info("Discovered {} schema codes for module {} (common + module-specific)", schemaCodes.size(), moduleName);
        } catch (Exception e) {
            log.error("Failed to discover schema codes for module {}: {}", moduleName, e.getMessage());
        }

        return schemaCodes;
    }

    /**
     * Extract schema codes from a single schema file
     */
    private List<String> extractSchemaCodesFromFile(Resource resource) {
        List<String> codes = new ArrayList<>();

        try {
            String rawJson = StreamUtils.copyToString(resource.getInputStream(), StandardCharsets.UTF_8);
            JsonNode schemaArray = objectMapper.readTree(rawJson);

            // Handle both array and single object formats
            if (!schemaArray.isArray()) {
                schemaArray = objectMapper.createArrayNode().add(schemaArray);
            }

            for (JsonNode schemaNode : schemaArray) {
                if (schemaNode.has("code")) {
                    codes.add(schemaNode.get("code").asText());
                }
            }
        } catch (Exception e) {
            log.debug("Failed to extract schema codes from {}: {}", resource.getFilename(), e.getMessage());
        }

        return codes;
    }

    public void addMdmsData(DataSetupRequest dataSetupRequest) {

        List<Mdms> filteredMdmsData = new ArrayList<>();

        Resource resource = resourceLoader.getResource("classpath:MDMS.json");

        try (InputStream inputStream = resource.getInputStream()) {

            JsonNode rootNode = objectMapper.readTree(inputStream);
            Map<String, List<Mdms>> mdmsMap = new HashMap<>();

            // Iterate over each module (PGR, HRMS, etc.)
            Iterator<Map.Entry<String, JsonNode>> fields = rootNode.fields();
            while (fields.hasNext()) {
                Map.Entry<String, JsonNode> field = fields.next();
                String module = field.getKey();
                JsonNode moduleNode = field.getValue();

                // Convert the module node to List<Mdms>
                List<Mdms> mdmsList = new ArrayList<>();
                if (moduleNode.isArray()) {
                    for (JsonNode itemNode : moduleNode) {
                        Mdms mdms = objectMapper.treeToValue(itemNode, Mdms.class);
                        mdms.setData(itemNode);
                        mdmsList.add(mdms);
                    }
                }

                mdmsMap.put(module, mdmsList);
            }
            filteredMdmsData = mdmsMap.get(dataSetupRequest.getModule());
        } catch (IOException e) {
            throw new CustomException("IO_EXCEPTION", "Error reading or mapping JSON file: " + e.getMessage());
        }
        // Iterate over each filtered Mdms entry and create an MDMS entry
        for (Mdms mdms : filteredMdmsData) {
            mdms.setTenantId(dataSetupRequest.getTargetTenantId());
            mdms.setSchemaCode("ACCESSCONTROL-ROLEACTIONS.roleactions");
            String uniqueId = mdms.getData().get("actionid").asText() + "." + mdms.getData().get("rolecode").asText();
            mdms.setUniqueIdentifier(uniqueId);
            // Build an MdmsRequest for each entry
            MdmsRequest mdmsRequest = MdmsRequest.builder().requestInfo(dataSetupRequest.getRequestInfo()).mdms(mdms) // Assuming MdmsRequest has a field to set Mdms data
                    .build();

            // Call createMdmsData for each mdmsRequest
            mdmsV2Util.createMdmsData(mdmsRequest);
        }
    }

    public void createDefaultEmployee(String tenantId, String emailId, String employeeCode, String name) {

        Resource resource = resourceLoader.getResource(HRMS_CLASSPATH);
        try (InputStream inputStream = resource.getInputStream()) {
            JsonNode rootNode = objectMapper.readTree(inputStream);

            // Iterate through each employee in the Employees array
            rootNode.get("Employees").forEach(employee -> {
                ((ObjectNode) employee).put("tenantId", tenantId);
                ((ObjectNode) employee).put("code", employeeCode + "@demo.com");

                // Iterate through each jurisdiction for the employee
                employee.get("jurisdictions").forEach(jurisdiction -> {
                    ((ObjectNode) jurisdiction).put("boundary", tenantId);
                    ((ObjectNode) jurisdiction).put("tenantId", tenantId);

                    // Iterate through each role for the jurisdiction
                    jurisdiction.get("roles").forEach(role -> {
                        ((ObjectNode) role).put("tenantId", tenantId);
                    });
                });

                // Update the user details for the employee
                JsonNode userNode = employee.get("user");
                ((ObjectNode) userNode).put("name", name);
                ((ObjectNode) userNode).put("tenantId", tenantId);
                ((ObjectNode) userNode).put("emailId", emailId);

                // Iterate through roles in user node
                userNode.get("roles").forEach(role -> {
                    if ((employeeCode.equals(ASSIGNER) && !role.get("code").asText().equals(EMPLOYEE))) {
                        ((ObjectNode) role).put("code", "ASSIGNER");
                        ((ObjectNode) role).put("name", "Assigner");
                        ((ObjectNode) role).put("labelKey", "ACCESSCONTROL_ROLES_ROLES_");
                    }
                    ((ObjectNode) role).put("tenantId", tenantId);
                });
            });

            String jsonPayload = objectMapper.writeValueAsString(rootNode);

            hrmsUtil.createHrmsEmployee(jsonPayload, tenantId);
        } catch (IOException e) {
            throw new CustomException("IO_EXCEPTION", "Error reading or mapping JSON file: " + e.getMessage());
        }
    }

    public void triggerWelcomeEmail(TenantRequest tenantRequest) {

        Resource resource = resourceLoader.getResource(WELCOME_MAIL_CLASSPATH);
        String emailBody = "";
        try {
            emailBody = resource.getContentAsString(Charset.defaultCharset());
        } catch (IOException e) {
            throw new RuntimeException(e);
        }
        Email email = Email.builder().emailTo(Collections.singleton(tenantRequest.getTenant().getEmail())).tenantId(tenantRequest.getTenant().getCode()).isHTML(Boolean.TRUE).subject(WELCOME_MAIL_SUBJECT).body(emailBody).build();

        EmailRequest emailRequest = EmailRequest.builder().requestInfo(new RequestInfo()).email(email).build();
        producer.send(serviceConfig.getEmailTopic(), emailRequest);
    }

    public void defaultEmployeeSetup(String tenantId, String emailId) {
        createDefaultEmployee(tenantId, emailId, RESOLVER, "Rakesh Kumar");
        createDefaultEmployee(tenantId, emailId, ASSIGNER, "John Smith");
    }

}
