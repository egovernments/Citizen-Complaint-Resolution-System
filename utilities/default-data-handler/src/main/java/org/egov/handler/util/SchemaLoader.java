package org.egov.handler.util;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.egov.common.contract.request.RequestInfo;
import org.egov.handler.config.ServiceConfiguration;
import org.egov.handler.web.models.DefaultDataRequest;
import org.springframework.core.io.Resource;
import org.springframework.core.io.support.PathMatchingResourcePatternResolver;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.util.StreamUtils;
import org.springframework.web.client.RestTemplate;

import java.nio.charset.StandardCharsets;

@Component
@RequiredArgsConstructor
@Slf4j
public class SchemaLoader {

    private final ObjectMapper objectMapper;
    private final RestTemplate restTemplate;
    private final ServiceConfiguration serviceConfig;

    /**
     * Load MDMS schemas from the given path pattern
     * @param defaultDataRequest Request containing tenant and request info
     * @param schemaPath The classpath pattern to load schemas from (e.g., "classpath:prod/common/schemas/*.json")
     */
    public void loadSchemasFromPath(DefaultDataRequest defaultDataRequest, String schemaPath) {
        try {
            String mdmsSchemaCreateUri = serviceConfig.getMdmsSchemaCreateURI();
            String tenantId = defaultDataRequest.getTargetTenantId();
            RequestInfo requestInfo = defaultDataRequest.getRequestInfo();

            PathMatchingResourcePatternResolver resolver = new PathMatchingResourcePatternResolver();
            Resource[] resources = resolver.getResources(schemaPath);

            if (resources.length == 0) {
                log.debug("No schema files found at path: {}", schemaPath);
                return;
            }

            log.info("Found {} schema files at path: {}", resources.length, schemaPath);

            for (Resource resource : resources) {
                String fileName = resource.getFilename();
                if (fileName == null || !fileName.endsWith(".json")) continue;

                try {
                    String rawJson = StreamUtils.copyToString(resource.getInputStream(), StandardCharsets.UTF_8);
                    rawJson = rawJson.replace("{tenantid}", tenantId);

                    // Parse schema array from file
                    JsonNode schemaArray = objectMapper.readTree(rawJson);

                    for (JsonNode schemaNode : schemaArray) {
                        try {
                            ObjectNode payload = objectMapper.createObjectNode();
                            payload.set("RequestInfo", objectMapper.valueToTree(requestInfo));
                            payload.set("SchemaDefinition", schemaNode);

                            HttpHeaders headers = new HttpHeaders();
                            headers.setContentType(MediaType.APPLICATION_JSON);
                            HttpEntity<JsonNode> request = new HttpEntity<>(payload, headers);

                            restTemplate.postForObject(mdmsSchemaCreateUri, request, Object.class);
                            log.info("MDMS schema created successfully: {} from file: {}",
                                    schemaNode.get("code").asText(), fileName);
                        } catch (Exception innerEx) {
                            log.error("Failed to create schema: {} for tenant: {}. Skipping...",
                                    schemaNode.get("code"), tenantId, innerEx);
                        }
                    }
                } catch (Exception e) {
                    log.error("Failed to process schema file: {}. Skipping...", fileName, e);
                }
            }
        } catch (Exception e) {
            log.error("Failed to load schemas from path: {}", schemaPath, e);
        }
    }
}
