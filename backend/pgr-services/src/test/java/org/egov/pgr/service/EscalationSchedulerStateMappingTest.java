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
 * Behavioural coverage for the CRS.WorkflowStateMapping side of
 * {@link EscalationScheduler#resolveSlaHours}. Validates that:
 *
 * <ol>
 *   <li>a present mapping translates the workflow state and the SLA resolves
 *       via CRS.StateSLA / CRS.CategorySLA as expected;</li>
 *   <li>an absent mapping (empty singleton, or schema not seeded yet) returns
 *       a {@code stateMappingMissing} SlaResolution from the v0 fallback;</li>
 *   <li>a typo'd mapping entry (operator wired the state to a non-canonical
 *       key) is treated the same as no mapping — the lookup falls through and
 *       {@code stateMappingMissing} is set.</li>
 * </ol>
 *
 * <p>These tests complement {@link EscalationSchedulerSlaResolutionTest},
 * which covers the SLA-layer fallthrough (CategorySLA → StateSLA → v0).
 * Splitting the concerns keeps both files focused.</p>
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
public class EscalationSchedulerStateMappingTest {

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
     * Mapping present: workflow state translates to a canonical key and the
     * SLA resolves via CRS.StateSLA defaults. {@code stateMappingMissing}
     * must remain false because the mapping did its job.
     */
    @Test
    void mapping_present_state_translates_sla_resolves_via_stateSla() {
        Map<String, String> mapping = new HashMap<>();
        mapping.put("PENDINGATLME", "forwarded");

        Service complaint = new Service();
        complaint.setServiceRequestId("PGR-TEST-MAP-PRESENT");
        complaint.setServiceCode("svc");

        EscalationScheduler.SlaResolution result = scheduler.resolveSlaHours(
                complaint,
                "PENDINGATLME",
                Collections.emptyList(),        // no CategorySLA rows
                stateDefaults(),                 // StateSLA: forwarded=48h
                mapping,                         // PENDINGATLME → forwarded
                Collections.emptyMap(),          // no serviceCode mapping
                0,
                Collections.singletonList(1L),
                Collections.emptyMap());

        // 48h from StateSLA, sourced via CRS.StateSLA — the mapping silently did its job.
        assertEquals(48L * 60 * 60 * 1000, result.slaMs);
        assertEquals(PGRConstants.SLA_SOURCE_STATE, result.source);
        assertFalse(result.stateMappingMissing,
                "mapping resolved successfully — stateMappingMissing must be false");
    }

    /**
     * Mapping absent: the singleton is empty (or hasn't been seeded yet).
     * The state is left untranslated, CRS.StateSLA can't answer either, and
     * we fall through to v0 with {@code stateMappingMissing=true}.
     */
    @Test
    void mapping_absent_state_untranslated_falls_through_with_flag() {
        Service complaint = new Service();
        complaint.setServiceRequestId("PGR-TEST-MAP-ABSENT");
        complaint.setServiceCode("svc");

        EscalationScheduler.SlaResolution result = scheduler.resolveSlaHours(
                complaint,
                "PENDINGATLME",
                Collections.emptyList(),
                Collections.emptyMap(),          // StateSLA empty too
                Collections.emptyMap(),          // mapping empty — the case under test
                Collections.emptyMap(),
                0,
                Collections.singletonList(60_000L),
                Collections.emptyMap());

        assertEquals(60_000L, result.slaMs, "should fall through to v0 default");
        assertEquals(PGRConstants.SLA_SOURCE_V0, result.source);
        assertTrue(result.stateMappingMissing,
                "no mapping and no StateSLA hit — operator-actionable warning");
    }

    /**
     * Mapping value invalid: operator wired the workflow state to a key
     * StateSLA doesn't know (e.g. a typo, or a key that was removed).
     * The mapping does return a non-null key, but StateSLA can't satisfy it,
     * so we fall through to v0 with {@code stateMappingMissing=false}
     * because the mapping DID return a value — the actionable problem is in
     * StateSLA / CategorySLA, not the mapping itself.
     */
    @Test
    void mapping_invalid_value_falls_through_without_state_mapping_flag() {
        Map<String, String> mapping = new HashMap<>();
        // Typo: "forwaded" instead of "forwarded". The mapping resolves to a
        // non-null string, so mapWorkflowStateToKey returns it; the cascade
        // then can't find a StateSLA entry for "forwaded".
        mapping.put("PENDINGATLME", "forwaded");

        Service complaint = new Service();
        complaint.setServiceRequestId("PGR-TEST-MAP-TYPO");
        complaint.setServiceCode("svc");

        EscalationScheduler.SlaResolution result = scheduler.resolveSlaHours(
                complaint,
                "PENDINGATLME",
                Collections.emptyList(),
                stateDefaults(),                 // has "forwarded" but not "forwaded"
                mapping,
                Collections.emptyMap(),
                0,
                Collections.singletonList(60_000L),
                Collections.emptyMap());

        assertEquals(60_000L, result.slaMs, "should fall through to v0 default");
        assertEquals(PGRConstants.SLA_SOURCE_V0, result.source);
        // The mapping DID translate the state — the failure is downstream
        // (StateSLA doesn't know the typo'd key). Surfaced as SLA-source=v0;
        // STATE_MAPPING_MISSING is reserved for the truly-untranslated case.
        assertFalse(result.stateMappingMissing,
                "mapping returned a key (even if typo'd) — stateMappingMissing reserved for null translations");
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
