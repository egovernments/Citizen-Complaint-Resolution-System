package org.egov.config.service.validator;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.egov.config.client.MdmsV2Client;
import org.egov.config.repository.ConfigEntryRepository;
import org.egov.config.utils.CustomException;
import org.egov.config.web.model.*;
import org.everit.json.schema.Schema;
import org.everit.json.schema.ValidationException;
import org.everit.json.schema.loader.SchemaLoader;
import org.json.JSONObject;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Component
@Slf4j
@RequiredArgsConstructor
public class ConfigEntryValidator {

    private final ConfigEntryRepository repository;
    private final MdmsV2Client mdmsV2Client;

    @Value("${mdms.v2.validation.enabled:false}")
    private boolean mdmsValidationEnabled;

    public void validateCreate(ConfigEntryCreateRequest request) {
        ConfigEntry entry = request.getEntry();

        if (entry.getConfigCode() == null || entry.getConfigCode().isBlank()) {
            throw new CustomException("INVALID_CONFIG_CODE", "configCode is required");
        }
        if (entry.getTenantId() == null || entry.getTenantId().isBlank()) {
            throw new CustomException("INVALID_TENANT_ID", "tenantId is required");
        }
        if (entry.getValue() == null) {
            throw new CustomException("INVALID_VALUE", "value is required");
        }

        // MDMS v2 schema validation — validate value against the schema definition
        if (mdmsValidationEnabled) {
            JSONObject schemaObject = mdmsV2Client.fetchSchemaDefinition(
                    entry.getTenantId(), entry.getConfigCode());
            if (schemaObject != null) {
                validateDataWithSchemaDefinition(entry, schemaObject);
            }
        }
    }

    public void validateUpdate(ConfigEntryUpdateRequest request) {
        ConfigEntry entry = request.getEntry();

        if (entry.getId() == null || entry.getId().isBlank()) {
            throw new CustomException("INVALID_ID", "id is required for update");
        }

        // Fetch existing entry for optimistic locking
        List<ConfigEntry> existing = repository.search(ConfigEntrySearchCriteria.builder()
                .ids(List.of(entry.getId()))
                .limit(1).offset(0)
                .build());

        if (existing.isEmpty()) {
            throw new CustomException("ENTRY_NOT_FOUND", "No config entry found with id=" + entry.getId());
        }

        ConfigEntry current = existing.get(0);

        // Optimistic locking: if caller provided a revision, it must match
        if (entry.getRevision() != null && !entry.getRevision().equals(current.getRevision())) {
            throw new CustomException("REVISION_MISMATCH",
                    "Expected revision " + entry.getRevision() + " but current is " + current.getRevision());
        }

        // Store current revision for enrichment
        entry.setRevision(current.getRevision());
        entry.setConfigCode(current.getConfigCode());
        entry.setTenantId(current.getTenantId());
    }

    /**
     * Validates the config entry's value against the MDMS v2 schema definition.
     * Uses org.everit.json.schema — same library and pattern as MDMS v2 MdmsDataValidator.
     */
    private void validateDataWithSchemaDefinition(ConfigEntry entry, JSONObject schemaObject) {
        Map<String, String> errors = new LinkedHashMap<>();
        try {
            JSONObject dataObject = new JSONObject(entry.getValue().toString());
            Schema schema = SchemaLoader.load(schemaObject);
            schema.validate(dataObject);
        } catch (ValidationException e) {
            int count = 0;
            if (!e.getCausingExceptions().isEmpty()) {
                for (ValidationException cause : e.getCausingExceptions()) {
                    ++count;
                    errors.put("SCHEMA_VALIDATION_" + cause.getKeyword().toUpperCase() + "_" + count,
                            cause.getErrorMessage());
                }
            } else {
                errors.put("SCHEMA_VALIDATION_FAILED", e.getErrorMessage());
            }
        }

        if (!errors.isEmpty()) {
            throw new CustomException(errors);
        }
    }
}
