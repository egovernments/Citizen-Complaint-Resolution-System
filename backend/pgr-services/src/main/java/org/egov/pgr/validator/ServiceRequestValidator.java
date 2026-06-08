package org.egov.pgr.validator;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.egov.pgr.config.PGRConfiguration;
import org.egov.pgr.service.RegistryCacheService;
import org.egov.pgr.service.RegistryService;
import org.egov.pgr.web.models.RequestSearchCriteria;
import org.egov.pgr.web.models.Service;
import org.egov.pgr.web.models.ServiceRequest;
import org.springframework.stereotype.Component;
import org.springframework.util.CollectionUtils;
import org.springframework.util.StringUtils;

import java.util.Arrays;
import java.util.List;

import static org.egov.pgr.util.PGRConstants.*;

@Slf4j
@Component
@RequiredArgsConstructor
public class ServiceRequestValidator {

    private final PGRConfiguration config;
    private final RegistryCacheService registryCacheService;
    private final RegistryService registryService;

    public void validateCreate(ServiceRequest request) {
        Service service = request.getService();

        validateSource(service.getSource());
        validateBoundary(service);
        validateServiceCode(service);

        String userType = resolveUserType(request);
        if (USERTYPE_EMPLOYEE.equalsIgnoreCase(userType)) {
            if (service.getCitizen() == null)
                throw new IllegalArgumentException("Citizen object is required when filing on behalf of citizen");
            if (!StringUtils.hasText(service.getCitizen().getMobileNumber()) ||
                    !StringUtils.hasText(service.getCitizen().getName()))
                throw new IllegalArgumentException("Citizen name and mobile number are required");
        }
    }

    public void validateUpdate(ServiceRequest request) {
        Service service = request.getService();

        validateSource(service.getSource());
        validateServiceCode(service);
        validateRecordExists(service);

        if (request.getWorkflow() != null &&
                PGR_WF_REOPEN.equalsIgnoreCase(request.getWorkflow().getAction())) {
            validateReOpen(request);
        }
    }

    public void validateSearch(ServiceRequest request, RequestSearchCriteria criteria) {
        if ((criteria.getMobileNumber() != null || criteria.getServiceRequestId() != null
                || criteria.getIds() != null || criteria.getServiceCode() != null)
                && criteria.getTenantId() == null) {
            throw new IllegalArgumentException("tenantId is mandatory when searching by specific fields");
        }
        validateSearchParam(request, criteria);
    }

    public void validatePlainSearch(RequestSearchCriteria criteria) {
        if (CollectionUtils.isEmpty(criteria.getTenantIds())) {
            throw new IllegalArgumentException("tenantIds must be provided for plain search");
        }
    }

    // -------------------------------------------------------

    private void validateSource(String source) {
        if (!StringUtils.hasText(source)) return;
        List<String> allowed = Arrays.asList(config.getAllowedSource().split(","));
        if (!allowed.contains(source.trim())) {
            throw new IllegalArgumentException("Invalid source: " + source +
                    ". Allowed: " + config.getAllowedSource());
        }
    }

    private void validateBoundary(Service service) {
        if (service.getAddress() == null ||
                service.getAddress().getLocality() == null ||
                !StringUtils.hasText(service.getAddress().getLocality().getCode())) {
            throw new IllegalArgumentException("address.locality.code is required");
        }
        String code = service.getAddress().getLocality().getCode();
        if (!registryCacheService.isValidBoundaryCode(code)) {
            throw new IllegalArgumentException("Invalid boundary code: " + code);
        }
    }

    private void validateServiceCode(Service service) {
        if (!StringUtils.hasText(service.getServiceCode())) return;
        if (!registryCacheService.isValidServiceCode(
                config.getRegistryServiceCategorySchemaCode(), service.getServiceCode())) {
            throw new IllegalArgumentException("Invalid serviceCode: " + service.getServiceCode());
        }
    }

    private void validateRecordExists(Service service) {
        if (!StringUtils.hasText(service.getId()) && !StringUtils.hasText(service.getServiceRequestId()))
            throw new IllegalArgumentException("id or serviceRequestId is required for update");

        Service existing = registryService.findByServiceRequestId(service.getServiceRequestId());
        if (existing == null) {
            throw new IllegalArgumentException("No record found for serviceRequestId: " +
                    service.getServiceRequestId());
        }
    }

    private void validateReOpen(ServiceRequest request) {
        Service service = request.getService();
        Long lastModifiedTime = service.getAuditDetails() != null
                ? service.getAuditDetails().getLastModifiedTime() : null;

        if (lastModifiedTime != null &&
                System.currentTimeMillis() - lastModifiedTime > config.getComplainMaxIdleTime()) {
            throw new IllegalArgumentException(
                    "Complaint cannot be reopened — idle time limit exceeded");
        }

        String citizenUuid = service.getCitizen() != null ? service.getCitizen().getUuid() : null;
        if (USERTYPE_CITIZEN.equalsIgnoreCase(resolveUserType(request)) &&
                StringUtils.hasText(citizenUuid) &&
                !citizenUuid.equals(service.getAccountId())) {
            throw new IllegalArgumentException("Only the complaint owner can reopen it");
        }
    }

    private void validateSearchParam(ServiceRequest request, RequestSearchCriteria criteria) {
        String userType = resolveUserType(request);

        if (USERTYPE_EMPLOYEE.equalsIgnoreCase(userType) && criteria.isEmpty()) {
            throw new IllegalArgumentException("Search without any parameters is not allowed for employees");
        }

        String allowedParamStr;
        if (USERTYPE_CITIZEN.equalsIgnoreCase(userType)) {
            allowedParamStr = config.getAllowedCitizenSearchParameters();
        } else {
            allowedParamStr = config.getAllowedEmployeeSearchParameters();
        }

        List<String> allowed = Arrays.asList(allowedParamStr.split(","));

        if (criteria.getServiceCode() != null && !allowed.contains("serviceCode"))
            throw new IllegalArgumentException("Search on serviceCode is not allowed for " + userType);
        if (criteria.getServiceRequestId() != null && !allowed.contains("serviceRequestId"))
            throw new IllegalArgumentException("Search on serviceRequestId is not allowed for " + userType);
        if (criteria.getApplicationStatus() != null && !allowed.contains("applicationStatus"))
            throw new IllegalArgumentException("Search on applicationStatus is not allowed for " + userType);
        if (criteria.getMobileNumber() != null && !allowed.contains("mobileNumber"))
            throw new IllegalArgumentException("Search on mobileNumber is not allowed for " + userType);
        if (criteria.getIds() != null && !allowed.contains("ids"))
            throw new IllegalArgumentException("Search on ids is not allowed for " + userType);
    }

    private String resolveUserType(ServiceRequest request) {
        if (CollectionUtils.isEmpty(request.getRoles())) return USERTYPE_CITIZEN;
        boolean isEmployee = request.getRoles().stream()
                .anyMatch(r -> r.equalsIgnoreCase(USERTYPE_EMPLOYEE)
                        || r.equalsIgnoreCase("GRO_EMPLOYEE")
                        || r.equalsIgnoreCase("DGRO"));
        return isEmployee ? USERTYPE_EMPLOYEE : USERTYPE_CITIZEN;
    }
}
