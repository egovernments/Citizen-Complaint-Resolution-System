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
 * Edge-case coverage for the CRS.WorkflowStateMapping → CategorySLA →
 * StateSLA → v0 cascade that {@link EscalationScheduler#resolveSlaHours}
 * implements.
 *
 * <p>The companion {@link EscalationSchedulerStateMappingTest} covers the
 * three "happy / sad / typo'd mapping value" paths. This file pushes on
 * the corners those tests don't: empty mapping values, ranges, partial
 * tuples, double-null fallthrough, and the explicit STATE_MAPPING_MISSING
 * + v0 fallback combination. Each scenario is something an operator might
 * actually do in the configurator — these tests pin the resolver's
 * behaviour so we don't regress silently when refactoring.</p>
 *
 * <p>Related: design doc surfaced these as "open questions" during review
 * (Discussion #773). The tests here document the answer in code.</p>
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
public class EscalationStateMappingEdgeCaseTest {

    @Mock private PGRConfiguration config;
    @Mock private PGRRepository repository;
    @Mock private EscalationService escalationService;
    @Mock private ServiceRequestRepository serviceRequestRepository;
    @Mock private MDMSUtils mdmsUtils;
    @Mock private MultiStateInstanceUtil multiStateInstanceUtil;

    private EscalationScheduler scheduler;

    @BeforeEach
    void setup() {
        scheduler = new EscalationScheduler(
                config, repository, escalationService, serviceRequestRepository,
                mdmsUtils, new ObjectMapper(), multiStateInstanceUtil);
    }

    /**
     * Operator stored the state key but left the value empty (e.g. typed
     * the workflow state column in the configurator, then forgot to pick a
     * canonical key). {@code mapWorkflowStateToKey} returns "" (the literal
     * empty string from the Map), which then misses every StateSLA entry.
     *
     * <p>Expected behaviour: cascade falls through to v0, and
     * {@code stateMappingMissing} is FALSE — because the mapping technically
     * returned a value (even if useless). The actionable signal here is the
     * StateSLA miss, not the mapping itself. Different from the null/missing
     * case which is explicitly flagged.</p>
     *
     * <p>This pins the current behaviour. If we later decide empty-string
     * values should be treated as "missing", this test will fail loudly and
     * the fix lives here.</p>
     */
    @Test
    void mapping_value_empty_string_returns_empty_and_falls_through_no_flag() {
        Map<String, String> mapping = new HashMap<>();
        mapping.put("PENDINGATLME", "");

        // Direct check on the static helper — keeps the contract explicit.
        assertEquals("", EscalationScheduler.mapWorkflowStateToKey("PENDINGATLME", mapping),
                "empty-string value is returned verbatim; we don't coerce to null");

        Service complaint = new Service();
        complaint.setServiceRequestId("PGR-EDGE-EMPTY-MAP");
        complaint.setServiceCode("svc");

        EscalationScheduler.SlaResolution result = scheduler.resolveSlaHours(
                complaint, "PENDINGATLME",
                Collections.emptyList(),
                stateDefaults(),                 // StateSLA has "forwarded" — but mapping gave us ""
                mapping,
                Collections.emptyMap(),
                0,
                Collections.singletonList(60_000L),
                Collections.emptyMap());

        assertEquals(60_000L, result.slaMs, "no StateSLA match for '' → v0 default");
        assertEquals(PGRConstants.SLA_SOURCE_V0, result.source);
        assertFalse(result.stateMappingMissing,
                "mapping returned a (useless) value — flag reserved for truly-null translations");
    }

    /**
     * Operator left the mapping singleton fully empty (e.g. seeded the
     * schema but never populated the dictionary). Every workflow state
     * lookup returns null, StateSLA can't answer either, and we fall to v0
     * with the STATE_MAPPING_MISSING flag set so operators see a
     * structured warning in the OTEL span + log.
     */
    @Test
    void mapping_empty_dictionary_every_state_returns_null_and_flag_set() {
        Map<String, String> emptyMapping = Collections.emptyMap();
        assertNull(EscalationScheduler.mapWorkflowStateToKey("PENDINGATLME", emptyMapping));
        assertNull(EscalationScheduler.mapWorkflowStateToKey("PENDINGFORASSIGNMENT", emptyMapping));
        assertNull(EscalationScheduler.mapWorkflowStateToKey("ANYTHING_ELSE", emptyMapping));

        Service complaint = new Service();
        complaint.setServiceRequestId("PGR-EDGE-EMPTY-DICT");
        complaint.setServiceCode("svc");

        EscalationScheduler.SlaResolution result = scheduler.resolveSlaHours(
                complaint, "PENDINGATLME",
                Collections.emptyList(),
                stateDefaults(),                 // StateSLA seeded — but stateKey is null so unused
                emptyMapping,
                Collections.emptyMap(),
                0,
                Collections.singletonList(60_000L),
                Collections.emptyMap());

        assertEquals(60_000L, result.slaMs);
        assertEquals(PGRConstants.SLA_SOURCE_V0, result.source);
        assertTrue(result.stateMappingMissing,
                "null translation + StateSLA can't answer → STATE_MAPPING_MISSING fires");
    }

    /**
     * Typo in the canonical key inside the mapping value (e.g. "investigaton").
     * CategorySLA lookup uses the (typo'd) key to read the cell — finds null —
     * falls through to StateSLA which also has no entry for the typo — falls to v0.
     *
     * <p>Note: even with a fully-populated CategorySLA matrix, the typo
     * makes the cell lookup miss. This pins that the resolver doesn't
     * silently swallow typos by, say, fuzzy-matching the key.</p>
     */
    @Test
    void mapping_typo_in_canonical_key_categorySla_misses_falls_through_to_v0() {
        Map<String, String> mapping = new HashMap<>();
        mapping.put("PENDINGATLME", "investigaton"); // missing 'i' — should be "investigation"

        Service complaint = serviceWithCategoryTuple("IGSAE", "Business", "Establishment");

        // CategorySLA row IS populated for the tuple + "investigation" — but the
        // typo'd mapping value misses it.
        List<Map<String, Object>> rows = Collections.singletonList(
                row("IGSAE", "Business", "Establishment", "investigation", 72.0));

        EscalationScheduler.SlaResolution result = scheduler.resolveSlaHours(
                complaint, "PENDINGATLME",
                rows,
                stateDefaults(),                 // has "investigation", not "investigaton"
                mapping,
                Collections.emptyMap(),
                0,
                Collections.singletonList(60_000L),
                Collections.emptyMap());

        assertEquals(60_000L, result.slaMs, "typo'd key misses both CategorySLA cell and StateSLA → v0");
        assertEquals(PGRConstants.SLA_SOURCE_V0, result.source);
        assertFalse(result.stateMappingMissing,
                "mapping returned a non-null value, even if typo'd — flag stays false");
    }

    /**
     * CategorySLA cell is a {@code [24, 120]} range (the configurator allows
     * operators to express "between 24h and 120h" as min/max). The scheduler
     * must collapse to MAX (120h) for breach detection, not MIN or average.
     * The UI surfaces both — the scheduler uses 120h.
     */
    @Test
    void categorySla_range_cell_collapses_to_max_for_scheduler_math() {
        Map<String, String> mapping = new HashMap<>();
        mapping.put("PENDINGATLME", "forwarded");

        Service complaint = serviceWithCategoryTuple("IGSAE", "Tourism", "Hygiene");
        List<Map<String, Object>> rows = Collections.singletonList(
                row("IGSAE", "Tourism", "Hygiene", "forwarded", Arrays.asList(24.0, 120.0)));

        EscalationScheduler.SlaResolution result = scheduler.resolveSlaHours(
                complaint, "PENDINGATLME",
                rows,
                stateDefaults(),
                mapping,
                Collections.emptyMap(),
                0,
                Collections.singletonList(60_000L),
                Collections.emptyMap());

        assertEquals(120L * 60 * 60 * 1000, result.slaMs,
                "range cells collapse to MAX (120h), not MIN — see Discussion #773");
        assertEquals(PGRConstants.SLA_SOURCE_CATEGORY, result.source);
        assertFalse(result.unmappedCategory);
        assertFalse(result.stateMappingMissing);
    }

    /**
     * Complaint's additionalDetail has only 2 of the 3 required tuple fields
     * (path + category, missing subcategoryL1). {@code extractCategoryTuple}
     * must return null in this case — a partial tuple is not a tuple.
     *
     * <p>Result: {@code unmappedCategory=true} (operator-actionable warning)
     * and the cascade falls to StateSLA / v0 for the actual SLA value.</p>
     */
    @Test
    void partial_category_tuple_extracts_as_null_and_unmappedCategory_set() {
        Map<String, String> mapping = new HashMap<>();
        mapping.put("PENDINGATLME", "forwarded");

        Service complaint = new Service();
        complaint.setServiceRequestId("PGR-EDGE-PARTIAL-TUPLE");
        complaint.setServiceCode("svc");
        Map<String, Object> detail = new HashMap<>();
        detail.put("path", "IGSAE");
        detail.put("category", "Business");
        // intentionally omitting subcategoryL1
        complaint.setAdditionalDetail(detail);

        EscalationScheduler.SlaResolution result = scheduler.resolveSlaHours(
                complaint, "PENDINGATLME",
                Collections.emptyList(),         // no CategorySLA rows to consider anyway
                stateDefaults(),                 // forwarded=48h → StateSLA answers
                mapping,
                Collections.emptyMap(),          // no serviceCode → tuple fallback
                0,
                Collections.singletonList(60_000L),
                Collections.emptyMap());

        // StateSLA answers, but unmappedCategory should be true because the
        // tuple extraction failed.
        assertEquals(48L * 60 * 60 * 1000, result.slaMs, "StateSLA forwarded=48h answers");
        assertEquals(PGRConstants.SLA_SOURCE_STATE, result.source);
        assertTrue(result.unmappedCategory,
                "partial tuple (2 of 3 fields) → extractCategoryTuple returns null → UNMAPPED_CATEGORY");
    }

    /**
     * Mapping resolves cleanly, CategorySLA row matches the tuple but the
     * cell for the resolved state key is explicitly null. The cascade must
     * fall through to StateSLA (NOT pin to v0 just because CategorySLA was
     * consulted) and the source becomes CRS.StateSLA.
     */
    @Test
    void categorySla_cell_null_falls_through_to_stateSla_with_correct_source() {
        Map<String, String> mapping = new HashMap<>();
        mapping.put("PENDINGATLME", "forwarded");

        Service complaint = serviceWithCategoryTuple("IGSAE", "Business", "Establishment");

        // Row matches the tuple, but the forwarded cell is null.
        Map<String, Object> by = new HashMap<>();
        by.put("forwarded", null);
        Map<String, Object> r = new HashMap<>();
        r.put("path", "IGSAE");
        r.put("category", "Business");
        r.put("subcategoryL1", "Establishment");
        r.put("slaHoursByState", by);
        r.put("isActive", true);

        EscalationScheduler.SlaResolution result = scheduler.resolveSlaHours(
                complaint, "PENDINGATLME",
                Collections.singletonList(r),
                stateDefaults(),                 // forwarded=48h
                mapping,
                Collections.emptyMap(),
                0,
                Collections.singletonList(60_000L),
                Collections.emptyMap());

        assertEquals(48L * 60 * 60 * 1000, result.slaMs);
        assertEquals(PGRConstants.SLA_SOURCE_STATE, result.source,
                "null cell in CategorySLA must NOT pin the source to category — falls to StateSLA");
        assertFalse(result.unmappedCategory);
        assertFalse(result.stateMappingMissing);
    }

    /**
     * Triple-null path: no mapping, no CategorySLA, no StateSLA. v0
     * answers with the per-level default, source = v0.EscalationConfig,
     * BOTH operator flags fire (unmappedCategory=true because the complaint
     * had no tuple AND stateMappingMissing=true because the state didn't
     * translate).
     *
     * <p>This is the worst-case scenario a fresh tenant would hit if they
     * never seeded the CRS schemas. The scheduler still emits a usable
     * SLA but the OTEL span lights up like a Christmas tree so operators
     * notice.</p>
     */
    @Test
    void all_layers_empty_v0_answers_with_both_warning_flags_set() {
        Service complaint = new Service();
        complaint.setServiceRequestId("PGR-EDGE-TRIPLE-NULL");
        complaint.setServiceCode("UNKNOWN-CODE");
        // no additionalDetail, no serviceCode lookup → tuple null

        EscalationScheduler.SlaResolution result = scheduler.resolveSlaHours(
                complaint, "PENDINGATLME",
                Collections.emptyList(),         // CategorySLA: empty
                Collections.emptyMap(),          // StateSLA: empty
                Collections.emptyMap(),          // WorkflowStateMapping: empty
                Collections.emptyMap(),          // serviceCode→tuple: empty
                0,
                Collections.singletonList(60_000L),
                Collections.emptyMap());

        assertEquals(60_000L, result.slaMs, "v0 per-level default answers");
        assertEquals(PGRConstants.SLA_SOURCE_V0, result.source);
        assertTrue(result.unmappedCategory, "no tuple → UNMAPPED_CATEGORY");
        assertTrue(result.stateMappingMissing, "no mapping + no StateSLA → STATE_MAPPING_MISSING");
    }

    // ---------------------------------------------------------------------
    // helpers (kept local — see EscalationSchedulerSlaResolutionTest for the
    // same patterns; deliberately duplicated so this file can be read in
    // isolation when triaging a failure).
    // ---------------------------------------------------------------------

    private static Service serviceWithCategoryTuple(String path, String category, String subcategoryL1) {
        Service s = new Service();
        s.setServiceRequestId("PGR-EDGE-" + category);
        s.setServiceCode("svc-" + category);
        Map<String, Object> detail = new HashMap<>();
        detail.put("path", path);
        detail.put("category", category);
        detail.put("subcategoryL1", subcategoryL1);
        s.setAdditionalDetail(detail);
        return s;
    }

    private static Map<String, Object> row(String path, String category, String subcategoryL1,
                                           String stateKey, Object cellValue) {
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

    private static Map<String, Number> stateDefaults() {
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
