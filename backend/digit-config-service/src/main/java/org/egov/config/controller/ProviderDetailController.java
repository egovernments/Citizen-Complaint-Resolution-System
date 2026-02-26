package org.egov.config.controller;

import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.egov.config.service.ProviderDetailService;
import org.egov.config.utils.ResponseUtil;
import org.egov.config.web.model.*;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/config/v1/provider")
@RequiredArgsConstructor
public class ProviderDetailController {

    private final ProviderDetailService providerDetailService;

    @PostMapping("/_create")
    public ResponseEntity<ProviderDetailResponse> create(@RequestBody @Valid ProviderDetailRequest request) {
        ProviderDetail entry = providerDetailService.create(request);
        return new ResponseEntity<>(ProviderDetailResponse.builder()
                .responseInfo(ResponseUtil.createResponseInfo(request.getRequestInfo(), true))
                .providerDetail(entry)
                .build(), HttpStatus.CREATED);
    }

    @PostMapping("/_update")
    public ResponseEntity<ProviderDetailResponse> update(@RequestBody @Valid ProviderDetailRequest request) {
        ProviderDetail entry = providerDetailService.update(request);
        return ResponseEntity.ok(ProviderDetailResponse.builder()
                .responseInfo(ResponseUtil.createResponseInfo(request.getRequestInfo(), true))
                .providerDetail(entry)
                .build());
    }

    @PostMapping("/_search")
    public ResponseEntity<ProviderDetailSearchResponse> search(@RequestBody @Valid ProviderDetailSearchRequest request) {
        List<ProviderDetail> entries = providerDetailService.search(request);
        long totalCount = providerDetailService.count(request.getCriteria());
        return ResponseEntity.ok(ProviderDetailSearchResponse.builder()
                .responseInfo(ResponseUtil.createResponseInfo(request.getRequestInfo(), true))
                .providerDetails(entries)
                .pagination(Pagination.builder()
                        .totalCount(totalCount)
                        .limit(request.getCriteria().getLimit())
                        .offSet(request.getCriteria().getOffset())
                        .build())
                .build());
    }
}
