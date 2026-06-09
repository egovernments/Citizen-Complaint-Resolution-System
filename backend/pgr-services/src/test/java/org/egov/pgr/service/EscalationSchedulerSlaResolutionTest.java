package org.egov.pgr.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.egov.common.utils.MultiStateInstanceUtil;
import org.egov.pgr.config.PGRConfiguration;
import org.egov.pgr.repository.PGRRepository;
import org.egov.pgr.repository.ServiceRequestRepository;
import org.egov.pgr.util.MDMSUtils;
import org.egov.pgr.util.PGRConstants;
import org.egov.pgr.web.models.Service;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import java.util.*;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Unit coverage for {@link EscalationScheduler#resolveSlaHours}.
 *
 * <p>The resolver is the heart of the new CRS escalation-SLA model
 * (CRS.CategorySLA → CRS.StateSLA → v0 EscalationConfig). These tests
 * focus only on its pure-function shape — they don't exercise the MDMS
 * fetchers (those are best-effort and the resolver receives their already-
 * parsed result).</p>
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
public class EscalationSchedulerSlaResolutionTest {

    @Mock private PGRConfiguration config;
    @Mock private PGRRepository repository;
    @Mock private EscalationService escalationService;
    @Mock private ServiceRequestRepository serviceRequestRepository;
    @Mock private MDMSUtils mdmsUtils;
    @Mock private MultiStateInstanceUtil multiStateInstanceUtil;

    private EscalationScheduler scheduler;
    private ObjectMapper objectMapper;

    @BeforeEach
    void setup() {
        objectMapper = new ObjectMapper();
        scheduler = new EscalationScheduler(
                config, repository, escalationService, serviceRequestRepository,
                mdmsUtils, objectMapper, multiStateInstanceUtil);
    }

    /** CategorySLA hit: the (path, category, subcategoryL1) row exists and the
     *  cell for the current workflow state has a concrete number. We expect
     *  that value (in MS) and an OTEL source tag of CRS.CategorySLA. */
    @Test
    void resolveSlaHours_categorySla_hit() {
        Service complaint = serviceWithCategoryTuple("IGSAE", "Business", "Establishment");
        List<Map<String, Object>> rows = Collections.singletonList(
                row("IGSAE", "Business", "Establishment", "forwarded", 24.0));

        EscalationScheduler.SlaResolution result = scheduler.resolveSlaHours(
                complaint, "PENDINGATLME", rows, brdDefaults(), Collections.emptyMap(),
                0, Collections.singletonList(1L), Collections.emptyMap());

        assertEquals(24L * 60 * 60 * 1000, result.slaMs);
        assertEquals(PGRConstants.SLA_SOURCE_CATEGORY, result.source);
        assertFalse(result.unmappedCategory);
    }

    /** CategorySLA range collapses to MAX. */
    @Test
    void resolveSlaHours_categorySla_range_collapses_to_max() {
        Service complaint = serviceWithCategoryTuple("IGSAE", "Tourism and Catering", "Hygiene");
        List<Map<String, Object>> rows = Collections.singletonList(
                row("IGSAE", "Tourism and Catering", "Hygiene", "forwarded", Arrays.asList(24.0, 120.0)));

        EscalationScheduler.SlaResolution result = scheduler.resolveSlaHours(
                complaint, "PENDINGATLME", rows, brdDefaults(), Collections.emptyMap(),
                0, Collections.singletonList(1L), Collections.emptyMap());

        // MAX of the range — 120h, not 24h.
        assertEquals(120L * 60 * 60 * 1000, result.slaMs);
        assertEquals(PGRConstants.SLA_SOURCE_CATEGORY, result.source);
    }

    /** StateSLA fallback: complaint maps to a tuple, but the matching
     *  CategorySLA cell is null/missing → we fall to per-state defaults. */
    @Test
    void resolveSlaHours_stateSla_fallback() {
        Service complaint = serviceWithCategoryTuple("IGE", "Complaint", "Health");
        // Row matches the tuple but has no `forwarded` cell.
        Map<String, Object> by = new HashMap<>();
        // no "forwarded" key
        Map<String, Object> r = new HashMap<>();
        r.put("path", "IGE");
        r.put("category", "Complaint");
        r.put("subcategoryL1", "Health");
        r.put("slaHoursByState", by);
        r.put("isActive", true);

        EscalationScheduler.SlaResolution result = scheduler.resolveSlaHours(
                complaint, "PENDINGATLME", Collections.singletonList(r), brdDefaults(), Collections.emptyMap(),
                0, Collections.singletonList(1L), Collections.emptyMap());

        // BRD default for "forwarded" = 48h.
        assertEquals(48L * 60 * 60 * 1000, result.slaMs);
        assertEquals(PGRConstants.SLA_SOURCE_STATE, result.source);
    }

    /** v0 fallback: no CategorySLA, no StateSLA, no mapped tuple → falls all
     *  the way through to the existing v0 EscalationConfig defaults. */
    @Test
    void resolveSlaHours_v0_fallback_when_crs_empty_and_unmapped() {
        Service complaint = new Service();
        complaint.setServiceRequestId("PGR-2026-04-21-001");
        complaint.setServiceCode("UNKNOWN-CODE");
        // no additionalDetail tuple, no ServiceDefs mapping

        EscalationScheduler.SlaResolution result = scheduler.resolveSlaHours(
                complaint, "PENDINGATLME", Collections.emptyList(), Collections.emptyMap(), Collections.emptyMap(),
                0, Collections.singletonList(60_000L), Collections.emptyMap());

        assertEquals(60_000L, result.slaMs);
        assertEquals(PGRConstants.SLA_SOURCE_V0, result.source);
        // Unmapped tuple is the actionable warning even when v0 answers.
        assertTrue(result.unmappedCategory);
    }

    // ---------------------------------------------------------------------
    // helpers
    // ---------------------------------------------------------------------

    private static Service serviceWithCategoryTuple(String path, String category, String subcategoryL1) {
        Service s = new Service();
        s.setServiceRequestId("PGR-TEST-1");
        s.setServiceCode("svc-" + category);
        Map<String, Object> detail = new HashMap<>();
        detail.put("path", path);
        detail.put("category", category);
        detail.put("subcategoryL1", subcategoryL1);
        s.setAdditionalDetail(detail);
        return s;
    }

    private static Map<String, Object> row(String path, String category, String subcategoryL1, String stateKey, Object cellValue) {
        Map<String, Object> by = new HashMap<>();
        by.put(stateKey, cellValue);
        Map<String, Object> r = new HashMap<>();
        r.put("path", path);
        r.put("category", category);
        r.put("subcategoryL1", subcategoryL1);
        r.put("slaHoursByState", by);
        r.put("isActive", true);
        return r;
    }

    private static Map<String, Number> brdDefaults() {
        Map<String, Number> d = new HashMap<>();
        d.put("new", 0);
        d.put("triage", 24);
        d.put("forwarded", 48);
        d.put("investigation", 120);
        d.put("awaiting", 120);
        d.put("resolved", 360);
        return d;
    }
}
