package org.egov.handler.util;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.egov.common.contract.request.RequestInfo;
import org.egov.handler.config.ServiceConfiguration;
import org.egov.tracer.model.CustomException;
import org.springframework.core.io.Resource;
import org.springframework.core.io.support.PathMatchingResourcePatternResolver;
import org.springframework.stereotype.Component;
import org.springframework.util.StreamUtils;
import org.springframework.web.client.RestTemplate;

import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;

@Component
@RequiredArgsConstructor
@Slf4j
public class ConfigDataBulkLoader {

    private final ObjectMapper objectMapper;
    private final RestTemplate restTemplate;
    private final ServiceConfiguration serviceConfig;


    public void loadAllConfigData(String tenantId, RequestInfo requestInfo, String configDataPath) {
        try {
            PathMatchingResourcePatternResolver resolver = new PathMatchingResourcePatternResolver();

            Resource[] resources = resolver.getResources(configDataPath);

            for (Resource resource : resources) {
                String fileName = resource.getFilename();
                if (fileName == null || !fileName.endsWith(".json")) continue;

                String configCode = fileName.replace(".json", "");

                String rawJson = StreamUtils.copyToString(resource.getInputStream(), StandardCharsets.UTF_8);
                JsonNode arrayNode = objectMapper.readTree(rawJson);

                if (!arrayNode.isArray()) {
                    log.error("File must contain a JSON array: {}", fileName);
                    continue; // skip this file
                }

                for (JsonNode singleObjectNode : arrayNode) {
                    try {
                        String singleObjectJson = objectMapper.writeValueAsString(singleObjectNode);
                        singleObjectJson = singleObjectJson.replace("{tenantid}", tenantId);
                        Object singleDataObject = objectMapper.readValue(singleObjectJson, Object.class);

                        Map<String, Object> configData = new HashMap<>();
                        configData.put("tenantId", tenantId); // As per curl example
                        configData.put("data", singleDataObject);
                        configData.put("isActive", true);

                        Map<String, Object> requestPayload = new HashMap<>();
                        requestPayload.put("configData", configData);
                        requestPayload.put("RequestInfo", requestInfo);

                        String endpoint = serviceConfig.getConfigDataCreateURI().replace("{configCode}", configCode);
                        restTemplate.postForObject(endpoint, requestPayload, Object.class);

                        log.info("Created config data entry for configCode: {} from file: {}", configCode, fileName);
                    } catch (Exception innerEx) {
                        log.error("Failed to create config data entry for configCode: {} in file: {}. Skipping...",
                                configCode, fileName, innerEx);
                        // continue with next record
                    }
                }
            }
        } catch (Exception e) {
            log.error("Failed to load config data files: {}", e.getMessage(), e);
        }
    }

}