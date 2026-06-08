package org.egov.pgr.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.digit.services.boundary.BoundaryClient;
import org.digit.services.individual.IndividualClient;
import org.digit.services.registry.RegistryClient;
import org.digit.services.registry.model.RegistryDataResponse;
import org.egov.pgr.config.CacheConfig;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.stereotype.Service;

import java.util.List;

@Slf4j
@Service
@RequiredArgsConstructor
public class RegistryCacheService {

    private final RegistryClient registryClient;
    private final BoundaryClient boundaryClient;
    private final IndividualClient individualClient;
    private final ObjectMapper objectMapper;

    @Cacheable(value = CacheConfig.BOUNDARY_CACHE, key = "#boundaryCode")
    public boolean isValidBoundaryCode(String boundaryCode) {
        log.debug("Boundary cache miss for boundaryCode={}", boundaryCode);
        try {
            return boundaryClient.isValidBoundariesByCodes(List.of(boundaryCode));
        } catch (Exception e) {
            log.warn("Boundary validation failed for {}: {}", boundaryCode, e.getMessage());
            return false;
        }
    }

    @Cacheable(value = CacheConfig.INDIVIDUAL_CACHE, key = "#individualId")
    public boolean isIndividualExist(String individualId) {
        log.debug("Individual cache miss for individualId={}", individualId);
        try {
            return individualClient.isIndividualExist(individualId);
        } catch (Exception e) {
            log.warn("Individual check failed for {}: {}", individualId, e.getMessage());
            return false;
        }
    }

    @Cacheable(value = CacheConfig.REGISTRY_SERVICE_CAT_CACHE, key = "#schemaCode + ':' + #serviceCode")
    public boolean isValidServiceCode(String schemaCode, String serviceCode) {
        log.debug("Registry cache miss for schemaCode={} serviceCode={}", schemaCode, serviceCode);
        try {
            RegistryDataResponse response = registryClient.searchRegistryData(schemaCode, "code", serviceCode);
            if (response == null || !Boolean.TRUE.equals(response.getSuccess()) || response.getData() == null)
                return false;
            JsonNode dataNode = objectMapper.valueToTree(response.getData());
            return dataNode.isArray() && dataNode.size() > 0;
        } catch (Exception e) {
            log.warn("Service code validation failed for {}/{}: {}", schemaCode, serviceCode, e.getMessage());
            return false;
        }
    }
}
