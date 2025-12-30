# Implementation Guide: Common Folder Support

This guide provides the exact code changes needed to implement the three-tier architecture with `common/` folder support.

---

## Overview of Changes

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         FILES TO MODIFY                                  │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  1. MdmsBulkLoader.java         → Add loadCommonMdmsData() method        │
│  2. LocalizationUtil.java       → Add loadCommonLocalizations() method   │
│  3. DataHandlerService.java     → Add loadCommonEmployees() method       │
│  4. ServiceConfiguration.java   → Add commonDataEnabled property         │
│  5. application.properties      → Add modules.common.enabled flag        │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 1. Update MdmsBulkLoader.java

Add support for loading common MDMS data before module-specific data.

### Current Code (Line 35-49):

```java
public void loadAllMdmsData(String tenantId, RequestInfo requestInfo) {
    List<String> enabledModules = serviceConfig.getEnabledModules();

    if (enabledModules == null || enabledModules.isEmpty()) {
        log.warn("No modules enabled. Loading from legacy mdmsData folder structure.");
        loadLegacyMdmsData(tenantId, requestInfo);
        return;
    }

    log.info("Loading MDMS data for enabled modules: {}", enabledModules);

    for (String module : enabledModules) {
        loadModuleMdmsData(tenantId, requestInfo, module.trim());
    }
}
```

### Updated Code:

```java
/**
 * Load MDMS data for all enabled modules from the modules folder structure
 * Loading order:
 * 1. Common data (mdmsData/common/**/*.json) - Always loaded first
 * 2. Module-specific data (mdmsData/modules/{MODULE}/**/*.json) - If module enabled
 * 3. Legacy data (mdmsData/**/*.json) - For backward compatibility
 *
 * @param tenantId Target tenant ID
 * @param requestInfo Request info
 */
public void loadAllMdmsData(String tenantId, RequestInfo requestInfo) {

    // Step 1: ALWAYS load common data first (shared across all modules)
    if (serviceConfig.isCommonDataEnabled()) {
        loadCommonMdmsData(tenantId, requestInfo);
    }

    // Step 2: Load module-specific data
    List<String> enabledModules = serviceConfig.getEnabledModules();

    if (enabledModules == null || enabledModules.isEmpty()) {
        log.warn("No modules enabled. Loading from legacy mdmsData folder structure.");
        loadLegacyMdmsData(tenantId, requestInfo);
        return;
    }

    log.info("Loading MDMS data for enabled modules: {}", enabledModules);

    for (String module : enabledModules) {
        loadModuleMdmsData(tenantId, requestInfo, module.trim());
    }
}

/**
 * Load common MDMS data that is shared across all modules
 * This includes: common-masters, tenant, DataSecurity, Workflow base configs
 *
 * @param tenantId Target tenant ID
 * @param requestInfo Request info
 */
public void loadCommonMdmsData(String tenantId, RequestInfo requestInfo) {
    try {
        PathMatchingResourcePatternResolver resolver = new PathMatchingResourcePatternResolver();
        String pattern = "classpath:mdmsData/common/**/*.json";

        Resource[] resources = resolver.getResources(pattern);

        if (resources.length == 0) {
            log.info("No common MDMS data files found at path: {}", pattern);
            return;
        }

        log.info("Found {} common MDMS data files", resources.length);

        for (Resource resource : resources) {
            processResource(tenantId, requestInfo, resource);
        }

        log.info("Completed loading common MDMS data");
    } catch (Exception e) {
        log.error("Failed to load common MDMS data: {}", e.getMessage(), e);
    }
}
```

---

## 2. Update LocalizationUtil.java

Add support for loading common localizations.

### Add New Method:

```java
/**
 * Load localizations for all enabled modules
 * Loading order:
 * 1. Common localizations (localisations/common/**/*.json) - Always loaded
 * 2. Module-specific localizations (localisations/modules/{MODULE}/**/*.json)
 * 3. Legacy localizations (localisations/{locale}/*.json)
 */
public void loadAllLocalizations(String tenantId, RequestInfo requestInfo) {

    // Step 1: Load common localizations first
    if (serviceConfig.isCommonDataEnabled()) {
        loadCommonLocalizations(tenantId, requestInfo);
    }

    // Step 2: Load module-specific localizations
    List<String> enabledModules = serviceConfig.getEnabledModules();

    if (enabledModules != null && !enabledModules.isEmpty()) {
        for (String module : enabledModules) {
            loadModuleLocalizations(tenantId, requestInfo, module.trim());
        }
    }

    // Step 3: Load legacy localizations for backward compatibility
    loadLegacyLocalizations(tenantId, requestInfo);
}

/**
 * Load common localizations shared across all modules
 * These include: digit-common, digit-ui base labels, etc.
 */
public void loadCommonLocalizations(String tenantId, RequestInfo requestInfo) {
    try {
        PathMatchingResourcePatternResolver resolver = new PathMatchingResourcePatternResolver();
        String pattern = "classpath:localisations/common/**/*.json";

        Resource[] resources = resolver.getResources(pattern);

        if (resources.length == 0) {
            log.info("No common localization files found at path: {}", pattern);
            return;
        }

        log.info("Found {} common localization files", resources.length);

        for (Resource resource : resources) {
            processLocalizationResource(tenantId, requestInfo, resource);
        }

        log.info("Completed loading common localizations");
    } catch (Exception e) {
        log.error("Failed to load common localizations: {}", e.getMessage(), e);
    }
}

/**
 * Load localizations for a specific module
 */
public void loadModuleLocalizations(String tenantId, RequestInfo requestInfo, String moduleName) {
    try {
        PathMatchingResourcePatternResolver resolver = new PathMatchingResourcePatternResolver();
        String pattern = "classpath:localisations/modules/" + moduleName + "/**/*.json";

        Resource[] resources = resolver.getResources(pattern);

        if (resources.length == 0) {
            log.warn("No localization files found for module: {} at path: {}", moduleName, pattern);
            return;
        }

        log.info("Found {} localization files for module: {}", resources.length, moduleName);

        for (Resource resource : resources) {
            processLocalizationResource(tenantId, requestInfo, resource);
        }

        log.info("Completed loading localizations for module: {}", moduleName);
    } catch (Exception e) {
        log.error("Failed to load localizations for module {}: {}", moduleName, e.getMessage(), e);
    }
}

/**
 * Process a single localization resource file
 */
private void processLocalizationResource(String tenantId, RequestInfo requestInfo, Resource resource) {
    try {
        String rawJson = StreamUtils.copyToString(resource.getInputStream(), StandardCharsets.UTF_8);

        // Replace tenant placeholder
        rawJson = rawJson.replace("{tenantid}", tenantId);

        // Parse as array of Message objects
        Message[] messages = objectMapper.readValue(rawJson, Message[].class);

        if (messages.length == 0) {
            return;
        }

        // Update tenant ID in all messages
        for (Message message : messages) {
            message.setTenantId(tenantId);
        }

        // Batch upsert (100 messages per request)
        List<Message> messageList = Arrays.asList(messages);
        int batchSize = 100;

        for (int i = 0; i < messageList.size(); i += batchSize) {
            int end = Math.min(i + batchSize, messageList.size());
            List<Message> batch = messageList.subList(i, end);

            CreateMessagesRequest request = CreateMessagesRequest.builder()
                .requestInfo(requestInfo)
                .tenantId(tenantId)
                .messages(batch)
                .build();

            upsertLocalizations(request);
        }

        log.info("Processed {} localizations from file: {}", messages.length, resource.getFilename());
    } catch (Exception e) {
        log.error("Error processing localization file {}: {}", resource.getFilename(), e.getMessage());
    }
}

/**
 * Legacy localization loading for backward compatibility
 */
public void loadLegacyLocalizations(String tenantId, RequestInfo requestInfo) {
    try {
        PathMatchingResourcePatternResolver resolver = new PathMatchingResourcePatternResolver();

        for (String locale : serviceConfig.getDefaultLocales()) {
            String pattern = "classpath:localisations/" + locale + "/*.json";
            Resource[] resources = resolver.getResources(pattern);

            for (Resource resource : resources) {
                // Skip if this is inside common/ or modules/ folder
                String path = resource.getURL().getPath();
                if (path.contains("/common/") || path.contains("/modules/")) {
                    continue;
                }
                processLocalizationResource(tenantId, requestInfo, resource);
            }
        }
    } catch (Exception e) {
        log.error("Failed to load legacy localizations: {}", e.getMessage());
    }
}
```

---

## 3. Update ServiceConfiguration.java

Add the new configuration property for common data loading.

### Add New Property:

```java
@Component
@Data
@NoArgsConstructor
@AllArgsConstructor
public class ServiceConfiguration {

    // Existing properties...

    @Value("#{'${modules.enabled:}'.split(',')}")
    private List<String> enabledModules;

    @Value("${modules.localization.enabled:true}")
    private boolean localizationModuleEnabled;

    @Value("${modules.workflow.enabled:true}")
    private boolean workflowModuleEnabled;

    @Value("${modules.employees.enabled:true}")
    private boolean employeesModuleEnabled;

    // NEW: Add common data loading flag
    @Value("${modules.common.enabled:true}")
    private boolean commonDataEnabled;

    // NEW: Default locales for localization
    @Value("#{'${default.localization.locale.list:en_IN}'.split(',')}")
    private List<String> defaultLocales;

    // Getters
    public List<String> getEnabledModules() {
        // Filter out empty strings
        if (enabledModules == null) return Collections.emptyList();
        return enabledModules.stream()
            .filter(m -> m != null && !m.trim().isEmpty())
            .map(String::trim)
            .collect(Collectors.toList());
    }

    public boolean isCommonDataEnabled() {
        return commonDataEnabled;
    }

    public List<String> getDefaultLocales() {
        if (defaultLocales == null) return Collections.singletonList("en_IN");
        return defaultLocales.stream()
            .filter(l -> l != null && !l.trim().isEmpty())
            .map(String::trim)
            .collect(Collectors.toList());
    }
}
```

---

## 4. Update DataHandlerService.java

Add common employee loading support.

### Add New Methods:

```java
/**
 * Create employees for all enabled modules
 * Loading order:
 * 1. Common employees (employees/common/*.json) - Always loaded first
 * 2. Module-specific employees (employees/modules/{MODULE}/*.json)
 */
public void createAllModuleEmployees(RequestInfo requestInfo) {

    // Step 1: Create common employees first (SUPERUSER, etc.)
    if (serviceConfig.isCommonDataEnabled()) {
        createCommonEmployees(requestInfo);
    }

    // Step 2: Create module-specific employees
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
 * Create common employees shared across all modules
 * Examples: SUPERUSER, System Administrator
 */
public void createCommonEmployees(RequestInfo requestInfo) {
    String uri = serviceConfig.getHrmsHost() + serviceConfig.getHrmsCreatePath();
    String userUpdateUrl = serviceConfig.getUserHost() + serviceConfig.getUserContextPath() + serviceConfig.getUserUpdateEndpoint();
    String tenantId = requestInfo.getUserInfo().getTenantId();

    try {
        PathMatchingResourcePatternResolver resolver = new PathMatchingResourcePatternResolver();
        String pattern = "classpath:employees/common/*.json";

        Resource[] resources = resolver.getResources(pattern);

        if (resources.length == 0) {
            log.info("No common employee files found at path: {}", pattern);
            return;
        }

        log.info("Found {} common employee files", resources.length);

        for (Resource resource : resources) {
            try {
                String rawJson = StreamUtils.copyToString(resource.getInputStream(), StandardCharsets.UTF_8);
                rawJson = rawJson.replace("{tenantid}", tenantId);

                ArrayNode employeesArray = (ArrayNode) objectMapper.readTree(rawJson);

                for (JsonNode employeeNode : employeesArray) {
                    createSingleEmployee(employeeNode, uri, userUpdateUrl, tenantId, requestInfo, "common");
                }
            } catch (Exception e) {
                log.error("Failed to process common employee file {}: {}",
                    resource.getFilename(), e.getMessage());
            }
        }

        log.info("Completed creating common employees");
    } catch (Exception e) {
        log.error("Failed to load common employee files: {}", e.getMessage());
    }
}

/**
 * Helper method to create a single employee
 */
private void createSingleEmployee(JsonNode employeeNode, String uri, String userUpdateUrl,
                                   String tenantId, RequestInfo requestInfo, String source) {
    try {
        ObjectNode payload = objectMapper.createObjectNode();
        payload.set("Employees", objectMapper.createArrayNode().add(employeeNode));
        payload.set("RequestInfo", objectMapper.valueToTree(requestInfo));

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);

        HttpEntity<JsonNode> entity = new HttpEntity<>(payload, headers);
        Object response = restTemplate.postForObject(uri, entity, Object.class);

        String employeeCode = employeeNode.has("code") ? employeeNode.get("code").asText() : "unknown";
        log.info("[{}] Employee created successfully: {}", source, employeeCode);

        // Update password
        JsonNode responseJson = objectMapper.convertValue(response, JsonNode.class);
        JsonNode userNode = responseJson.at("/Employees/0/user");

        if (!userNode.isMissingNode()) {
            ObjectNode updatedUser = (ObjectNode) userNode.deepCopy();
            updatedUser.put("password", "eGov@123");

            ObjectNode updatePayload = objectMapper.createObjectNode();
            updatePayload.set("user", updatedUser);
            updatePayload.set("requestInfo", objectMapper.valueToTree(requestInfo));

            HttpEntity<JsonNode> updateEntity = new HttpEntity<>(updatePayload, headers);
            restTemplate.postForObject(userUpdateUrl, updateEntity, Object.class);

            log.info("[{}] Password updated for user: {}", source, updatedUser.get("userName").asText());
        }
    } catch (Exception e) {
        String employeeCode = employeeNode.has("code") ? employeeNode.get("code").asText() : "unknown";
        log.error("[{}] Failed to create employee {}: {}", source, employeeCode, e.getMessage());
    }
}
```

---

## 5. Update application.properties

Add the new configuration property.

### Add This Line:

```properties
# ═══════════════════════════════════════════════════════════════════════════
# MODULE CONFIGURATION
# ═══════════════════════════════════════════════════════════════════════════

# Comma-separated list of enabled modules
modules.enabled=PGR,TL

# Feature toggles
modules.localization.enabled=true
modules.workflow.enabled=true
modules.employees.enabled=true

# NEW: Enable/disable common data loading (default: true)
# When true, loads data from */common/ folders before module-specific data
modules.common.enabled=true
```

---

## 6. Create Common Folder Structure

Run these commands to create the common folder structure:

```bash
cd src/main/resources

# Create common folders
mkdir -p mdmsData/common/common-masters
mkdir -p mdmsData/common/tenant
mkdir -p mdmsData/common/DataSecurity
mkdir -p mdmsData/common/Workflow

mkdir -p localisations/common/en_IN
mkdir -p localisations/common/hi_IN

mkdir -p employees/common
```

---

## 7. Move/Copy Common Data

### Move Shared Data to Common Folder:

```bash
# Move common-masters data
mv mdmsData/common-masters/*.json mdmsData/common/common-masters/

# Move tenant data
mv mdmsData/tenant/*.json mdmsData/common/tenant/

# Move DataSecurity data
mv mdmsData/DataSecurity/*.json mdmsData/common/DataSecurity/

# Move Workflow base data
mv mdmsData/Workflow/*.json mdmsData/common/Workflow/
```

### Create Common Localization File:

Create `localisations/common/en_IN/digit-common.json`:

```json
[
  {
    "code": "CORE_COMMON_SUBMIT",
    "message": "Submit",
    "module": "digit-common",
    "locale": "en_IN"
  },
  {
    "code": "CORE_COMMON_CANCEL",
    "message": "Cancel",
    "module": "digit-common",
    "locale": "en_IN"
  },
  {
    "code": "CORE_COMMON_SAVE",
    "message": "Save",
    "module": "digit-common",
    "locale": "en_IN"
  }
]
```

### Create Common Employee File:

Create `employees/common/HRMS.json`:

```json
[
  {
    "code": "SYS-ADMIN-001",
    "dateOfAppointment": 1640995200000,
    "employeeStatus": "EMPLOYED",
    "employeeType": "PERMANENT",
    "tenantId": "{tenantid}",
    "jurisdictions": [
      {
        "hierarchy": "ADMIN",
        "boundary": "{tenantid}",
        "boundaryType": "City",
        "tenantId": "{tenantid}",
        "roles": [
          {
            "code": "SUPERUSER",
            "name": "Super User",
            "tenantId": "{tenantid}"
          }
        ]
      }
    ],
    "user": {
      "userName": "SYSADMIN",
      "name": "System Administrator",
      "gender": "MALE",
      "mobileNumber": "9999999999",
      "tenantId": "{tenantid}",
      "roles": [
        {
          "code": "SUPERUSER",
          "name": "Super User",
          "tenantId": "{tenantid}"
        }
      ]
    }
  }
]
```

---

## Complete Loading Sequence After Changes

```
┌────────────────────────────────────────────────────────────────────────────┐
│                    UPDATED LOADING SEQUENCE                                 │
└────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────┐
│ 1. SCHEMAS           │
├──────────────────────┤
│ ▶ schema/common/     │ ─── Always loaded first
│ ▶ schema/modules/PGR │ ─── If PGR enabled
│ ▶ schema/modules/TL  │ ─── If TL enabled
│ ▶ schema/*.json      │ ─── Legacy (if exists)
└──────────────────────┘
          │
          ▼
┌──────────────────────┐
│ 2. MDMS DATA         │
├──────────────────────┤
│ ▶ mdmsData/common/   │ ─── Always loaded first (NEW!)
│ ▶ mdmsData/modules/  │ ─── If module enabled
│ ▶ mdmsData/**        │ ─── Legacy (if exists)
└──────────────────────┘
          │
          ▼
┌──────────────────────┐
│ 3. BOUNDARY DATA     │
├──────────────────────┤
│ ▶ boundary/          │ ─── Always loaded
└──────────────────────┘
          │
          ▼
┌──────────────────────┐
│ 4. LOCALIZATIONS     │
├──────────────────────┤
│ ▶ localisations/     │ ─── Always loaded first (NEW!)
│   common/            │
│ ▶ localisations/     │ ─── If module enabled
│   modules/           │
│ ▶ localisations/     │ ─── Legacy (if exists)
│   {locale}/          │
└──────────────────────┘
          │
          ▼
┌──────────────────────┐
│ 5. WORKFLOWS         │
├──────────────────────┤
│ ▶ workflow/modules/  │ ─── If module enabled
└──────────────────────┘
          │
          ▼
┌──────────────────────┐
│ 6. EMPLOYEES         │
├──────────────────────┤
│ ▶ employees/common/  │ ─── Always loaded first (NEW!)
│ ▶ employees/modules/ │ ─── If module enabled
│ ▶ HRMS.json          │ ─── Legacy (if exists)
└──────────────────────┘
          │
          ▼
     ✅ TENANT READY
```

---

## Testing the Changes

### 1. Unit Test for Common Loading

```java
@Test
void testCommonMdmsDataLoading() {
    // Given
    when(serviceConfig.isCommonDataEnabled()).thenReturn(true);
    when(serviceConfig.getEnabledModules()).thenReturn(Arrays.asList("PGR"));

    // When
    mdmsBulkLoader.loadAllMdmsData("statea.city1", requestInfo);

    // Then
    // Verify common data loaded first
    verify(mdmsBulkLoader).loadCommonMdmsData("statea.city1", requestInfo);
    // Then module data
    verify(mdmsBulkLoader).loadModuleMdmsData("statea.city1", requestInfo, "PGR");
}

@Test
void testCommonDataDisabled() {
    // Given
    when(serviceConfig.isCommonDataEnabled()).thenReturn(false);
    when(serviceConfig.getEnabledModules()).thenReturn(Arrays.asList("PGR"));

    // When
    mdmsBulkLoader.loadAllMdmsData("statea.city1", requestInfo);

    // Then
    verify(mdmsBulkLoader, never()).loadCommonMdmsData(any(), any());
    verify(mdmsBulkLoader).loadModuleMdmsData("statea.city1", requestInfo, "PGR");
}
```

### 2. Integration Test

```bash
# Start the service
mvn spring-boot:run

# Check logs for common data loading
grep "common MDMS data" logs/app.log

# Expected output:
# [INFO] Found 5 common MDMS data files
# [INFO] Created MDMS entry for schemaCode: common-masters.Department
# [INFO] Completed loading common MDMS data
# [INFO] Loading MDMS data for enabled modules: [PGR, TL]
```

---

## Migration Checklist

- [ ] Update `MdmsBulkLoader.java` with `loadCommonMdmsData()` method
- [ ] Update `LocalizationUtil.java` with `loadCommonLocalizations()` method
- [ ] Update `DataHandlerService.java` with `createCommonEmployees()` method
- [ ] Update `ServiceConfiguration.java` with `commonDataEnabled` property
- [ ] Add `modules.common.enabled=true` to `application.properties`
- [ ] Create `mdmsData/common/` folder structure
- [ ] Create `localisations/common/` folder structure
- [ ] Create `employees/common/` folder structure
- [ ] Move shared data to common folders
- [ ] Test with both `modules.common.enabled=true` and `false`
- [ ] Verify backward compatibility with legacy structure

---

*Implementation Guide v1.0 - December 2024*
