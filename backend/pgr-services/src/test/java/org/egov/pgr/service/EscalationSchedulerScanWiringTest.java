package org.egov.pgr.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.egov.common.contract.request.RequestInfo;
import org.egov.common.utils.MultiStateInstanceUtil;
import org.egov.mdms.model.MdmsCriteriaReq;
import org.egov.pgr.config.PGRConfiguration;
import org.egov.pgr.producer.Producer;
import org.egov.pgr.repository.PGRRepository;
import org.egov.pgr.repository.ServiceRequestRepository;
import org.egov.pgr.util.EscalationSkipReason;
import org.egov.pgr.util.MDMSUtils;
import org.egov.pgr.util.PGRConstants;
import org.egov.pgr.web.models.AuditDetails;
import org.egov.pgr.web.models.EscalationTriggerResponse;
import org.egov.pgr.web.models.RequestSearchCriteria;
import org.egov.pgr.web.models.Service;
import org.egov.pgr.web.models.ServiceWrapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import java.util.Collections;
import java.util.HashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Wiring-level coverage for {@link EscalationScheduler#scanAndEscalateOnce}
 * paths that the pure-function tests can't reach:
 *
 * <ol>
 *   <li>pre-breach warning emission — policy-driven, Kafka push on the
 *       pre-breach topic, counter + outcome-detail tagging;</li>
 *   <li>pre-breach suppression on dry runs;</li>
 *   <li>CRS.EscalationPolicy maxDepth overriding the static config default
 *       in the scheduler's own early max-depth check.</li>
 * </ol>
 *
 * <p>Follows the same mock harness as {@link EscalationSchedulerDryRunTest}:
 * the complaint is surfaced via the repository for PENDINGATLME only, and the
 * CRS.EscalationPolicy singleton is injected by answering the MDMS fetch for
 * master name "EscalationPolicy".</p>
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
public class EscalationSchedulerScanWiringTest {

    @Mock private PGRConfiguration config;
    @Mock private PGRRepository repository;
    @Mock private EscalationService escalationService;
    @Mock private ServiceRequestRepository serviceRequestRepository;
    @Mock private MDMSUtils mdmsUtils;
    @Mock private MultiStateInstanceUtil multiStateInstanceUtil;
    @Mock private Producer producer;

    private EscalationScheduler scheduler;

    @BeforeEach
    void setup() {
        scheduler = new EscalationScheduler(
                config, repository, escalationService, serviceRequestRepository,
                mdmsUtils, new ObjectMapper(), multiStateInstanceUtil, producer);
        when(config.getEscalationMaxDepth()).thenReturn(3);
        when(config.getEscalationDefaultSlaMs()).thenReturn(100_000L); // 100s SLA
        when(config.getEscalationBatchSize()).thenReturn(100);
        when(config.getEscalationIntervalMs()).thenReturn(10_000L);    // 10s tick
        when(config.getEscalationPreBreachTopic()).thenReturn("pgr-prebreach-topic");
        when(mdmsUtils.getMdmsSearchUrl()).thenReturn(new StringBuilder("http://mdms/_search"));
        when(multiStateInstanceUtil.getStateLevelTenant(anyString())).thenReturn("ke");
    }

    /**
     * Policy preBreachWarning {enabled, 75%} + a complaint whose elapsed time
     * sits inside [threshold, sla) and crossed the threshold this tick →
     * exactly one push on the pre-breach topic (routed by the COMPLAINT's
     * tenant), preBreachWarnings=1, and the SLA_NOT_BREACHED outcome detail
     * tagged with the emission.
     */
    @Test
    void preBreach_wiring_emitsEventAndTagsOutcome() {
        Map<String, Object> preBreach = new HashMap<>();
        preBreach.put("enabled", true);
        preBreach.put("thresholdPercent", 75);
        Map<String, Object> policy = new HashMap<>();
        policy.put("preBreachWarning", preBreach);
        stubEscalationPolicy(policy);

        // SLA 100s, threshold 75s. Elapsed ~80s: inside [75s, 100s) and the
        // previous tick (~70s) was below the threshold → crossing tick.
        Service complaint = complaintLastTouched("PGR-PB-1", 80_000L);
        surfaceForPendingAtLme(complaint);

        EscalationTriggerResponse response = scheduler.scanAndEscalateOnce(
                "ke", null, RequestInfo.builder().build(), false);

        assertEquals(1, response.getPreBreachWarnings());
        // Routed by the complaint's own tenant (ke.bomet), NOT the scan-scope
        // tenant (ke), so topic prefixing matches the event payload.
        verify(producer, times(1)).push(eq("ke.bomet"), eq("pgr-prebreach-topic"), any());
        assertTrue(response.getDetails().stream().anyMatch(d ->
                        "PGR-PB-1".equals(d.getServiceRequestId())
                                && EscalationSkipReason.SLA_NOT_BREACHED.name().equals(d.getReason())
                                && d.getDetail() != null
                                && d.getDetail().endsWith("; prebreach warning emitted")),
                "SLA_NOT_BREACHED outcome detail must record the pre-breach emission");
    }

    /** Same scenario but dryRun=true → zero pushes, zero warnings counted. */
    @Test
    void preBreach_dryRun_suppressesEmission() {
        Map<String, Object> preBreach = new HashMap<>();
        preBreach.put("enabled", true);
        preBreach.put("thresholdPercent", 75);
        Map<String, Object> policy = new HashMap<>();
        policy.put("preBreachWarning", preBreach);
        stubEscalationPolicy(policy);

        Service complaint = complaintLastTouched("PGR-PB-2", 80_000L);
        surfaceForPendingAtLme(complaint);

        EscalationTriggerResponse response = scheduler.scanAndEscalateOnce(
                "ke", null, RequestInfo.builder().build(), true);

        assertEquals(0, response.getPreBreachWarnings());
        verify(producer, never()).push(anyString(), anyString(), any());
    }

    /**
     * CRS.EscalationPolicy maxDepth=1 + a complaint already at level 1 →
     * MAX_DEPTH_REACHED skip from the scheduler's early check. With the
     * static default (3) the complaint would have sailed past the check, so
     * this proves the policy value takes precedence.
     */
    @Test
    void policyMaxDepth_overridesStaticDefault() {
        Map<String, Object> policy = new HashMap<>();
        policy.put("maxDepth", 1);
        stubEscalationPolicy(policy);

        Service complaint = complaintLastTouched("PGR-MD-1", 200_000L); // breached, irrelevant here
        Map<String, Object> detail = new HashMap<>();
        detail.put("escalationLevel", 1);
        complaint.setAdditionalDetail(detail);
        surfaceForPendingAtLme(complaint);

        EscalationTriggerResponse response = scheduler.scanAndEscalateOnce(
                "ke", null, RequestInfo.builder().build(), false);

        assertEquals(0, response.getEscalated());
        assertEquals(Integer.valueOf(1),
                response.getSkipBreakdown().get(EscalationSkipReason.MAX_DEPTH_REACHED.name()));
        assertTrue(response.getDetails().stream().anyMatch(d ->
                        "PGR-MD-1".equals(d.getServiceRequestId())
                                && "SKIPPED".equals(d.getAction())
                                && EscalationSkipReason.MAX_DEPTH_REACHED.name().equals(d.getReason())
                                && d.getDetail() != null
                                && d.getDetail().contains("maxDepth=1")),
                "expected a MAX_DEPTH_REACHED skip computed against the POLICY maxDepth (1), not the static default (3)");
        verify(escalationService, never())
                .escalateComplaintWithReason(any(), any(), any(), anyInt(), anyLong(), anyLong());
    }

    // ---------------------------------------------------------------------
    // helpers
    // ---------------------------------------------------------------------

    /**
     * Answers the scheduler's MDMS fetches: the CRS.EscalationPolicy master
     * returns the given singleton row, every other master fetch returns null
     * (the scheduler treats that as "not seeded" and falls through).
     */
    private void stubEscalationPolicy(Map<String, Object> policyRow) {
        Map<String, Object> crs = new HashMap<>();
        crs.put("EscalationPolicy", Collections.singletonList(policyRow));
        Map<String, Object> mdmsRes = new HashMap<>();
        mdmsRes.put("CRS", crs);
        Map<String, Object> root = new HashMap<>();
        root.put("MdmsRes", mdmsRes);

        when(serviceRequestRepository.fetchResult(any(), any())).thenAnswer(inv -> {
            Object body = inv.getArgument(1);
            if (body instanceof MdmsCriteriaReq) {
                MdmsCriteriaReq req = (MdmsCriteriaReq) body;
                String master = req.getMdmsCriteria().getModuleDetails().get(0)
                        .getMasterDetails().get(0).getName();
                if ("EscalationPolicy".equals(master)) {
                    return root;
                }
            }
            return null;
        });
    }

    /** Surfaces the complaint only for PENDINGATLME so it's scanned exactly once. */
    private void surfaceForPendingAtLme(Service complaint) {
        ServiceWrapper wrapper = ServiceWrapper.builder().service(complaint).build();
        when(repository.getServiceWrappers(any())).thenAnswer(inv -> {
            RequestSearchCriteria criteria = inv.getArgument(0);
            return criteria.getApplicationStatus() != null
                    && criteria.getApplicationStatus().contains(PGRConstants.PENDINGATLME)
                    ? Collections.singletonList(wrapper)
                    : Collections.emptyList();
        });
    }

    private static Service complaintLastTouched(String srid, long elapsedMsAgo) {
        Service s = new Service();
        s.setServiceRequestId(srid);
        s.setTenantId("ke.bomet");
        s.setServiceCode("svc");
        long touched = System.currentTimeMillis() - elapsedMsAgo;
        s.setAuditDetails(AuditDetails.builder()
                .createdTime(touched)
                .lastModifiedTime(touched)
                .build());
        return s;
    }
}
