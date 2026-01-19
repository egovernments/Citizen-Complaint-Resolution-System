package org.egov.handler.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import lombok.extern.slf4j.Slf4j;
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

    private final SchemaLoader schemaLoader;

    private final WorkflowConfigLoader workflowConfigLoader;

    @Autowired
    public DataHandlerService(MdmsV2Util mdmsV2Util, HrmsUtil hrmsUtil, LocalizationUtil localizationUtil,
                              TenantManagementUtil tenantManagementUtil, ServiceConfiguration serviceConfig,
                              ObjectMapper objectMapper, ResourceLoader resourceLoader, WorkflowUtil workflowUtil,
                              CustomKafkaTemplate producer, MdmsBulkLoader mdmsBulkLoader, RestTemplate restTemplate,
                              SchemaLoader schemaLoader, WorkflowConfigLoader workflowConfigLoader) {
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
        this.schemaLoader = schemaLoader;
        this.workflowConfigLoader = workflowConfigLoader;
    }

    public void createDefaultData(DefaultDataRequest defaultDataRequest) {
        if (defaultDataRequest.getSchemaCodes() != null) {
            List<String> schemaCodes = new ArrayList<>(defaultDataRequest.getSchemaCodes());
            if (schemaCodes.contains(TENANT_BOUNDARY_SCHEMA)) {
                createTenantBoundarydata(defaultDataRequest.getRequestInfo(), defaultDataRequest.getTargetTenantId());
                schemaCodes.remove(TENANT_BOUNDARY_SCHEMA);
            }
            DefaultMdmsDataRequest defaultMdmsDataRequest = DefaultMdmsDataRequest.builder().requestInfo(defaultDataRequest.getRequestInfo()).targetTenantId(defaultDataRequest.getTargetTenantId()).schemaCodes(schemaCodes).onlySchemas(defaultDataRequest.getOnlySchemas()).defaultTenantId(serviceConfig.getDefaultTenantId()).build();
            mdmsV2Util.createDefaultMdmsData(defaultMdmsDataRequest);
        }



//        if (defaultDataRequest.getLocales() != null && defaultDataRequest.getModules() != null) {
//            for (String locale : defaultDataRequest.getLocales()) {
//                DefaultLocalizationDataRequest defaultLocalizationDataRequest = DefaultLocalizationDataRequest.builder().requestInfo(defaultDataRequest.getRequestInfo()).targetTenantId(defaultDataRequest.getTargetTenantId()).locale(locale).modules(defaultDataRequest.getModules()).build();
//                localizationUtil.upsertLocalizationFromFile(defaultLocalizationDataRequest);
//            }
//        }
    }

    public User createUserFromFile(TenantRequest tenantRequest, String userFilePath) throws IOException {
        String tenantCode = tenantRequest.getTenant().getCode();
        StringBuilder uri = new StringBuilder(serviceConfig.getUserHost())
                .append(serviceConfig.getUserContextPath())
                .append(serviceConfig.getUserCreateEndpoint());

        ArrayList<User> userList = new ArrayList<>();

        try {
            log.info("Reading User file from {} for tenant: {}", userFilePath, tenantCode);
            Resource resource = resourceLoader.getResource(userFilePath);
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


    public void createEmployeeFromFile(RequestInfo requestInfo, String employeeFilePath) throws IOException {
        String uri = serviceConfig.getHrmsHost() + serviceConfig.getHrmsCreatePath();
        String userUpdateUrl = serviceConfig.getUserHost() +serviceConfig.getUserContextPath() + serviceConfig.getUserUpdateEndpoint();
        String tenantId = requestInfo.getUserInfo().getTenantId();

        try {
            log.info("Reading Employee file from {}", employeeFilePath);
            Resource resource = resourceLoader.getResource(employeeFilePath);
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


    public void createMdmsSchemaFromFile(DefaultDataRequest defaultDataRequest) throws IOException {
        try{
            String mdmsSchemaCreateUri = serviceConfig.getMdmsSchemaCreateURI();

            String tenantId = defaultDataRequest.getTargetTenantId();
            RequestInfo requestInfo = defaultDataRequest.getRequestInfo();

            Resource[] resources = new PathMatchingResourcePatternResolver()
                    .getResources("classpath:schema/*.json");

            for (Resource resource : resources) {
                String rawJson = StreamUtils.copyToString(resource.getInputStream(), StandardCharsets.UTF_8);

                rawJson = rawJson.replace("{tenantid}", tenantId);

                // Parse schema array from file
                JsonNode schemaArray = new ObjectMapper().readTree(rawJson);
                for (JsonNode schemaNode : schemaArray) {
                    try {
                        ObjectNode payload = objectMapper.createObjectNode();
                        payload.set("RequestInfo", objectMapper.valueToTree(requestInfo));
                        payload.set("SchemaDefinition", schemaNode);

                        HttpHeaders headers = new HttpHeaders();
                        headers.setContentType(MediaType.APPLICATION_JSON);
                        HttpEntity<JsonNode> request = new HttpEntity<>(payload, headers);

                        restTemplate.postForObject(mdmsSchemaCreateUri, request, Object.class);
                        log.info("MDMS schema created successfully: {}", schemaNode.get("code").asText());
                    } catch (Exception innerEx) {
                        log.error("Failed to create schema: {} for tenant: {}. Skipping...",
                                schemaNode.get("code"), tenantId, innerEx);
                        // Continue with next schemaNode
                    }
                }
            }

        } catch (Exception e) {
            log.error("Failed to create mdms schema for tenant: {}", defaultDataRequest.getTargetTenantId(), e);
//            throw new CustomException("MDMS_SCHEMA_CREATE_FAILED", "Failed to create mdms schema: " + e.getMessage());
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

        if (Objects.equals(dataSetupRequest.getModule(), "PGR")) {
            createPgrWorkflowConfig(dataSetupRequest.getTargetTenantId());
        }

        if (dataSetupRequest.getSchemaCodes() == null) {
            if (Objects.equals(dataSetupRequest.getModule(), "PGR")) {
                defaultDataRequest.setSchemaCodes(serviceConfig.getMdmsSchemacodeMap().get("PGR"));
            }
            if (Objects.equals(dataSetupRequest.getModule(), "HRMS")) {
                defaultDataRequest.setSchemaCodes(serviceConfig.getMdmsSchemacodeMap().get("HRMS"));
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
        Resource resource = resourceLoader.getResource(serviceConfig.getPgrWorkflowConfigFile());
        try (InputStream inputStream = resource.getInputStream()) {
            BusinessServiceRequest businessServiceRequest = objectMapper.readValue(inputStream, BusinessServiceRequest.class);
            businessServiceRequest.getBusinessServices().forEach(service -> service.setTenantId(targetTenantId));
            workflowUtil.createWfConfig(businessServiceRequest);
        } catch (IOException e) {
            log.error("Error reading or mapping JSON file: {}", e.getMessage());
//            throw new CustomException("IO_EXCEPTION", "Error reading or mapping JSON file: " + e.getMessage());
        }
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

        Resource resource = resourceLoader.getResource(serviceConfig.getDefaultHrmsTemplateFile());
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

    /**
     * Load production tenant data (mdmsData, localisations, and schema)
     * This method loads production data for a new tenant using the module-based folder structure
     * @param newTenantRequest - Request containing tenant information
     */
    public void loadNewTenantProductionData(NewTenantRequest newTenantRequest) {
        try {
            String targetTenantId = newTenantRequest.getTargetTenantId();
            RequestInfo requestInfo = newTenantRequest.getRequestInfo();
            List<String> moduleList = serviceConfig.getModuleList();

            log.info("Loading production tenant data for new tenant: {}, modules: {}",
                    targetTenantId, moduleList.isEmpty() ? "COMMON ONLY" : moduleList);

            // Ensure UserInfo is present (create dummy if needed)
            if (requestInfo.getUserInfo() == null) {
                org.egov.common.contract.request.User dummyUser = new org.egov.common.contract.request.User();
                dummyUser.setId(1L);
                dummyUser.setUserName("system");
                dummyUser.setTenantId(targetTenantId);
                requestInfo.setUserInfo(dummyUser);
                log.info("Created dummy user info for tenant: {}", targetTenantId);
            } else {
                requestInfo.getUserInfo().setTenantId(targetTenantId);
            }

            // Create DefaultDataRequest with all default schemas
            DefaultDataRequest defaultDataRequest = DefaultDataRequest.builder()
                    .requestInfo(requestInfo)
                    .targetTenantId(targetTenantId)
                    .schemaCodes(serviceConfig.getDefaultMdmsSchemaList())
                    .onlySchemas(Boolean.FALSE)
                    .locales(serviceConfig.getDefaultLocalizationLocaleList())
                    .modules(serviceConfig.getDefaultLocalizationModuleList())
                    .build();

            // ===== LOAD PROD COMMON DATA =====
            log.info("Step 1: Loading PROD common schemas");
            schemaLoader.loadSchemasFromPath(defaultDataRequest, serviceConfig.getProdCommonSchemaPath());

            log.info("Step 2: Loading PROD common MDMS data");
            mdmsBulkLoader.loadAllMdmsData(targetTenantId, requestInfo, serviceConfig.getProdCommonMdmsDataPath());

            log.info("Step 3: Loading PROD common localization");
            localizationUtil.upsertLocalizationFromFile(defaultDataRequest, serviceConfig.getProdCommonLocalizationDataPath());

            log.info("Step 4: Loading PROD common workflow config");
            workflowConfigLoader.loadWorkflowConfigFromPath(targetTenantId, serviceConfig.getProdCommonWorkflowDataPath());

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
                mdmsBulkLoader.loadAllMdmsData(targetTenantId, requestInfo, moduleMdmsPath);
                localizationUtil.upsertLocalizationFromFile(defaultDataRequest, moduleLocalizationPath);
                workflowConfigLoader.loadWorkflowConfigFromPath(targetTenantId, moduleWorkflowPath);
            }

            // ===== LOAD DEV DATA (only if dev.enabled=true) =====
            if (serviceConfig.isDevEnabled()) {
                log.info("Dev mode enabled, loading DEV data...");

                // Load DEV common data
                schemaLoader.loadSchemasFromPath(defaultDataRequest, serviceConfig.getDevCommonSchemaPath());
                mdmsBulkLoader.loadAllMdmsData(targetTenantId, requestInfo, serviceConfig.getDevCommonMdmsDataPath());
                localizationUtil.upsertLocalizationFromFile(defaultDataRequest, serviceConfig.getDevCommonLocalizationDataPath());
                workflowConfigLoader.loadWorkflowConfigFromPath(targetTenantId, serviceConfig.getDevCommonWorkflowDataPath());

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
                    mdmsBulkLoader.loadAllMdmsData(targetTenantId, requestInfo, moduleMdmsPath);
                    localizationUtil.upsertLocalizationFromFile(defaultDataRequest, moduleLocalizationPath);
                    workflowConfigLoader.loadWorkflowConfigFromPath(targetTenantId, moduleWorkflowPath);
                }
            }

            // ===== CREATE USERS AND EMPLOYEES =====
            log.info("Step 5: Creating default users and employees");
            Tenant newTenant = new Tenant();
            newTenant.setCode(targetTenantId);
            newTenant.setName(targetTenantId);
            newTenant.setEmail("admin@" + targetTenantId + ".com");

            TenantRequest tenantRequest = TenantRequest.builder()
                    .requestInfo(requestInfo)
                    .tenant(newTenant)
                    .build();

            try {
                User superUser = createUserFromFile(tenantRequest, serviceConfig.getDefaultUserDataFile());
                if (superUser != null) {
                    log.info("Default users created for tenant: {}", targetTenantId);
                } else {
                    log.warn("No SUPERUSER found in created users");
                }

                createEmployeeFromFile(requestInfo, serviceConfig.getDefaultEmployeeDataFile());
                log.info("Default employees created for tenant: {}", targetTenantId);
            } catch (Exception e) {
                log.error("Failed to create users/employees (non-critical): {}", e.getMessage());
            }

            log.info("========================================");
            log.info("Tenant {} created successfully", targetTenantId);
            log.info("Loaded: Common + Module data for modules: {}", moduleList);
            log.info("========================================");
        } catch (Exception e) {
            log.error("Failed to load production tenant data for tenant: {}", newTenantRequest.getTargetTenantId(), e);
            throw new CustomException("TENANT_CREATION_FAILED", "Failed to create new tenant with production data: " + e.getMessage());
        }
    }

}
