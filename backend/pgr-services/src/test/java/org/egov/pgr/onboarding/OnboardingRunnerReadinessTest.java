package org.egov.pgr.onboarding;

import org.junit.Before;
import org.junit.Test;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static org.junit.Assert.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * Review #2269 item 7: a misconfigured provisioner must not burn every signup's automatic
 * retries and strand it in RETRYABLE_FAILED with no next retry. The runner stops claiming
 * while the provisioner is not ready, so signups stay PENDING until an operator fixes it.
 */
public class OnboardingRunnerReadinessTest {
    private OnboardingWorkerService worker;
    private OnboardingSteps steps;
    private OnboardingLifecyclePublisher publisher;
    private OnboardingProvisionerClient provisioner;
    private OnboardingRunner runner;
    private long now = 1_000_000;

    @Before
    public void setUp() {
        worker = mock(OnboardingWorkerService.class);
        steps = mock(OnboardingSteps.class);
        publisher = mock(OnboardingLifecyclePublisher.class);
        provisioner = mock(OnboardingProvisionerClient.class);
        OnboardingRepository repository = mock(OnboardingRepository.class);
        when(repository.checkpoint(any(), any(), anyLong())).thenReturn(true);
        runner = new OnboardingRunner(worker, repository, steps, publisher, provisioner, 5000);
        runner.clock = () -> now;
        when(worker.claim(anyString(), anyLong())).thenReturn(Optional.empty());
    }

    @Test
    public void anUnconfiguredProvisionerLeavesSignupsQueuedInsteadOfBurningRetries() {
        doThrow(new OnboardingFailure("PROVISIONER_NOT_CONFIGURED", true)).when(provisioner).verifyReady();

        for (int i = 0; i < 20; i++) { runner.tick(); now += 5000; }

        verify(worker, never()).claim(anyString(), anyLong());
        verify(worker, never()).fail(any(), any(), anyBoolean(), any(), any(), any(), any());
        verify(publisher, times(20)).publishPending(); // lifecycle publication is not paused
        assertEquals("PROVISIONER_NOT_CONFIGURED", runner.pausedReason());
        // Re-checked every 30 s while paused, not on every 5 s poll.
        verify(provisioner, times(4)).verifyReady();
    }

    @Test
    public void claimsResumeOnceTheProvisionerIsFixed() {
        doThrow(new OnboardingFailure("PROVISIONER_AUTHORIZATION_REQUIRED", true)).doNothing().when(provisioner).verifyReady();
        runner.tick();
        verify(worker, never()).claim(anyString(), anyLong());

        now += OnboardingRunner.NOT_READY_RECHECK_MS;
        runner.tick();
        verify(worker).claim(anyString(), anyLong());
        assertNull(runner.pausedReason());

        // A healthy provisioner is re-verified at most once a minute.
        now += 5000; runner.tick();
        verify(provisioner, times(2)).verifyReady();
        verify(worker, times(2)).claim(anyString(), anyLong());
    }

    @Test
    public void aProvisionerFailureDuringAJobIsRecheckedBeforeTheNextClaim() {
        UUID operationId = UUID.randomUUID(), token = UUID.randomUUID();
        OnboardingOperation operation = OnboardingOperation.builder().id(operationId)
                .completedSteps(new ArrayList<>()).build();
        Map<String, Object> claim = new LinkedHashMap<>();
        claim.put("Operation", operation);
        claim.put("Signup", new OnboardingSignup());
        claim.put("leaseToken", token.toString());
        when(worker.claim(anyString(), anyLong())).thenReturn(Optional.of(claim)).thenReturn(Optional.empty());
        doThrow(new OnboardingFailure("PROVISIONER_AUTHORIZATION_REQUIRED", true))
                .when(steps).perform(eq("TENANT_FOUNDATION"), any(), any(), any());
        doNothing().doThrow(new OnboardingFailure("PROVISIONER_AUTHORIZATION_REQUIRED", true)).when(provisioner).verifyReady();

        runner.tick(); // ready, claims, the job fails once
        verify(worker).fail(eq(operationId), eq(token), eq(true), eq("PROVISIONER_AUTHORIZATION_REQUIRED"), any(), any(), any());

        now += 1000; // well inside the one-minute "ready" window
        runner.tick();
        verify(provisioner, times(2)).verifyReady();
        verify(worker, times(1)).claim(anyString(), anyLong());
        assertEquals("PROVISIONER_AUTHORIZATION_REQUIRED", runner.pausedReason());
    }
}
