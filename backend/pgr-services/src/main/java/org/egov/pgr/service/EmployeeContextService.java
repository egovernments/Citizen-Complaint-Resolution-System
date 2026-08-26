package org.egov.pgr.service;

import com.fasterxml.jackson.databind.JsonNode;
import lombok.extern.slf4j.Slf4j;
import org.apache.commons.lang3.StringUtils;
import org.egov.common.contract.request.RequestInfo;
import org.egov.common.contract.request.Role;
import org.egov.common.contract.request.User;
import org.egov.pgr.config.PGRConfiguration;
import org.egov.pgr.util.HrmsScopeSemantics;
import org.egov.pgr.web.models.EmployeeWorkingContext;
import org.egov.pgr.web.models.RequestInfoWrapper;
import org.egov.tracer.model.CustomException;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.util.UriComponentsBuilder;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * Builds the display-only working context for the authenticated employee.
 *
 * <p>This projection does not derive or grant complaint access. Authorization remains owned by
 * the policy-driven scope resolver; this endpoint uses an independently self-scoped UUID lookup
 * because it must return the authenticated employee's display metadata, never another employee's.
 * Activity-flag interpretation is shared with the policy resolver through
 * {@link HrmsScopeSemantics} so the two views cannot drift on legacy/null HRMS data.
 */
@Service
@Slf4j
public class EmployeeContextService {

    public static final String RESOLVER = "RESOLVER";
    public static final String CITIZEN = "CITIZEN";
    public static final String ADMIN = "ADMIN";

    private final PGRConfiguration config;
    private final RestTemplate restTemplate;
    private final Set<String> resolverRoleCodes;
    private final Set<String> citizenRoleCodes;
    private final Set<String> adminRoleCodes;

    @Autowired
    public EmployeeContextService(PGRConfiguration config, RestTemplate restTemplate) {
        this.config = config;
        this.restTemplate = restTemplate;
        this.resolverRoleCodes = normalizeRoleCodes(config.getEmployeeContextResolverRoleCodes());
        this.citizenRoleCodes = normalizeRoleCodes(config.getEmployeeContextCitizenRoleCodes());
        this.adminRoleCodes = normalizeRoleCodes(config.getEmployeeContextAdminRoleCodes());
    }

    public EmployeeWorkingContext getContext(RequestInfo requestInfo, String tenantId) {
        User user = requestInfo == null ? null : requestInfo.getUserInfo();
        if (user == null || StringUtils.isBlank(user.getUuid())) {
            throw new CustomException("PGR_EMPLOYEE_CONTEXT_NO_USER",
                    "Employee working context requires an authenticated user UUID");
        }
        if (StringUtils.isBlank(tenantId)) {
            throw new CustomException("PGR_EMPLOYEE_CONTEXT_NO_TENANT",
                    "Employee working context requires the logged-in tenantId");
        }

        JsonNode employee = searchEmployee(requestInfo, tenantId, user.getUuid());
        if (employee == null || !employee.isObject()) {
            return unavailable(tenantId);
        }

        List<EmployeeWorkingContext.Department> departments = currentDepartments(employee);
        List<EmployeeWorkingContext.Role> roles = tenantRoles(user, tenantId);
        List<String> roleContexts = classifyRoles(roles);
        List<EmployeeWorkingContext.Jurisdiction> jurisdictions = activeJurisdictions(employee);

        return EmployeeWorkingContext.builder()
                .available(true)
                .tenantId(tenantId)
                .departments(departments)
                .roles(roles)
                .roleContexts(roleContexts)
                .jurisdictions(jurisdictions)
                .build();
    }

    private JsonNode searchEmployee(RequestInfo requestInfo, String tenantId, String uuid) {
        String url = UriComponentsBuilder
                .fromHttpUrl(config.getHrmsHost() + config.getHrmsEndPoint())
                .queryParam("tenantId", tenantId)
                .queryParam("uuids", uuid)
                .queryParam("offset", 0)
                .queryParam("limit", 1)
                .build()
                .encode()
                .toUriString();

        try {
            JsonNode response = restTemplate.postForObject(
                    url,
                    RequestInfoWrapper.builder().requestInfo(requestInfo).build(),
                    JsonNode.class);
            JsonNode employees = response == null ? null : response.path("Employees");
            if (!employees.isArray() || employees.isEmpty()) {
                return null;
            }
            return employees.get(0);
        } catch (RestClientException ex) {
            log.warn("HRMS employee-context lookup failed for tenant={} uuid={}: {}",
                    tenantId, uuid, ex.toString());
            throw new CustomException("PGR_EMPLOYEE_CONTEXT_UNAVAILABLE",
                    "Employee working context is temporarily unavailable");
        } catch (IllegalArgumentException ex) {
            log.warn("Invalid HRMS employee-context response for tenant={} uuid={}: {}",
                    tenantId, uuid, ex.toString());
            throw new CustomException("PGR_EMPLOYEE_CONTEXT_UNAVAILABLE",
                    "Employee working context is temporarily unavailable");
        }
    }

    private List<EmployeeWorkingContext.Department> currentDepartments(JsonNode employee) {
        Map<String, EmployeeWorkingContext.Department> departments = new LinkedHashMap<>();
        JsonNode assignments = employee.path("assignments");
        if (!assignments.isArray()) {
            return Collections.emptyList();
        }
        for (JsonNode assignment : assignments) {
            if (!HrmsScopeSemantics.isCurrentAssignment(assignment)) {
                continue;
            }
            String department = text(assignment, "department");
            if (department != null) {
                departments.putIfAbsent(department, EmployeeWorkingContext.Department.builder()
                        .code(department)
                        .build());
            }
        }
        return new ArrayList<>(departments.values());
    }

    private List<EmployeeWorkingContext.Role> tenantRoles(User user, String tenantId) {
        Map<String, EmployeeWorkingContext.Role> roles = new LinkedHashMap<>();
        if (user.getRoles() == null) {
            return Collections.emptyList();
        }
        for (Role role : user.getRoles()) {
            // Deliberately display only roles stamped for the logged-in tenant, as required by
            // #1833. Authorization inheritance is policy-owned and must not be inferred here.
            if (role == null || StringUtils.isBlank(role.getCode())
                    || !tenantId.equals(role.getTenantId())) {
                continue;
            }
            String code = role.getCode().trim().toUpperCase(Locale.ROOT);
            roles.putIfAbsent(code, EmployeeWorkingContext.Role.builder()
                    .code(code)
                    .name(role.getName())
                    .build());
        }
        return new ArrayList<>(roles.values());
    }

    private List<String> classifyRoles(List<EmployeeWorkingContext.Role> roles) {
        Set<String> codes = new LinkedHashSet<>();
        for (EmployeeWorkingContext.Role role : roles) {
            codes.add(role.getCode());
        }
        List<String> contexts = new ArrayList<>(3);
        if (!Collections.disjoint(codes, resolverRoleCodes)) contexts.add(RESOLVER);
        if (!Collections.disjoint(codes, citizenRoleCodes)) contexts.add(CITIZEN);
        if (!Collections.disjoint(codes, adminRoleCodes)) contexts.add(ADMIN);
        return contexts;
    }

    private List<EmployeeWorkingContext.Jurisdiction> activeJurisdictions(JsonNode employee) {
        Map<String, EmployeeWorkingContext.Jurisdiction> jurisdictions = new LinkedHashMap<>();
        JsonNode values = employee.path("jurisdictions");
        if (!values.isArray()) {
            return Collections.emptyList();
        }
        for (JsonNode jurisdiction : values) {
            if (!HrmsScopeSemantics.isActiveJurisdiction(jurisdiction)) {
                continue;
            }
            String hierarchy = text(jurisdiction, "hierarchy");
            String boundaryType = text(jurisdiction, "boundaryType");
            String boundary = text(jurisdiction, "boundary");
            if (boundary == null) {
                continue;
            }
            String key = String.join("\u0000",
                    hierarchy == null ? "" : hierarchy,
                    boundaryType == null ? "" : boundaryType,
                    boundary);
            jurisdictions.putIfAbsent(key, EmployeeWorkingContext.Jurisdiction.builder()
                    .hierarchy(hierarchy)
                    .boundaryType(boundaryType)
                    .boundary(boundary)
                    .build());
        }
        return new ArrayList<>(jurisdictions.values());
    }

    private String text(JsonNode node, String field) {
        String value = node.path(field).asText(null);
        return StringUtils.isBlank(value) ? null : value;
    }

    private static Set<String> normalizeRoleCodes(List<String> configuredCodes) {
        if (configuredCodes == null) {
            return Collections.emptySet();
        }
        Set<String> normalized = new LinkedHashSet<>();
        for (String configuredCode : configuredCodes) {
            if (StringUtils.isNotBlank(configuredCode)) {
                normalized.add(configuredCode.trim().toUpperCase(Locale.ROOT));
            }
        }
        return Collections.unmodifiableSet(normalized);
    }

    private EmployeeWorkingContext unavailable(String tenantId) {
        return EmployeeWorkingContext.builder()
                .available(false)
                .tenantId(tenantId)
                .departments(Collections.emptyList())
                .roles(Collections.emptyList())
                .roleContexts(Collections.emptyList())
                .jurisdictions(Collections.emptyList())
                .build();
    }
}
