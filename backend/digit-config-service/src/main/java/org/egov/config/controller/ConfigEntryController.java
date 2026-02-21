package org.egov.config.controller;

import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.egov.config.service.ConfigEntryService;
import org.egov.config.utils.ResponseUtil;
import org.egov.config.web.model.*;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/config/v1/entry")
@RequiredArgsConstructor
public class ConfigEntryController {

    private final ConfigEntryService configEntryService;

    @PostMapping("/_create")
    public ResponseEntity<ConfigEntryResponse> create(@RequestBody @Valid ConfigEntryCreateRequest request) {
        ConfigEntry entry = configEntryService.create(request);
        return new ResponseEntity<>(ConfigEntryResponse.builder()
                .responseInfo(ResponseUtil.createResponseInfo(request.getRequestInfo(), true))
                .entry(entry)
                .build(), HttpStatus.CREATED);
    }

    @PostMapping("/_update")
    public ResponseEntity<ConfigEntryResponse> update(@RequestBody @Valid ConfigEntryUpdateRequest request) {
        ConfigEntry entry = configEntryService.update(request);
        return ResponseEntity.ok(ConfigEntryResponse.builder()
                .responseInfo(ResponseUtil.createResponseInfo(request.getRequestInfo(), true))
                .entry(entry)
                .build());
    }

    @PostMapping("/_search")
    public ResponseEntity<ConfigEntrySearchResponse> search(@RequestBody @Valid ConfigEntrySearchRequest request) {
        List<ConfigEntry> entries = configEntryService.search(request);
        long totalCount = configEntryService.count(request.getCriteria());
        return ResponseEntity.ok(ConfigEntrySearchResponse.builder()
                .responseInfo(ResponseUtil.createResponseInfo(request.getRequestInfo(), true))
                .entries(entries)
                .pagination(Pagination.builder()
                        .totalCount(totalCount)
                        .limit(request.getCriteria().getLimit())
                        .offSet(request.getCriteria().getOffset())
                        .build())
                .build());
    }

    @PostMapping("/_resolve")
    public ResponseEntity<ConfigResolveResponse> resolve(@RequestBody @Valid ConfigResolveRequest request) {
        ConfigResolveResponse response = configEntryService.resolve(request);
        return ResponseEntity.ok(response);
    }
}
