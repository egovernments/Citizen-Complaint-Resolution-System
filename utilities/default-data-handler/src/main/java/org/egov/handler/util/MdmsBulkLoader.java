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
import java.util.*;

@Component
@RequiredArgsConstructor
@Slf4j
public class MdmsBulkLoader {

    private final ObjectMapper objectMapper;
    private final RestTemplate restTemplate;
    private final ServiceConfiguration serviceConfig;

    // Priority folders - loaded first in this order (roles & actiontest before roleactions)
    private static final List<String> PRIORITY_FOLDERS = Arrays.asList(
            "ACCESSCONTROL-ROLE",
            "ACCESSCONTROL-ACTIONS-TEST",
            "ACCESSCONTROL-ROLEACTIONS"
    );

    public void loadAllMdmsData(String tenantId, RequestInfo requestInfo, String mdmsDataPath) {
        try {
            PathMatchingResourcePatternResolver resolver = new PathMatchingResourcePatternResolver();

            // Match all files inside the specified path
            Resource[] resources = resolver.getResources(mdmsDataPath);

            if (resources.length == 0) {
                log.debug("No MDMS data files found at path: {}", mdmsDataPath);
                return;
            }

            // Sort resources to ensure proper loading order
            List<Resource> sortedResources = sortResourcesByPriority(resources);
            log.info("Found {} MDMS data files at path: {}", sortedResources.size(), mdmsDataPath);

            for (Resource resource : sortedResources) {
                String fileName = resource.getFilename();
                if (fileName == null || !fileName.endsWith(".json")) continue;

                String schemaCode = fileName.replace(".json", "");

                // Read JSON content
                String rawJson = StreamUtils.copyToString(resource.getInputStream(), StandardCharsets.UTF_8);
                JsonNode arrayNode = objectMapper.readTree(rawJson);

                if (!arrayNode.isArray()) {
                    log.error("File must contain a JSON array: {}", fileName);
                    continue; // skip this file
                }

                for (JsonNode singleObjectNode : arrayNode) {
                    try {
                        // Convert node to raw string
                        String singleObjectJson = objectMapper.writeValueAsString(singleObjectNode);

                        // Replace all {tenantid} placeholders with actual tenant ID
                        singleObjectJson = singleObjectJson.replace("{tenantid}", tenantId);

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

                        log.info("Created MDMS entry for schemaCode: {} from file: {}", schemaCode, fileName);
                    } catch (Exception innerEx) {
                        log.error("Failed to create MDMS entry for schemaCode: {} in file: {}. Skipping...",
                                schemaCode, fileName, innerEx);
                        // Continue with next record
                    }
                }
            }
        } catch (Exception e) {
            log.error("Failed to load MDMS files: {}", e.getMessage(), e);
        }
    }

    /**
     * Sort resources to ensure ACCESSCONTROL-ROLE and ACCESSCONTROL-ACTIONS-TEST
     * are loaded before ACCESSCONTROL-ROLEACTIONS
     */
    private List<Resource> sortResourcesByPriority(Resource[] resources) {
        List<Resource> resourceList = new ArrayList<>(Arrays.asList(resources));

        resourceList.sort((r1, r2) -> {
            int priority1 = getPriority(r1);
            int priority2 = getPriority(r2);
            return Integer.compare(priority1, priority2);
        });

        return resourceList;
    }

    /**
     * Get priority for a resource based on its folder name
     * Lower number = higher priority (loaded first)
     */
    private int getPriority(Resource resource) {
        try {
            String path = resource.getURL().getPath();
            for (int i = 0; i < PRIORITY_FOLDERS.size(); i++) {
                if (path.contains("/" + PRIORITY_FOLDERS.get(i) + "/")) {
                    return i;
                }
            }
        } catch (Exception e) {
            log.debug("Could not determine priority for resource: {}", resource.getFilename());
        }
        // Default priority for non-priority folders (load after priority folders)
        return PRIORITY_FOLDERS.size();
    }
}
