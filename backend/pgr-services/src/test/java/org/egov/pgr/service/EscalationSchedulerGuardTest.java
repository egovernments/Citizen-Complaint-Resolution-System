package org.egov.pgr.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.egov.common.contract.request.RequestInfo;
import org.egov.common.utils.MultiStateInstanceUtil;
import org.egov.pgr.config.PGRConfiguration;
import org.egov.pgr.producer.Producer;
import org.egov.pgr.repository.PGRRepository;
import org.egov.pgr.repository.ServiceRequestRepository;
import org.egov.pgr.web.models.EscalationTriggerResponse;
import org.egov.pgr.util.MDMSUtils;
import org.egov.tracer.model.CustomException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import java.util.Collections;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;

/**
 * Coverage for the scan-overlap guard in
 * {@link EscalationScheduler#scanAndEscalateOnce(String, java.util.List, RequestInfo, boolean)}:
 * two concurrent MUTATING scans must not run (the second throws
 * {@code SCAN_IN_PROGRESS}); dry runs are read-only and bypass the guard.
 *
 * <p>Concurrency is simulated by blocking the first scan inside the
 * repository search until the assertion against the second scan has run.</p>
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
public class EscalationSchedulerGuardTest {

    @Mock private PGRConfiguration config;
    @Mock private PGRRepository repository;
    @Mock private EscalationService escalationService;
    @Mock private ServiceRequestRepository serviceRequestRepository;
    @Mock private MDMSUtils mdmsUtils;
    @Mock private MultiStateInstanceUtil multiStateInstanceUtil;
    @Mock private Producer producer;

    private EscalationScheduler scheduler;

    private final CountDownLatch scanEntered = new CountDownLatch(1);
    private final CountDownLatch releaseScan = new CountDownLatch(1);

    @BeforeEach
    void setup() {
        scheduler = new EscalationScheduler(
                config, repository, escalationService, serviceRequestRepository,
                mdmsUtils, new ObjectMapper(), multiStateInstanceUtil, producer);
        when(config.getEscalationMaxDepth()).thenReturn(3);
        when(config.getEscalationDefaultSlaMs()).thenReturn(60_000L);
        when(config.getEscalationBatchSize()).thenReturn(100);
        when(config.getEscalationIntervalMs()).thenReturn(300_000L);
        when(mdmsUtils.getMdmsSearchUrl()).thenReturn(new StringBuilder("http://mdms/_search"));
        when(multiStateInstanceUtil.getStateLevelTenant(anyString())).thenReturn("ke");

        // The FIRST repository search blocks until released — pinning the
        // owning scan mid-flight; all later searches return immediately.
        AtomicBoolean firstSearch = new AtomicBoolean(true);
        when(repository.getServiceWrappers(any())).thenAnswer(inv -> {
            if (firstSearch.compareAndSet(true, false)) {
                scanEntered.countDown();
                releaseScan.await(5, TimeUnit.SECONDS);
            }
            return Collections.emptyList();
        });
    }

    @Test
    void concurrentMutatingScan_throwsScanInProgress_andGuardReleasesAfter() throws Exception {
        Thread mutating = new Thread(() ->
                scheduler.scanAndEscalateOnce("ke", null, RequestInfo.builder().build(), false));
        mutating.start();
        try {
            assertTrue(scanEntered.await(5, TimeUnit.SECONDS), "first mutating scan should be mid-flight");

            CustomException ex = assertThrows(CustomException.class, () ->
                    scheduler.scanAndEscalateOnce("ke", null, RequestInfo.builder().build(), false));
            assertEquals("SCAN_IN_PROGRESS", ex.getCode());
        } finally {
            releaseScan.countDown();
            mutating.join(5_000);
        }
        assertFalse(mutating.isAlive(), "first scan must have completed");

        // finally-release: a follow-up mutating scan runs normally.
        EscalationTriggerResponse response = scheduler.scanAndEscalateOnce(
                "ke", null, RequestInfo.builder().build(), false);
        assertEquals(0, response.getScanned());
    }

    @Test
    void dryRun_bypassesGuard_whileMutatingScanRuns() throws Exception {
        Thread mutating = new Thread(() ->
                scheduler.scanAndEscalateOnce("ke", null, RequestInfo.builder().build(), false));
        mutating.start();
        try {
            assertTrue(scanEntered.await(5, TimeUnit.SECONDS), "first mutating scan should be mid-flight");

            EscalationTriggerResponse response = scheduler.scanAndEscalateOnce(
                    "ke", null, RequestInfo.builder().build(), true);
            assertTrue(response.isDryRun(), "dry runs are read-only and must never be blocked by the guard");
        } finally {
            releaseScan.countDown();
            mutating.join(5_000);
        }
        assertFalse(mutating.isAlive(), "first scan must have completed");
    }
}
