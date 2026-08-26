package org.egov.pgr.web.controllers;

import org.egov.common.contract.request.RequestInfo;
import org.egov.pgr.service.EmployeeContextService;
import org.egov.pgr.util.ResponseInfoFactory;
import org.egov.pgr.web.models.EmployeeContextResponse;
import org.egov.pgr.web.models.EmployeeWorkingContext;
import org.egov.pgr.web.models.RequestInfoWrapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import jakarta.validation.Valid;

@RestController
@RequestMapping("/v2/employee")
public class EmployeeContextController {

    private final EmployeeContextService employeeContextService;
    private final ResponseInfoFactory responseInfoFactory;

    @Autowired
    public EmployeeContextController(EmployeeContextService employeeContextService,
                                     ResponseInfoFactory responseInfoFactory) {
        this.employeeContextService = employeeContextService;
        this.responseInfoFactory = responseInfoFactory;
    }

    @PostMapping("/_context")
    public ResponseEntity<EmployeeContextResponse> context(
            @Valid @RequestBody RequestInfoWrapper request,
            @RequestParam("tenantId") String tenantId) {
        RequestInfo requestInfo = request.getRequestInfo();
        EmployeeWorkingContext context = employeeContextService.getContext(requestInfo, tenantId);
        return ResponseEntity.ok(EmployeeContextResponse.builder()
                .responseInfo(responseInfoFactory.createResponseInfoFromRequestInfo(requestInfo, true))
                .workingContext(context)
                .build());
    }
}
