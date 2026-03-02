package org.egov.config.service.validator;

import com.fasterxml.jackson.databind.JsonNode;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.egov.config.client.MdmsV2Client;
import org.egov.config.repository.ConfigDataRepository;
import org.egov.config.utils.CustomException;
import org.egov.config.web.model.ConfigData;
import org.egov.config.web.model.ConfigDataCriteria;
import org.egov.config.web.model.ConfigDataRequest;
import org.everit.json.schema.Schema;
import org.everit.json.schema.ValidationException;
import org.everit.json.schema.loader.SchemaLoader;
import org.json.JSONObject;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.util.*;

@Component
@Slf4j
@RequiredArgsConstructor
public class ConfigDataValidator {

    private final MdmsV2Client mdmsV2Client;
    private final ConfigDataRepository repository;

    @Value("${mdms.v2.validation.enabled:false}")
    private boolean schemaValidationEnabled;

    public JSONObject validateCreate(ConfigDataRequest request) {
        ConfigData entry = request.getConfigData();

        if (entry.getTenantId() == null || entry.getTenantId().isBlank()) {
            throw new CustomException("INVALID_TENANT_ID", "tenantId is required");
        }
        if (entry.getData() == null) {
            throw new CustomException("INVALID_DATA", "data is required");
        }

        JSONObject schema = null;
        if (schemaValidationEnabled) {
            schema = mdmsV2Client.fetchSchemaDefinition(entry.getTenantId(), entry.getSchemaCode());
            if (schema != null) {
                validateDataAgainstSchema(entry.getData(), schema);
            }
        }

        return schema;
    }

    public void validateUpdate(ConfigDataRequest request) {
        ConfigData entry = request.getConfigData();

        if (entry.getId() == null || entry.getId().isBlank()) {
            throw new CustomException("INVALID_ID", "id is required for update");
        }

        List<ConfigData> existing = repository.search(ConfigDataCriteria.builder()
                .ids(Set.of(entry.getId()))
                .limit(1)
                .offset(0)
                .build());
        if (existing.isEmpty()) {
            throw new CustomException("CONFIG_NOT_FOUND", "No config entry found with id=" + entry.getId());
        }

        ConfigData current = existing.get(0);
        entry.setSchemaCode(current.getSchemaCode());
        entry.setTenantId(current.getTenantId());
        entry.setUniqueIdentifier(current.getUniqueIdentifier());

        if (entry.getIsActive() == null) {
            entry.setIsActive(current.getIsActive());
        }
        if (entry.getAuditDetails() == null && current.getAuditDetails() != null) {
            entry.setAuditDetails(current.getAuditDetails());
        }

        if (schemaValidationEnabled && entry.getData() != null) {
            JSONObject schema = mdmsV2Client.fetchSchemaDefinition(entry.getTenantId(), entry.getSchemaCode());
            if (schema != null) {
                validateDataAgainstSchema(entry.getData(), schema);
            }
        }
    }

    public void checkDuplicate(ConfigData entry) {
        List<ConfigData> existing = repository.search(ConfigDataCriteria.builder()
                .tenantId(entry.getTenantId())
                .schemaCode(entry.getSchemaCode())
                .uniqueIdentifiers(Set.of(entry.getUniqueIdentifier()))
                .isActive(true)
                .limit(1)
                .offset(0)
                .build());
        if (!existing.isEmpty()) {
            throw new CustomException("DUPLICATE_RECORD",
                    "Record already exists for schemaCode=" + entry.getSchemaCode()
                            + " uniqueIdentifier=" + entry.getUniqueIdentifier()
                            + " tenantId=" + entry.getTenantId());
        }
    }

    private void validateDataAgainstSchema(JsonNode data, JSONObject schemaObject) {
        try {
            JSONObject dataObject = new JSONObject(data.toString());
            Schema schema = SchemaLoader.load(schemaObject);
            schema.validate(dataObject);
        } catch (ValidationException e) {
            Map<String, String> errors = new LinkedHashMap<>();
            for (ValidationException cause : e.getCausingExceptions()) {
                errors.put("INVALID_DATA_" + cause.getKeyword().toUpperCase(), cause.getErrorMessage());
            }
            if (errors.isEmpty()) {
                errors.put("INVALID_DATA", e.getErrorMessage());
            }
            throw new CustomException(errors);
        }
    }
}
