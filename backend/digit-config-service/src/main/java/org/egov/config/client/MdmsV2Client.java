package org.egov.config.client;

import com.fasterxml.jackson.databind.JsonNode;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.egov.config.utils.CustomException;
import org.json.JSONObject;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestTemplate;

import java.util.Map;

@Component
@Slf4j
@RequiredArgsConstructor
public class MdmsV2Client {

    private final RestTemplate restTemplate;

    @Value("${mdms.v2.host:}")
    private String mdmsHost;

    @Value("${mdms.v2.schema.search.path:/schema/v1/_search}")
    private String schemaSearchPath;

    /**
     * Fetches the JSON Schema definition from MDMS v2 for the given config code.
     *
     * @return the schema definition as a JSONObject, or null if MDMS is not configured
     */
    public JSONObject fetchSchemaDefinition(String tenantId, String configCode) {
        if (mdmsHost == null || mdmsHost.isBlank()) {
            log.warn("MDMS v2 host not configured, skipping schema validation");
            return null;
        }

        try {
            String url = mdmsHost + schemaSearchPath;
            Map<String, Object> request = Map.of(
                    "SchemaDefCriteria", Map.of(
                            "tenantId", tenantId,
                            "codes", new String[]{configCode}
                    )
            );

            JsonNode response = restTemplate.postForObject(url, request, JsonNode.class);
            if (response == null || !response.has("SchemaDefinitions")
                    || response.get("SchemaDefinitions").isEmpty()) {
                throw new CustomException("CFG_SCHEMA_NOT_FOUND",
                        "No MDMS v2 schema found for configCode=" + configCode);
            }

            // Extract the "definition" field from the first schema definition
            JsonNode definition = response.get("SchemaDefinitions").get(0).get("definition");
            if (definition == null) {
                throw new CustomException("CFG_SCHEMA_NO_DEFINITION",
                        "Schema definition for configCode=" + configCode + " has no 'definition' field");
            }

            return new JSONObject(definition.toString());
        } catch (CustomException e) {
            throw e;
        } catch (Exception e) {
            log.error("Failed to fetch schema from MDMS v2: {}", e.getMessage());
            throw new CustomException("MDMS_VALIDATION_FAILED",
                    "Could not fetch config schema from MDMS v2: " + e.getMessage());
        }
    }
}
