package org.egov.pgr.service;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.digit.services.registry.RegistryClient;
import org.digit.services.registry.model.RegistryData;
import org.digit.services.registry.model.RegistryDataResponse;
import org.egov.pgr.config.PGRConfiguration;
import org.egov.pgr.web.models.RequestSearchCriteria;
import org.egov.pgr.web.models.Service;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;

@Slf4j
@Component
@RequiredArgsConstructor
public class RegistryService {

    private final RegistryClient registryClient;
    private final ObjectMapper objectMapper;
    private final PGRConfiguration config;

    private static final String[] METADATA_FIELDS = {"registryId"};

    public Service save(Service service) {
        RegistryDataResponse response = createRegistryData(service);
        if (response != null && Boolean.TRUE.equals(response.getSuccess())) {
            JsonNode dataNode = objectMapper.valueToTree(response.getData());
            service.setRegistryId(dataNode.get("registryId").asText());
            log.info("Saved service to registry: {} registryId={}", service.getServiceRequestId(), service.getRegistryId());
            return service;
        }
        throw new RuntimeException("Failed to save service to registry: " +
                (response != null ? response.getError() : "Unknown error"));
    }

    public Service update(Service service) {
        RegistryDataResponse response = updateRegistryData(service);
        if (response != null && Boolean.TRUE.equals(response.getSuccess())) {
            JsonNode dataNode = objectMapper.valueToTree(response.getData());
            service.setRegistryId(dataNode.get("registryId").asText());
            log.info("Updated service in registry: {}", service.getServiceRequestId());
            return service;
        }
        throw new RuntimeException("Failed to update service in registry: " +
                (response != null ? response.getError() : "Unknown error"));
    }

    public Service findByServiceRequestId(String serviceRequestId) {
        RegistryDataResponse response = registryClient.searchRegistryData(
                config.getRegistryStorageSchemaCode(), "serviceRequestId", serviceRequestId);

        if (response != null && Boolean.TRUE.equals(response.getSuccess()) && response.getData() != null) {
            JsonNode dataNode = objectMapper.valueToTree(response.getData());
            if (dataNode.isArray() && dataNode.size() > 0) {
                JsonNode first = dataNode.get(0);
                JsonNode actual = first.get("data");
                if (actual != null) {
                    try {
                        Service service = objectMapper.treeToValue(actual, Service.class);
                        if (first.has("registryId")) {
                            service.setRegistryId(first.get("registryId").asText());
                        }
                        return service;
                    } catch (Exception e) {
                        throw new RuntimeException("Failed to deserialize service from registry", e);
                    }
                }
            }
        }
        return null;
    }

    public List<Service> search(RequestSearchCriteria criteria) {
        List<Service> results = new ArrayList<>();

        String field = null;
        String value = null;

        if (criteria.getServiceRequestId() != null) {
            field = "serviceRequestId";
            value = criteria.getServiceRequestId();
        } else if (criteria.getAccountId() != null) {
            field = "accountId";
            value = criteria.getAccountId();
        } else if (criteria.getApplicationStatus() != null && !criteria.getApplicationStatus().isEmpty()) {
            field = "applicationStatus";
            value = criteria.getApplicationStatus().iterator().next();
        } else if (criteria.getServiceCode() != null && !criteria.getServiceCode().isEmpty()) {
            field = "serviceCode";
            value = criteria.getServiceCode().iterator().next();
        }

        if (field == null) return results;

        RegistryDataResponse response = registryClient.searchRegistryData(
                config.getRegistryStorageSchemaCode(), field, value);

        if (response != null && Boolean.TRUE.equals(response.getSuccess()) && response.getData() != null) {
            JsonNode dataNode = objectMapper.valueToTree(response.getData());
            if (dataNode.isArray()) {
                for (JsonNode item : dataNode) {
                    JsonNode actual = item.get("data");
                    if (actual != null) {
                        try {
                            Service service = objectMapper.treeToValue(actual, Service.class);
                            if (item.has("registryId")) {
                                service.setRegistryId(item.get("registryId").asText());
                            }
                            results.add(service);
                        } catch (Exception e) {
                            log.warn("Failed to deserialize registry item, skipping", e);
                        }
                    }
                }
            }
        }

        return results;
    }

    public Integer count(RequestSearchCriteria criteria) {
        return search(criteria).size();
    }

    private RegistryDataResponse createRegistryData(Service service) {
        ObjectMapper mapper = objectMapper.copy().setSerializationInclusion(JsonInclude.Include.NON_NULL);
        ObjectNode dataNode = (ObjectNode) mapper.valueToTree(service);
        stripMetadata(dataNode);
        RegistryData registryData = RegistryData.builder().version(1).data(dataNode).build();
        return registryClient.createRegistryData(config.getRegistryStorageSchemaCode(), registryData);
    }

    private RegistryDataResponse updateRegistryData(Service service) {
        ObjectMapper mapper = objectMapper.copy().setSerializationInclusion(JsonInclude.Include.NON_NULL);
        ObjectNode dataNode = (ObjectNode) mapper.valueToTree(service);
        stripMetadata(dataNode);
        RegistryData registryData = RegistryData.builder().version(1).data(dataNode).build();
        return registryClient.updateRegistryData(config.getRegistryStorageSchemaCode(), registryData,
                "serviceRequestId", service.getServiceRequestId());
    }

    private void stripMetadata(ObjectNode dataNode) {
        for (String field : METADATA_FIELDS) {
            dataNode.remove(field);
        }
    }
}
