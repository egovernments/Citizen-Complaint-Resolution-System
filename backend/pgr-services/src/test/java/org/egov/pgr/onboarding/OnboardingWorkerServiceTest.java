package org.egov.pgr.onboarding;

import org.egov.tracer.model.CustomException;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.mockito.Mock;
import org.mockito.junit.MockitoJUnitRunner;

import java.util.Arrays;
import java.util.Collections;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@RunWith(MockitoJUnitRunner.class)
public class OnboardingWorkerServiceTest {

    @Mock private OnboardingRepository repository;
    private OnboardingWorkerService service;
    private final UUID operationId = UUID.randomUUID();
    private final UUID signupId = UUID.randomUUID();
    private final UUID leaseToken = UUID.randomUUID();

    @Before
    public void setUp() {
        service = new OnboardingWorkerService(repository);
    }

    @Test
    public void claimReturnsTheLeasedOperationWithItsSignup() {
        OnboardingOperation operation = OnboardingOperation.builder()
                .id(operationId).signupId(signupId).status("RUNNING").build();
        OnboardingSignup signup = OnboardingSignup.builder().id(signupId).requestedTenantId("pg.bomet").build();
        when(repository.claimOperation(eq("worker-1"), any(UUID.class), anyLong(), anyLong()))
                .thenReturn(Optional.of(new OnboardingLease(operation, leaseToken, 1L)));
        when(repository.findSignup(signupId)).thenReturn(Optional.of(signup));

        Map<String, Object> claimed = service.claim("worker-1", 60).orElseThrow();

        assertEquals(operation, claimed.get("Operation"));
        assertEquals(signup, claimed.get("Signup"));
        assertEquals(leaseToken.toString(), claimed.get("leaseToken"));
    }

    @Test
    public void claimReturnsNothingWhenNoOperationIsPending() {
        when(repository.claimOperation(eq("worker-1"), any(UUID.class), anyLong(), anyLong()))
                .thenReturn(Optional.empty());
        assertFalse(service.claim("worker-1", 60).isPresent());
    }

    @Test
    public void completeActivatesTheSignupAndConsumesIdentifiers() {
        when(repository.findOperation(operationId)).thenReturn(Optional.of(
                OnboardingOperation.builder().id(operationId).signupId(signupId).build()));
        when(repository.finishOperation(eq(operationId), eq(leaseToken), eq("SUCCEEDED"),
                eq(Arrays.asList("TENANT_FOUNDATION", "ORGANIZATION")), isNull(), isNull(), isNull(), anyLong()))
                .thenReturn(true);

        service.complete(operationId, leaseToken, Arrays.asList("TENANT_FOUNDATION", "ORGANIZATION"));

        verify(repository).settleSignup(eq(signupId), eq("ACTIVE"), eq("CONSUMED"), anyLong());
    }

    @Test
    public void retryableFailureKeepsTheSignupProvisioning() {
        when(repository.findOperation(operationId)).thenReturn(Optional.of(
                OnboardingOperation.builder().id(operationId).signupId(signupId).build()));
        when(repository.finishOperation(eq(operationId), eq(leaseToken), eq("RETRYABLE_FAILED"),
                eq(Collections.emptyList()), eq("ORGANIZATION"), eq("KEYCLOAK_UNAVAILABLE"), eq("down"), anyLong()))
                .thenReturn(true);

        service.fail(operationId, leaseToken, true, "KEYCLOAK_UNAVAILABLE", "down", "ORGANIZATION", null);

        verify(repository, never()).settleSignup(any(), any(), any(), anyLong());
    }

    @Test
    public void terminalFailureFailsTheSignupAndReleasesIdentifiers() {
        when(repository.findOperation(operationId)).thenReturn(Optional.of(
                OnboardingOperation.builder().id(operationId).signupId(signupId).build()));
        when(repository.finishOperation(eq(operationId), eq(leaseToken), eq("TERMINAL_FAILED"),
                any(), any(), eq("FOUNDER_MOBILE_REQUIRED"), any(), anyLong())).thenReturn(true);

        service.fail(operationId, leaseToken, false, "FOUNDER_MOBILE_REQUIRED", "mobile required", "DIGIT_ACCOUNT", null);

        verify(repository).settleSignup(eq(signupId), eq("FAILED"), eq("RELEASED"), anyLong());
    }

    @Test
    public void aWorkerThatLostItsLeaseCannotSettleTheOperation() {
        when(repository.findOperation(operationId)).thenReturn(Optional.of(
                OnboardingOperation.builder().id(operationId).signupId(signupId).build()));
        when(repository.finishOperation(any(), any(), any(), any(), any(), any(), any(), anyLong())).thenReturn(false);

        CustomException error = assertThrows(CustomException.class,
                () -> service.complete(operationId, leaseToken, Collections.emptyList()));
        assertEquals("ONBOARDING_LEASE_LOST", error.getCode());
        verify(repository, never()).settleSignup(any(), any(), any(), anyLong());
    }
}
