package org.egov.config.controller;

import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
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
public class ConfigDataController {

    private final ConfigDataService configDataService;

    @PostMapping("/_create/{schemaCode}")
    public ResponseEntity<ConfigDataResponse> create(
            @RequestBody @Valid ConfigDataRequest request,
            @PathVariable String schemaCode) {
        ConfigData result = configDataService.create(request, schemaCode);
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
        List<ConfigData> results = configDataService.search(request);
        long totalCount = configDataService.count(request.getCriteria());
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
