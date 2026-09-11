package org.egov.pgr.validator;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.egov.pgr.config.PGRConfiguration;
import org.egov.pgr.repository.PGRRepository;
import org.egov.pgr.repository.ServiceRequestRepository;
import org.egov.pgr.util.HRMSUtil;
import org.egov.pgr.util.MDMSUtils;
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
    @Mock private MDMSUtils mdmsUtils;

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

    // ── validateReOpen: window source and anti-forgery (#925, #1252) ───────────

    private static final long WINDOW_MS = 6 * 60 * 60 * 1000L;   // MDMS REOPENSLA
    // Deliberately NOT the shipped pgr.complain.idle.time default (259200000) — an arbitrary,
    // clearly-wider value, so a test that passes can only mean the MDMS window was used.
    private static final long PROPERTY_MS = 10L * 24 * 60 * 60 * 1000L;

    @Test
    void reopen_withinMdmsWindow_passes() {
        ServiceRequest req = reopenRequest();
        stubPersisted(req, "citizen-uuid", System.currentTimeMillis() - WINDOW_MS / 2);
        stubWindow(WINDOW_MS);
        assertDoesNotThrow(() -> validator.validateUpdate(req, buildMdmsData("POTHOLE")));
    }

    @Test
    void reopen_pastMdmsWindow_throwsInvalidAction() {
        ServiceRequest req = reopenRequest();
        stubPersisted(req, "citizen-uuid", System.currentTimeMillis() - WINDOW_MS * 2);
        stubWindow(WINDOW_MS);
        assertCode("INVALID_ACTION", () -> validator.validateUpdate(req, buildMdmsData("POTHOLE")));
    }

    /**
     * The heart of #925: the deadline must be read from the DB row, not the request body.
     * Here the caller forges a brand-new lastModifiedTime while the stored complaint is long
     * past the window — the reopen must still be refused.
     */
    @Test
    void reopen_forgedFreshLastModifiedTimeInRequestBody_stillBlocked() {
        ServiceRequest req = reopenRequest();   // body claims lastModifiedTime = now
        stubPersisted(req, "citizen-uuid", System.currentTimeMillis() - WINDOW_MS * 2);
        stubWindow(WINDOW_MS);
        assertCode("INVALID_ACTION", () -> validator.validateUpdate(req, buildMdmsData("POTHOLE")));
    }

    /**
     * Same anti-forgery guarantee for the ownership check: a citizen cannot reopen someone
     * else's complaint by putting their own uuid in the request body's accountId.
     */
    @Test
    void reopen_forgedAccountIdInRequestBody_stillBlocked() {
        ServiceRequest req = reopenRequest();   // body claims accountId = the caller
        stubPersisted(req, "a-different-citizen", System.currentTimeMillis());
        stubWindow(WINDOW_MS);
        assertCode("INVALID_ACTION", () -> validator.validateUpdate(req, buildMdmsData("POTHOLE")));
    }

    /**
     * #1252: the enforced window is MDMS REOPENSLA, not pgr.complain.idle.time. With the
     * property set far wider than the MDMS window, a complaint outside the MDMS window must
     * still be refused — otherwise the property is silently back in charge.
     */
    @Test
    void reopen_mdmsWindowWinsOverProperty() {
        ServiceRequest req = reopenRequest();
        stubPersisted(req, "citizen-uuid", System.currentTimeMillis() - WINDOW_MS * 2);
        when(mdmsUtils.getReopenWindowMillis(any(), any())).thenReturn(WINDOW_MS);
        when(config.getComplainMaxIdleTime()).thenReturn(PROPERTY_MS);   // 10 days, far wider
        assertCode("INVALID_ACTION", () -> validator.validateUpdate(req, buildMdmsData("POTHOLE")));
    }

    /** Fail closed: a persisted record with no audit details must not be reopenable. */
    @Test
    void reopen_persistedRecordWithoutAuditDetails_throwsInvalidAction() {
        ServiceRequest req = reopenRequest();
        Service persisted = Service.builder().tenantId("pg.citya").accountId("citizen-uuid").build();
        when(repository.getServiceWrappers(any()))
                .thenReturn(Collections.singletonList(ServiceWrapper.builder().service(persisted).build()));
        stubWindow(WINDOW_MS);
        assertCode("INVALID_ACTION", () -> validator.validateUpdate(req, buildMdmsData("POTHOLE")));
    }

    /** An employee is not subject to the citizen ownership check, but is subject to the window. */
    @Test
    void reopen_employeePastWindow_throwsInvalidAction() {
        ServiceRequest req = reopenRequest();
        req.getRequestInfo().getUserInfo().setType("EMPLOYEE");
        req.getRequestInfo().getUserInfo().setUuid("employee-uuid");
        stubPersisted(req, "citizen-uuid", System.currentTimeMillis() - WINDOW_MS * 2);
        stubWindow(WINDOW_MS);
        assertCode("INVALID_ACTION", () -> validator.validateUpdate(req, buildMdmsData("POTHOLE")));
    }

    /** A non-REOPEN update must not consult the reopen window at all. */
    @Test
    void nonReopenAction_ignoresReopenWindow() {
        ServiceRequest req = reopenRequest();
        req.getWorkflow().setAction("RESOLVE");
        stubPersisted(req, "someone-else", 0L);   // would fail every reopen check
        assertDoesNotThrow(() -> validator.validateUpdate(req, buildMdmsData("POTHOLE")));
    }

    // ── reopen helpers ────────────────────────────────────────────────────────

    private static ServiceRequest reopenRequest() {
        ServiceRequest req = buildRequest("LOC001", "POTHOLE");
        req.getWorkflow().setAction("REOPEN");
        // A well-formed body from the owning citizen: fresh timestamp + matching accountId.
        // Both are client-controlled, so every assertion below must come from the DB row
        // instead. Setting them here also keeps each test isolated: without them the
        // ownership check would throw first and mask whether the deadline check ever ran.
        req.getService().setAccountId("citizen-uuid");
        req.getService().setAuditDetails(
                AuditDetails.builder().lastModifiedTime(System.currentTimeMillis()).build());
        return req;
    }

    /** Stubs the DB row the validator is required to read instead of the request body. */
    private void stubPersisted(ServiceRequest req, String accountId, long lastModifiedTime) {
        Service persisted = Service.builder()
                .id(req.getService().getId())
                .tenantId("pg.citya")
                .accountId(accountId)
                .auditDetails(AuditDetails.builder().lastModifiedTime(lastModifiedTime).build())
                .build();
        when(repository.getServiceWrappers(any()))
                .thenReturn(Collections.singletonList(ServiceWrapper.builder().service(persisted).build()));
    }

    private void stubWindow(long millis) {
        when(mdmsUtils.getReopenWindowMillis(any(), any())).thenReturn(millis);
    }
}
