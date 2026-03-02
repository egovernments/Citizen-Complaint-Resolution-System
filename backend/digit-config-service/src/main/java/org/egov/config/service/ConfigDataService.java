package org.egov.config.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.egov.config.repository.ConfigDataRepository;
import org.egov.config.service.enrichment.ConfigDataEnricher;
import org.egov.config.service.validator.ConfigDataValidator;
import org.egov.config.utils.CustomException;
import org.egov.config.utils.FallbackUtil;
import org.egov.config.utils.ResponseUtil;
import org.egov.config.web.model.*;
import org.json.JSONObject;
import org.springframework.stereotype.Service;

import java.util.List;

@Service
@Slf4j
@RequiredArgsConstructor
public class ConfigDataService {

    private final ConfigDataValidator validator;
    private final ConfigDataEnricher enricher;
    private final ConfigDataRepository repository;

    public ConfigData create(ConfigDataRequest request, String schemaCode) {
        request.getConfigData().setSchemaCode(schemaCode);

        JSONObject schema = validator.validateCreate(request);
        enricher.enrichCreate(request, schema);
        validator.checkDuplicate(request.getConfigData());

        repository.save(request.getConfigData());
        return request.getConfigData();
    }

    public ConfigData update(ConfigDataRequest request, String schemaCode) {
        request.getConfigData().setSchemaCode(schemaCode);

        validator.validateUpdate(request);
        enricher.enrichUpdate(request);

        repository.update(request.getConfigData());
        return request.getConfigData();
    }

    public List<ConfigData> search(ConfigDataSearchRequest request) {
        enricher.enrichSearchDefaults(request.getCriteria());
        return repository.search(request.getCriteria());
    }

    public long count(ConfigDataCriteria criteria) {
        return repository.count(criteria);
    }

    public ConfigDataResolveResponse resolve(ConfigDataResolveRequest request) {
        ConfigDataResolveRequest.ResolveParams params = request.getResolveRequest();
        List<String> tenantChain = FallbackUtil.buildTenantChain(params.getTenantId());

        ConfigData result = repository.resolve(
                params.getSchemaCode(),
                params.getFilters(),
                tenantChain);

        if (result == null) {
            throw new CustomException("CONFIG_NOT_RESOLVED",
                    "No config found for schemaCode=" + params.getSchemaCode()
                            + " tenantId=" + params.getTenantId()
                            + " filters=" + params.getFilters());
        }

        return ConfigDataResolveResponse.builder()
                .responseInfo(ResponseUtil.createResponseInfo(request.getRequestInfo(), true))
                .configData(result)
                .resolutionMeta(ConfigDataResolveResponse.ResolutionMeta.builder()
                        .matchedTenant(result.getTenantId())
                        .build())
                .build();
    }
}
