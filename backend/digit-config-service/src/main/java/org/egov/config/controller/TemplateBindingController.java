package org.egov.config.controller;

import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.egov.config.service.TemplateBindingService;
import org.egov.config.utils.ResponseUtil;
import org.egov.config.web.model.*;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/config/v1/template-binding")
@RequiredArgsConstructor
public class TemplateBindingController {

    private final TemplateBindingService templateBindingService;

    @PostMapping("/_create")
    public ResponseEntity<TemplateBindingResponse> create(@RequestBody @Valid TemplateBindingRequest request) {
        TemplateBinding entry = templateBindingService.create(request);
        return new ResponseEntity<>(TemplateBindingResponse.builder()
                .responseInfo(ResponseUtil.createResponseInfo(request.getRequestInfo(), true))
                .templateBinding(entry)
                .build(), HttpStatus.CREATED);
    }

    @PostMapping("/_update")
    public ResponseEntity<TemplateBindingResponse> update(@RequestBody @Valid TemplateBindingRequest request) {
        TemplateBinding entry = templateBindingService.update(request);
        return ResponseEntity.ok(TemplateBindingResponse.builder()
                .responseInfo(ResponseUtil.createResponseInfo(request.getRequestInfo(), true))
                .templateBinding(entry)
                .build());
    }

    @PostMapping("/_search")
    public ResponseEntity<TemplateBindingSearchResponse> search(@RequestBody @Valid TemplateBindingSearchRequest request) {
        List<TemplateBinding> entries = templateBindingService.search(request);
        long totalCount = templateBindingService.count(request.getCriteria());
        return ResponseEntity.ok(TemplateBindingSearchResponse.builder()
                .responseInfo(ResponseUtil.createResponseInfo(request.getRequestInfo(), true))
                .templateBindings(entries)
                .pagination(Pagination.builder()
                        .totalCount(totalCount)
                        .limit(request.getCriteria().getLimit())
                        .offSet(request.getCriteria().getOffset())
                        .build())
                .build());
    }

    @PostMapping("/_resolve")
    public ResponseEntity<TemplateBindingResponse> resolve(@RequestBody @Valid TemplateBindingResolveRequest request) {
        TemplateBindingResponse response = templateBindingService.resolve(request);
        return ResponseEntity.ok(response);
    }
}
