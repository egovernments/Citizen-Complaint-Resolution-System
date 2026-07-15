package org.egov.pgr.web.controllers;

import lombok.extern.slf4j.Slf4j;
import org.egov.common.contract.response.ResponseInfo;
import org.egov.pgr.service.AdminComplaintSearchService;
import org.egov.pgr.util.ResponseInfoFactory;
import org.egov.pgr.web.models.AdminSearchCriteria;
import org.egov.pgr.web.models.AdminSearchResponse;
import org.egov.pgr.web.models.RequestInfoWrapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.ModelAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;

import javax.validation.Valid;

/**
 * Dedicated cross-department complaint search for the SUPERUSER search page (see
 * docs/complaint-search-page.md). This is a new, additive endpoint — it does not modify the
 * behavior, contract, or callers of the existing {@code /request/_search} and
 * {@code /request/_count} endpoints in {@link RequestsApiController}.
 *
 * Role/permission gating (MDMS ACCESSCONTROL-ROLEACTIONS for SUPERUSER) is applied at the
 * platform gateway based on the action code for this path and is out of scope here.
 */
@Controller
@RequestMapping("/v2")
@Slf4j
public class AdminComplaintSearchController {

    private final AdminComplaintSearchService adminComplaintSearchService;

    private final ResponseInfoFactory responseInfoFactory;

    @Autowired
    public AdminComplaintSearchController(AdminComplaintSearchService adminComplaintSearchService,
                                           ResponseInfoFactory responseInfoFactory) {
        this.adminComplaintSearchService = adminComplaintSearchService;
        this.responseInfoFactory = responseInfoFactory;
    }

    @RequestMapping(value = "/request/_admin/_search", method = RequestMethod.POST)
    public ResponseEntity<AdminSearchResponse> adminSearch(@Valid @RequestBody RequestInfoWrapper requestInfoWrapper,
                                                            @Valid @ModelAttribute AdminSearchCriteria criteria) {
        AdminComplaintSearchService.Result result =
                adminComplaintSearchService.search(requestInfoWrapper.getRequestInfo(), criteria);

        ResponseInfo responseInfo = responseInfoFactory
                .createResponseInfoFromRequestInfo(requestInfoWrapper.getRequestInfo(), true);

        AdminSearchResponse response = AdminSearchResponse.builder()
                .responseInfo(responseInfo)
                .serviceWrappers(result.getServiceWrappers())
                .totalCount(result.getTotalCount())
                .build();

        return new ResponseEntity<>(response, HttpStatus.OK);
    }
}
