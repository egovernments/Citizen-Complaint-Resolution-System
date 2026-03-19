package org.egov.config.controller;

import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.egov.config.service.ConfigDataService;
import org.egov.config.utils.ResponseUtil;
import org.egov.config.web.model.*;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/config/v1")
@RequiredArgsConstructor
@Slf4j
public class ConfigDataController {

    private final ConfigDataService configDataService;

    @PostMapping("/_create/{schemaCode}")
    public ResponseEntity<ConfigDataResponse> create(
            @RequestBody @Valid ConfigDataRequest request,
            @PathVariable String schemaCode) {
        log.info("CREATE request received: schemaCode={}, tenantId={}, uniqueIdentifier={}", 
                schemaCode, 
                request.getConfigData() != null ? request.getConfigData().getTenantId() : "null",
                request.getConfigData() != null ? request.getConfigData().getUniqueIdentifier() : "null");
        
        ConfigData result = configDataService.create(request, schemaCode);
        
        log.info("CREATE response: id={}, schemaCode={}, tenantId={}", 
                result.getId(), result.getSchemaCode(), result.getTenantId());
        
        return new ResponseEntity<>(ConfigDataResponse.builder()
                .responseInfo(ResponseUtil.createResponseInfo(request.getRequestInfo(), true))
                .configData(List.of(result))
                .build(), HttpStatus.CREATED);
    }

    @PostMapping("/_update/{schemaCode}")
    public ResponseEntity<ConfigDataResponse> update(
            @RequestBody @Valid ConfigDataRequest request,
            @PathVariable String schemaCode) {
        ConfigData result = configDataService.update(request, schemaCode);
        return ResponseEntity.ok(ConfigDataResponse.builder()
                .responseInfo(ResponseUtil.createResponseInfo(request.getRequestInfo(), true))
                .configData(List.of(result))
                .build());
    }

    @PostMapping("/_search")
    public ResponseEntity<ConfigDataResponse> search(
            @RequestBody @Valid ConfigDataSearchRequest request) {
        log.info("SEARCH request received: tenantId={}, schemaCode={}, criteria={}", 
                request.getCriteria() != null ? request.getCriteria().getTenantId() : "null",
                request.getCriteria() != null ? request.getCriteria().getSchemaCode() : "null",
                request.getCriteria());
        
        List<ConfigData> results = configDataService.search(request);
        long totalCount = configDataService.count(request.getCriteria());
        
        log.info("SEARCH response: found {} results, totalCount={}", results.size(), totalCount);
        
        return ResponseEntity.ok(ConfigDataResponse.builder()
                .responseInfo(ResponseUtil.createResponseInfo(request.getRequestInfo(), true))
                .configData(results)
                .pagination(Pagination.builder()
                        .totalCount(totalCount)
                        .limit(request.getCriteria().getLimit())
                        .offSet(request.getCriteria().getOffset())
                        .build())
                .build());
    }

    @PostMapping("/_resolve")
    public ResponseEntity<ConfigDataResolveResponse> resolve(
            @RequestBody @Valid ConfigDataResolveRequest request) {
        ConfigDataResolveResponse response = configDataService.resolve(request);
        return ResponseEntity.ok(response);
    }
}
