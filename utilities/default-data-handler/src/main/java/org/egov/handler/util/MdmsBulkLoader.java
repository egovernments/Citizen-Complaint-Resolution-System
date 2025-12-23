package org.egov.handler.util;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.egov.common.contract.request.RequestInfo;
import org.egov.handler.config.ServiceConfiguration;
import org.springframework.core.io.Resource;
import org.springframework.core.io.support.PathMatchingResourcePatternResolver;
import org.springframework.stereotype.Component;
import org.springframework.util.StreamUtils;
import org.springframework.web.client.RestTemplate;

import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Component
@RequiredArgsConstructor
@Slf4j
public class MdmsBulkLoader {

    private final ObjectMapper objectMapper;
    private final RestTemplate restTemplate;
    private final ServiceConfiguration serviceConfig;

    /**
     * Load MDMS data for all enabled modules from the modules folder structure
     * @param tenantId Target tenant ID
     * @param requestInfo Request info
     */
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

    /**
     * Load MDMS data for a specific module
     * @param tenantId Target tenant ID
     * @param requestInfo Request info
     * @param moduleName Module name (e.g., "PGR", "TL")
     */
    public void loadModuleMdmsData(String tenantId, RequestInfo requestInfo, String moduleName) {
        try {
            PathMatchingResourcePatternResolver resolver = new PathMatchingResourcePatternResolver();
            String pattern = "classpath:mdmsData/modules/" + moduleName + "/**/*.json";

            Resource[] resources = resolver.getResources(pattern);

            if (resources.length == 0) {
                log.warn("No MDMS data files found for module: {} at path: {}", moduleName, pattern);
                return;
            }

            log.info("Found {} MDMS data files for module: {}", resources.length, moduleName);

            for (Resource resource : resources) {
                processResource(tenantId, requestInfo, resource, moduleName);
            }

            log.info("Completed loading MDMS data for module: {}", moduleName);
        } catch (Exception e) {
            log.error("Failed to load MDMS data for module {}: {}", moduleName, e.getMessage(), e);
        }
    }

    /**
     * Legacy method to load from old folder structure mdmsData folder.
     * This maintains backward compatibility
     */
    public void loadLegacyMdmsData(String tenantId, RequestInfo requestInfo) {
        try {
            PathMatchingResourcePatternResolver resolver = new PathMatchingResourcePatternResolver();

            // Match all files inside mdmsData/**.json (excluding modules folder)
            Resource[] resources = resolver.getResources("classpath:mdmsData/**/*.json");

            for (Resource resource : resources) {
                // Skip files inside modules folder for legacy loading
                String path = resource.getURL().getPath();
                if (path.contains("/modules/")) {
                    continue;
                }
                processResource(tenantId, requestInfo, resource, null);
            }
        } catch (Exception e) {
            log.error("Failed to load legacy MDMS files: {}", e.getMessage(), e);
        }
    }

    /**
     * Process a single resource file and create MDMS entries.
     * Uses MDMS V2 format: [ {...}, {...} ] (simple JSON array)
     * Filename format: {moduleName}.{masterName}.json (e.g., TradeLicense.TradeType.json)
     */
    private void processResource(String tenantId, RequestInfo requestInfo, Resource resource, String moduleName) {
        try {
            String fileName = resource.getFilename();
            if (fileName == null || !fileName.endsWith(".json")) return;

            // Schema code is derived from filename (without .json extension)
            String schemaCode = fileName.replace(".json", "");

            // Read JSON content
            String rawJson = StreamUtils.copyToString(resource.getInputStream(), StandardCharsets.UTF_8);
            JsonNode arrayNode = objectMapper.readTree(rawJson);

            if (!arrayNode.isArray()) {
                log.warn("File must contain a JSON array (V2 format): {}. Skipping...", fileName);
                return;
            }

            int successCount = 0;
            int failCount = 0;

            for (JsonNode singleObjectNode : arrayNode) {
                try {
                    // Convert node to raw string
                    String singleObjectJson = objectMapper.writeValueAsString(singleObjectNode);

                    // Replace all {tenantid} placeholders with actual tenant ID (case-insensitive)
                    singleObjectJson = singleObjectJson.replace("{tenantid}", tenantId);
                    singleObjectJson = singleObjectJson.replace("{tenantId}", tenantId);

                    // Convert back to object
                    Object singleDataObject = objectMapper.readValue(singleObjectJson, Object.class);

                    // Construct MDMS wrapper
                    Map<String, Object> mdms = new HashMap<>();
                    mdms.put("tenantId", tenantId);
                    mdms.put("schemaCode", schemaCode);
                    mdms.put("data", singleDataObject);
                    mdms.put("isActive", true);

                    Map<String, Object> requestPayload = new HashMap<>();
                    requestPayload.put("Mdms", mdms);
                    requestPayload.put("RequestInfo", requestInfo);

                    String endpoint = serviceConfig.getMdmsDataCreateURI().replace("{schemaCode}", schemaCode);
                    restTemplate.postForObject(endpoint, requestPayload, Object.class);

                    successCount++;
                } catch (Exception innerEx) {
                    failCount++;
                    log.debug("Failed to create MDMS entry for schemaCode: {} in file: {}. Error: {}",
                            schemaCode, fileName, innerEx.getMessage());
                }
            }

            if (successCount > 0) {
                log.info("Created {} MDMS entries for schemaCode: {} from file: {} ({} failed)",
                        successCount, schemaCode, fileName, failCount);
            }
            if (failCount > 0 && successCount == 0) {
                log.error("Failed to create any MDMS entries for schemaCode: {} from file: {}", schemaCode, fileName);
            }
        } catch (Exception e) {
            log.error("Error processing resource {}: {}", resource.getFilename(), e.getMessage());
        }
    }

}
