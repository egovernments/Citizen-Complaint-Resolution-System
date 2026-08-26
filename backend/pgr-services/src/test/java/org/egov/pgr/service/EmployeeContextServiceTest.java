package org.egov.pgr.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.egov.common.contract.request.RequestInfo;
import org.egov.common.contract.request.Role;
import org.egov.common.contract.request.User;
import org.egov.pgr.config.PGRConfiguration;
import org.egov.pgr.web.models.EmployeeWorkingContext;
import org.egov.tracer.model.CustomException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestTemplate;

import java.util.Arrays;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class EmployeeContextServiceTest {

    private static final String TENANT = "ke.bomet";

    @Mock
    private PGRConfiguration config;

    @Mock
    private RestTemplate restTemplate;

    private ObjectMapper mapper;
    private EmployeeContextService service;

    @BeforeEach
    void setUp() {
        lenient().when(config.getHrmsHost()).thenReturn("http://egov-hrms:8092");
        lenient().when(config.getHrmsEndPoint()).thenReturn("/egov-hrms/employees/_search");
        lenient().when(config.getEmployeeContextResolverRoleCodes()).thenReturn(List.of("PGR_LME", "GRO", "DGRO"));
        lenient().when(config.getEmployeeContextCitizenRoleCodes()).thenReturn(List.of("CITIZEN"));
        lenient().when(config.getEmployeeContextAdminRoleCodes()).thenReturn(List.of(
                "PGR_ADMIN", "SUPERUSER", "MDMS_ADMIN", "HRMS_ADMIN", "STADMIN",
                "SUPERVISOR", "PGR_SUPERVISOR"));
        mapper = new ObjectMapper();
        service = new EmployeeContextService(config, restTemplate);
    }

    @Test
    void projectsOnlyCurrentTenantScopedDisplayContext() {
        Map<String, Object> employee = Map.of(
                "assignments", List.of(
                        Map.of("isCurrentAssignment", false, "department", "SANITATION"),
                        Map.of("isCurrentAssignment", true, "department", "PUBLIC_WORKS"),
                        Map.of("isCurrentAssignment", true, "department", "PUBLIC_WORKS")),
                "jurisdictions", List.of(
                        Map.of("hierarchy", "ADMIN", "boundaryType", "Ward", "boundary", "CHEMANER", "isActive", true),
                        Map.of("hierarchy", "ADMIN", "boundaryType", "Ward", "boundary", "CHEMANER", "isActive", true),
                        Map.of("hierarchy", "ADMIN", "boundaryType", "Ward", "boundary", "OLD_WARD", "isActive", false)));
        when(restTemplate.postForObject(
                argThat((String url) -> url.contains("tenantId=ke.bomet")
                        && url.contains("uuids=employee-uuid")
                        && url.contains("offset=0")
                        && url.contains("limit=1")),
                any(),
                eq(JsonNode.class)))
                .thenReturn(mapper.valueToTree(Map.of("Employees", List.of(employee))));

        RequestInfo request = employeeRequest(
                role("pgr_lme", "Complaint Resolver", TENANT),
                role("PGR_LME", "Duplicate Resolver", TENANT),
                role("CITIZEN", "Citizen", TENANT),
                role("SUPERUSER", "Super User", TENANT),
                role("GRO", "Other tenant GRO", "ke.nairobi"));

        EmployeeWorkingContext context = service.getContext(request, TENANT);

        assertTrue(context.isAvailable());
        assertEquals(TENANT, context.getTenantId());
        assertEquals(List.of("PUBLIC_WORKS"), context.getDepartments().stream()
                .map(EmployeeWorkingContext.Department::getCode).toList());
        assertEquals(List.of("PGR_LME", "CITIZEN", "SUPERUSER"), context.getRoles().stream()
                .map(EmployeeWorkingContext.Role::getCode).toList());
        assertEquals("Complaint Resolver", context.getRoles().get(0).getName());
        assertEquals(List.of("RESOLVER", "CITIZEN", "ADMIN"), context.getRoleContexts());
        assertEquals(1, context.getJurisdictions().size());
        assertEquals("CHEMANER", context.getJurisdictions().get(0).getBoundary());
    }

    @Test
    void noHrmsRecordReturnsUnavailableWithoutPartialRoleContext() {
        when(restTemplate.postForObject(any(String.class), any(), eq(JsonNode.class)))
                .thenReturn(mapper.valueToTree(Map.of("Employees", List.of())));

        EmployeeWorkingContext context = service.getContext(
                employeeRequest(role("PGR_LME", "Complaint Resolver", TENANT)), TENANT);

        assertFalse(context.isAvailable());
        assertEquals(TENANT, context.getTenantId());
        assertTrue(context.getDepartments().isEmpty());
        assertTrue(context.getRoles().isEmpty());
        assertTrue(context.getRoleContexts().isEmpty());
        assertTrue(context.getJurisdictions().isEmpty());
    }

    @Test
    void malformedOptionalHrmsChildrenBecomeEmptyLists() {
        when(restTemplate.postForObject(any(String.class), any(), eq(JsonNode.class)))
                .thenReturn(mapper.valueToTree(Map.of("Employees", List.of(Map.of("code", "EMP-1")))));

        EmployeeWorkingContext context = service.getContext(employeeRequest(), TENANT);

        assertTrue(context.isAvailable());
        assertTrue(context.getDepartments().isEmpty());
        assertTrue(context.getRoles().isEmpty());
        assertTrue(context.getRoleContexts().isEmpty());
        assertTrue(context.getJurisdictions().isEmpty());
    }

    @Test
    void hrmsFailureDoesNotReturnPartialContext() {
        when(restTemplate.postForObject(any(String.class), any(), eq(JsonNode.class)))
                .thenThrow(new ResourceAccessException("connection refused"));

        CustomException error = assertThrows(CustomException.class,
                () -> service.getContext(employeeRequest(role("CITIZEN", "Citizen", TENANT)), TENANT));

        assertTrue(error.getMessage().contains("temporarily unavailable"));
    }

    @Test
    void defaultsMissingCurrentAndNullActiveFlagsToActive() throws Exception {
        when(restTemplate.postForObject(any(String.class), any(), eq(JsonNode.class)))
                .thenReturn(mapper.readTree("""
                        {"Employees":[{
                          "assignments":[
                            {"department":"LEGACY_DEPARTMENT"},
                            {"department":"OLD_DEPARTMENT","isCurrentAssignment":false}
                          ],
                          "jurisdictions":[
                            {"boundary":"LEGACY_WARD","isActive":null},
                            {"boundary":"OLD_WARD","isActive":false}
                          ]
                        }]}
                        """));

        EmployeeWorkingContext context = service.getContext(employeeRequest(), TENANT);

        assertEquals(List.of("LEGACY_DEPARTMENT"), context.getDepartments().stream()
                .map(EmployeeWorkingContext.Department::getCode).toList());
        assertEquals(List.of("LEGACY_WARD"), context.getJurisdictions().stream()
                .map(EmployeeWorkingContext.Jurisdiction::getBoundary).toList());
    }

    @Test
    void nullHrmsEmployeeReturnsUnavailable() throws Exception {
        when(restTemplate.postForObject(any(String.class), any(), eq(JsonNode.class)))
                .thenReturn(mapper.readTree("{\"Employees\":[null]}"));

        EmployeeWorkingContext context = service.getContext(
                employeeRequest(role("PGR_LME", "Complaint Resolver", TENANT)), TENANT);

        assertFalse(context.isAvailable());
        assertTrue(context.getRoles().isEmpty());
        assertTrue(context.getRoleContexts().isEmpty());
    }

    @Test
    void classifiesRolesFromConfigurationRatherThanHardCodedLists() {
        when(config.getEmployeeContextResolverRoleCodes()).thenReturn(List.of(" case_worker "));
        when(config.getEmployeeContextCitizenRoleCodes()).thenReturn(List.of("resident"));
        when(config.getEmployeeContextAdminRoleCodes()).thenReturn(List.of("platform_owner"));
        EmployeeContextService configurableService = new EmployeeContextService(config, restTemplate);
        when(restTemplate.postForObject(any(String.class), any(), eq(JsonNode.class)))
                .thenReturn(mapper.valueToTree(Map.of("Employees", List.of(Map.of("code", "EMP-1")))));

        EmployeeWorkingContext context = configurableService.getContext(employeeRequest(
                role("CASE_WORKER", "Case worker", TENANT),
                role("resident", "Resident", TENANT),
                role("PLATFORM_OWNER", "Platform owner", TENANT),
                role("PGR_LME", "Not configured here", TENANT)), TENANT);

        assertEquals(List.of("RESOLVER", "CITIZEN", "ADMIN"), context.getRoleContexts());
    }

    @Test
    void authenticatedUuidIsRequired() {
        RequestInfo request = RequestInfo.builder()
                .userInfo(User.builder().userName("EMP-1").type("EMPLOYEE").build())
                .build();

        CustomException error = assertThrows(CustomException.class,
                () -> service.getContext(request, TENANT));

        assertTrue(error.getMessage().contains("authenticated user UUID"));
    }

    private static RequestInfo employeeRequest(Role... roles) {
        return RequestInfo.builder()
                .userInfo(User.builder()
                        .uuid("employee-uuid")
                        .userName("EMP-1")
                        .tenantId(TENANT)
                        .type("EMPLOYEE")
                        .roles(Arrays.asList(roles))
                        .build())
                .build();
    }

    private static Role role(String code, String name, String tenantId) {
        return Role.builder().code(code).name(name).tenantId(tenantId).build();
    }
}
