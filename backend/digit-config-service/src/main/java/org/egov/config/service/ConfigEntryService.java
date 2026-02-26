package org.egov.config.service;

import lombok.RequiredArgsConstructor;
import org.egov.config.repository.ConfigEntryRepository;
import org.egov.config.service.enrichment.ConfigEntryEnricher;
import org.egov.config.service.validator.ConfigEntryValidator;
import org.egov.config.utils.CustomException;
import org.egov.config.utils.ResponseUtil;
import org.egov.config.web.model.*;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;

@Service
@RequiredArgsConstructor
public class ConfigEntryService {

    private final ConfigEntryValidator validator;
    private final ConfigEntryEnricher enricher;
    private final ConfigEntryRepository repository;

    public ConfigEntry create(ConfigEntryCreateRequest request) {
        validator.validateCreate(request);
        enricher.enrichCreate(request);
        repository.save(request.getEntry());
        return request.getEntry();
    }

    public ConfigEntry update(ConfigEntryUpdateRequest request) {
        validator.validateUpdate(request);
        enricher.enrichUpdate(request);
        repository.update(request.getEntry());
        return request.getEntry();
    }

    public List<ConfigEntry> search(ConfigEntrySearchRequest request) {
        enricher.enrichSearchCriteria(request.getCriteria());
        return repository.search(request.getCriteria());
    }

    public long count(ConfigEntrySearchCriteria criteria) {
        return repository.count(criteria);
    }

    public ConfigResolveResponse resolve(ConfigResolveRequest request) {
        ConfigResolveRequest.ResolveParams params = request.getResolveRequest();

        List<String> tenantChain = buildTenantChain(params.getTenantId());

        ConfigEntry entry = repository.resolve(
                params.getConfigCode(), params.getModule(), params.getEventName(),
                params.getChannel(), tenantChain);

        if (entry == null) {
            throw new CustomException("CONFIG_NOT_RESOLVED",
                    "No config entry found for configCode=" + params.getConfigCode()
                            + " eventName=" + params.getEventName()
                            + " channel=" + params.getChannel()
                            + " tenantId=" + params.getTenantId());
        }

        return ConfigResolveResponse.builder()
                .responseInfo(ResponseUtil.createResponseInfo(request.getRequestInfo(), true))
                .resolved(ConfigResolveResponse.ResolvedEntry.builder()
                        .entry(entry)
                        .resolutionMeta(ConfigResolveResponse.ResolutionMeta.builder()
                                .matchedTenant(entry.getTenantId())
                                .build())
                        .build())
                .build();
    }

    /**
     * Builds tenant fallback chain: "pb.amritsar" -> ["pb.amritsar", "pb", "*"]
     */
    private List<String> buildTenantChain(String tenantId) {
        List<String> chain = new ArrayList<>();
        if (tenantId != null) {
            chain.add(tenantId);
            String t = tenantId;
            while (t.contains(".")) {
                t = t.substring(0, t.lastIndexOf('.'));
                chain.add(t);
            }
        }
        chain.add("*");
        return chain;
    }
}
