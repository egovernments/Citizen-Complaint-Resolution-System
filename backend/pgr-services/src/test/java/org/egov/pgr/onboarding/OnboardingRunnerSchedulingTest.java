package org.egov.pgr.onboarding;

import org.junit.Test;
import org.springframework.scheduling.annotation.Scheduled;

import java.lang.reflect.Method;
import java.util.Arrays;
import java.util.Optional;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.Assert.*;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;

/** Review #2269 item 9: provisioning must not occupy Spring's shared scheduler thread. */
public class OnboardingRunnerSchedulingTest {

    @Test
    public void noRunnerMethodRunsOnTheSharedSpringScheduler() {
        for (Method method : OnboardingRunner.class.getDeclaredMethods()) {
            assertFalse(method.getName() + " is @Scheduled", method.isAnnotationPresent(Scheduled.class));
        }
        assertTrue("the runner's own scheduler must not be a bean that replaces Spring's default",
                Arrays.stream(OnboardingRunner.class.getDeclaredMethods())
                        .noneMatch(m -> m.isAnnotationPresent(org.springframework.context.annotation.Bean.class)));
    }

    @Test
    public void pollsOnItsOwnThread() throws Exception {
        OnboardingWorkerService worker = mock(OnboardingWorkerService.class);
        CountDownLatch claimed = new CountDownLatch(1), release = new CountDownLatch(1);
        AtomicReference<String> pollThread = new AtomicReference<>();
        when(worker.claim(anyString(), anyLong())).thenAnswer(call -> {
            pollThread.set(Thread.currentThread().getName());
            claimed.countDown();
            release.await(10, TimeUnit.SECONDS); // a long provisioning job
            return Optional.empty();
        });
        OnboardingRunner runner = new OnboardingRunner(worker, mock(OnboardingRepository.class),
                mock(OnboardingSteps.class), mock(OnboardingLifecyclePublisher.class), 50);
        try {
            runner.start();
            assertTrue(runner.isRunning());
            assertTrue("runner never polled", claimed.await(5, TimeUnit.SECONDS));
            // Spring's shared scheduler threads are "scheduling-N"; a blocked job here holds
            // only the runner's own thread.
            assertTrue(pollThread.get(), pollThread.get().startsWith(OnboardingRunner.THREAD_PREFIX));
        } finally {
            release.countDown();
            runner.stop();
        }
        assertFalse(runner.isRunning());
    }
}
