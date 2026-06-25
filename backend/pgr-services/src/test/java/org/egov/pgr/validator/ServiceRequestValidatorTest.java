package org.egov.pgr.validator;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.egov.pgr.config.PGRConfiguration;
import org.egov.pgr.repository.PGRRepository;
import org.egov.pgr.repository.ServiceRequestRepository;
import org.egov.pgr.util.HRMSUtil;
import org.egov.pgr.web.models.*;
import org.egov.pgr.web.models.boundary.BoundaryResponse;
import org.egov.tracer.model.CustomException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import java.util.*;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
public class ServiceRequestValidatorTest {

    @Mock private PGRConfiguration config;
    @Mock private PGRRepository repository;
    @Mock private HRMSUtil hrmsUtil;
    @Mock private ServiceRequestRepository serviceRequestRepository;
    @Mock private ObjectMapper objectMapper;

    @InjectMocks
    private ServiceRequestValidator validator;

    private ServiceRequest request;
    private Object mdmsData;

    @BeforeEach
    void setup() {
        request = buildRequest("LOC001", "POTHOLE");
        mdmsData = buildMdmsData("POTHOLE");
        when(config.getAllowedSource()).thenReturn("web");
        when(config.getIsValidateDeptEnabled()).thenReturn(false);
    }

    // ── validateBoundary ──────────────────────────────────────────────────────

    @Test
    void create_validBoundaryCode_passes() {
        stubBoundaryResponse("LOC001");
        assertDoesNotThrow(() -> validator.validateCreate(request, mdmsData));
    }

    @Test
    void create_nullAddress_throwsInvalidBoundary() {
        request.getService().setAddress(null);
        assertCode("INVALID_BOUNDARY", () -> validator.validateCreate(request, mdmsData));
    }

    @Test
    void create_nullLocality_throwsInvalidBoundary() {
        request.getService().getAddress().setLocality(null);
        assertCode("INVALID_BOUNDARY", () -> validator.validateCreate(request, mdmsData));
    }

    @Test
    void create_nullLocalityCode_throwsInvalidBoundary() {
        request.getService().getAddress().getLocality().setCode(null);
        assertCode("INVALID_BOUNDARY", () -> validator.validateCreate(request, mdmsData));
    }

    @Test
    void create_localityCodeNotReturnedByBoundaryService_throwsInvalidBoundaryCode() {
        stubBoundaryResponse("DIFFERENT_CODE");
        assertCode("INVALID_BOUNDARY_CODE", () -> validator.validateCreate(request, mdmsData));
    }

    @Test
    void create_emptyBoundaryList_throwsInvalidBoundaryCode() {
        BoundaryResponse response = BoundaryResponse.builder().boundary(Collections.emptyList()).build();
        when(serviceRequestRepository.fetchResult(any(), any())).thenReturn(response);
        when(objectMapper.convertValue(any(), eq(BoundaryResponse.class))).thenReturn(response);
        assertCode("INVALID_BOUNDARY_CODE", () -> validator.validateCreate(request, mdmsData));
    }

    @Test
    void create_boundaryServiceThrowsRuntimeException_throwsBoundaryServiceError() {
        when(serviceRequestRepository.fetchResult(any(), any())).thenThrow(new RuntimeException("connection refused"));
        assertCode("BOUNDARY_SERVICE_SEARCH_ERROR", () -> validator.validateCreate(request, mdmsData));
    }

    // ── validateMDMS ──────────────────────────────────────────────────────────

    @Test
    void create_serviceCodeNotInMDMS_throwsInvalidServiceCode() {
        stubBoundaryResponse("LOC001");
        assertCode("INVALID_SERVICECODE", () -> validator.validateCreate(request, buildMdmsData("GARBAGE")));
    }

    @Test
    void create_validServiceCode_passes() {
        stubBoundaryResponse("LOC001");
        assertDoesNotThrow(() -> validator.validateCreate(request, buildMdmsData("POTHOLE")));
    }

    // ── validateMDMS on update ────────────────────────────────────────────────

    @Test
    void update_serviceCodeNotInMDMS_throwsInvalidServiceCode() {
        assertCode("INVALID_SERVICECODE", () -> validator.validateUpdate(request, buildMdmsData("GARBAGE")));
    }

    // ── helpers ───────────────────────────────────────────────────────────────

    private void stubBoundaryResponse(String code) {
        org.egov.pgr.web.models.boundary.Boundary b =
                org.egov.pgr.web.models.boundary.Boundary.builder().code(code).build();
        BoundaryResponse response = BoundaryResponse.builder()
                .boundary(Collections.singletonList(b))
                .build();
        when(serviceRequestRepository.fetchResult(any(), any())).thenReturn(response);
        when(objectMapper.convertValue(any(), eq(BoundaryResponse.class))).thenReturn(response);
    }

    private static void assertCode(String expectedCode, org.junit.jupiter.api.function.Executable block) {
        CustomException ex = assertThrows(CustomException.class, block);
        assertEquals(expectedCode, ex.getCode());
    }

    private static ServiceRequest buildRequest(String localityCode, String serviceCode) {
        org.egov.common.contract.request.User actor = org.egov.common.contract.request.User.builder()
                .uuid("citizen-uuid")
                .type("CITIZEN")
                .tenantId("pg.citya")
                .build();

        org.egov.common.contract.request.RequestInfo requestInfo =
                new org.egov.common.contract.request.RequestInfo();
        requestInfo.setUserInfo(actor);

        Address address = Address.builder()
                .tenantId("pg.citya")
                .locality(Boundary.builder().code(localityCode).build())
                .build();

        Service service = Service.builder()
                .id(UUID.randomUUID().toString())
                .tenantId("pg.citya")
                .serviceCode(serviceCode)
                .source("web")
                .address(address)
                .build();

        return ServiceRequest.builder()
                .requestInfo(requestInfo)
                .service(service)
                .workflow(Workflow.builder().action("APPLY").assignes(Collections.emptyList()).build())
                .build();
    }

    private static Object buildMdmsData(String serviceCode) {
        // Leaf row in the merged ComplaintHierarchy master: code == serviceCode, carries department.
        Map<String, Object> leaf = new HashMap<>();
        leaf.put("code", serviceCode);
        leaf.put("levelCode", "SUB_TYPE");
        leaf.put("name", serviceCode);
        leaf.put("department", "ROADS");

        Map<String, Object> rainmaker = new HashMap<>();
        rainmaker.put("ComplaintHierarchy", Collections.singletonList(leaf));

        Map<String, Object> mdmsRes = new HashMap<>();
        mdmsRes.put("RAINMAKER-PGR", rainmaker);

        Map<String, Object> root = new HashMap<>();
        root.put("MdmsRes", mdmsRes);
        return root;
    }
}
