package org.egov.pgr.onboarding;

import org.junit.Test;
import java.util.*;
import static org.junit.Assert.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;

public class OnboardingRecoveryTest {
    @Test public void crashAtEveryStepResumesWithoutRepeatingCompletedSteps(){
        for(String crash:OnboardingRunner.STEPS){
            OnboardingRepository repository=mock(OnboardingRepository.class);
            when(repository.checkpoint(any(),any(),anyLong())).thenReturn(true);
            OnboardingWorkerService worker=mock(OnboardingWorkerService.class);OnboardingSteps steps=mock(OnboardingSteps.class);
            OnboardingRunner runner=new OnboardingRunner(worker,repository,steps,mock(OnboardingLifecyclePublisher.class));
            OnboardingOperation operation=OnboardingOperation.builder().id(UUID.randomUUID()).signupId(UUID.randomUUID()).restartNo(2).build();
            OnboardingSignup signup=OnboardingSignup.builder().build();UUID token=UUID.randomUUID();
            doThrow(new RuntimeException("crash")).doNothing().when(steps).perform(eq(crash),any(),any(),any());
            assertThrows(RuntimeException.class,()->runner.process(operation,signup,token));
            int preceding=OnboardingRunner.STEPS.indexOf(crash);
            assertEquals(OnboardingRunner.STEPS.subList(0,preceding),operation.getCompletedSteps());
            runner.process(operation,signup,token);
            for(int i=0;i<OnboardingRunner.STEPS.size();i++)verify(steps,times(i==preceding?2:1)).perform(eq(OnboardingRunner.STEPS.get(i)),same(signup),same(operation),any());
            verify(worker).complete(operation.getId(),token,operation.getCompletedSteps());assertEquals(2,operation.getRestartNo());
        }
    }
    @Test public void lostLeaseCannotWriteOrFinish(){
        OnboardingRepository repository=mock(OnboardingRepository.class);OnboardingSteps steps=mock(OnboardingSteps.class);OnboardingWorkerService worker=mock(OnboardingWorkerService.class);
        new OnboardingRunner(worker,repository,steps,mock(OnboardingLifecyclePublisher.class)).process(OnboardingOperation.builder().id(UUID.randomUUID()).build(),new OnboardingSignup(),UUID.randomUUID());
        verifyNoInteractions(steps,worker);
    }
    @Test public void perRecordIntentSurvivesCrashAndCompletionIsFenced(){
        OnboardingRepository repository=mock(OnboardingRepository.class);when(repository.checkpoint(any(),any(),anyLong())).thenReturn(true);
        OnboardingOperation operation=OnboardingOperation.builder().build();OnboardingProgress progress=new OnboardingProgress(repository,operation,UUID.randomUUID());
        assertThrows(RuntimeException.class,()->progress.record("mdms:role",()->{throw new RuntimeException("crash");}));
        assertEquals("STARTED",operation.getRecordProgress().get("mdms:role"));
        Runnable action=mock(Runnable.class);progress.record("mdms:role",action);progress.record("mdms:role",action);
        verify(action).run();assertEquals("DONE",operation.getRecordProgress().get("mdms:role"));
    }
    @Test public void uncertainEnsureIsRecoveredBeforeFailedPublicationAndReplayedUntilAck(){
        OnboardingRepository repository=mock(OnboardingRepository.class);OnboardingSteps steps=mock(OnboardingSteps.class);
        OnboardingOperation operation=OnboardingOperation.builder().id(UUID.randomUUID()).signupId(UUID.randomUUID()).restartNo(3).lifecycleRestartNo(3).organizationEnsureStarted(true).lifecycleDecision("FAILED").build();
        when(repository.pendingPublications(anyLong())).thenReturn(List.of(operation));OnboardingSignup signup=new OnboardingSignup();when(repository.findSignup(operation.getSignupId())).thenReturn(Optional.of(signup));
        doThrow(new OnboardingFailure("IDENTITY_UNAVAILABLE",true)).doNothing().when(steps).publish(operation);
        OnboardingLifecyclePublisher publisher=new OnboardingLifecyclePublisher(repository,steps);publisher.publishPending();
        verify(repository).deferPublication(eq(operation),anyLong());verify(repository,never()).acknowledgePublication(any(),anyLong());
        publisher.publishPending();verify(repository).acknowledgePublication(eq(operation),anyLong());
        var order=inOrder(steps);order.verify(steps).ensureOrganization(signup,operation);order.verify(steps).publish(operation);
    }
    @Test public void staleLifecycleIsAcknowledgedWithoutRetry(){
        OnboardingRepository repository=mock(OnboardingRepository.class);OnboardingSteps steps=mock(OnboardingSteps.class);
        OnboardingOperation operation=OnboardingOperation.builder().lifecycleDecision("ACTIVE").lifecycleRestartNo(1).build();
        when(repository.pendingPublications(anyLong())).thenReturn(List.of(operation));doThrow(new OnboardingFailure("ATTEMPT_STALE",false)).when(steps).publish(operation);
        new OnboardingLifecyclePublisher(repository,steps).publishPending();verify(repository).acknowledgePublication(eq(operation),anyLong());verify(repository,never()).deferPublication(any(),anyLong());
    }
}
