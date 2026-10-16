package org.egov.pgr.onboarding;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.slf4j.LoggerFactory;
import org.springframework.mock.env.MockEnvironment;
import org.springframework.web.client.RestTemplate;

import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.*;

import static org.junit.Assert.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** #2303: a decision is published in the tick that made it, and failed publications are visible in the log. */
public class OnboardingLifecyclePublicationTest {
    private static final String TOKEN = "workload-token-fixture-only";
    private final ListAppender<ILoggingEvent> logs = new ListAppender<>();
    private final Logger logger = (Logger) LoggerFactory.getLogger(OnboardingLifecyclePublisher.class);
    private HttpServer server;

    @Before public void capture() { logs.start(); logger.addAppender(logs); }
    @After public void release() { logger.detachAppender(logs); if (server != null) server.stop(0); }

    @Test public void completedOperationIsPublishedInTheSameTick() {
        OnboardingWorkerService worker = mock(OnboardingWorkerService.class);
        OnboardingLifecyclePublisher publisher = mock(OnboardingLifecyclePublisher.class);
        OnboardingRepository repository = mock(OnboardingRepository.class);
        when(repository.checkpoint(any(), any(), anyLong())).thenReturn(true);
        UUID token = UUID.randomUUID();
        OnboardingOperation operation = OnboardingOperation.builder().id(UUID.randomUUID()).build();
        when(worker.claim(anyString(), anyLong())).thenReturn(Optional.of(Map.of("Operation", operation,
                "Signup", OnboardingSignup.builder().build(), "leaseToken", token.toString())));
        new OnboardingRunner(worker, repository, mock(OnboardingSteps.class), publisher).tick();
        var order = inOrder(worker, publisher);
        order.verify(publisher).publishPending();
        order.verify(worker).complete(operation.getId(), token, operation.getCompletedSteps());
        order.verify(publisher).publishPending(); // after the decision commits, not a poll later
    }

    @Test public void terminalFailureIsPublishedInTheSameTick() {
        OnboardingWorkerService worker = mock(OnboardingWorkerService.class);
        OnboardingLifecyclePublisher publisher = mock(OnboardingLifecyclePublisher.class);
        OnboardingSteps steps = mock(OnboardingSteps.class);
        OnboardingRepository repository = mock(OnboardingRepository.class);
        when(repository.checkpoint(any(), any(), anyLong())).thenReturn(true);
        doThrow(new OnboardingFailure("TENANT_TAKEN", false)).when(steps).perform(any(), any(), any(), any());
        OnboardingOperation operation = OnboardingOperation.builder().id(UUID.randomUUID()).build();
        UUID token = UUID.randomUUID();
        new OnboardingRunner(worker, repository, steps, publisher).process(operation, OnboardingSignup.builder().build(), token);
        var order = inOrder(worker, publisher);
        order.verify(worker).fail(eq(operation.getId()), eq(token), eq(false), eq("TENANT_TAKEN"), any(), any(), any());
        order.verify(publisher).publishPending();
    }

    @Test public void failedPublicationLogsAttemptStatusAndCodeButNoCredential() throws Exception {
        // The real client against a BFF that answers 404 OPERATION_NOT_FOUND, as on the dev box.
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            exchange.getRequestBody().readAllBytes();
            byte[] body = "{\"code\":\"OPERATION_NOT_FOUND\",\"error\":\"Ensure the Organization for this attempt first\"}".getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(404, body.length);
            exchange.getResponseBody().write(body);
            exchange.close();
        });
        server.start();
        var env = new MockEnvironment().withProperty("pgr.onboarding.identity-bff.token", TOKEN)
                .withProperty("pgr.onboarding.identity-bff.url", "http://127.0.0.1:" + server.getAddress().getPort());
        var steps = new OnboardingSteps(new OnboardingProvisionerClient(new RestTemplate(), new ObjectMapper(), env), null, new ObjectMapper());
        OnboardingRepository repository = mock(OnboardingRepository.class);
        OnboardingOperation operation = OnboardingOperation.builder().id(UUID.randomUUID()).lifecycleDecision("ACTIVE").lifecycleRestartNo(0).build();
        when(repository.pendingPublications(anyLong())).thenReturn(List.of(operation));
        when(repository.deferPublication(eq(operation), anyLong()))
                .thenReturn(Optional.of(new OnboardingRepository.PublicationDeferral("gateprf", 3, 1_700_000_000_000L)));

        new OnboardingLifecyclePublisher(repository, steps).publishPending();

        verify(repository, never()).acknowledgePublication(any(), anyLong());
        assertEquals(1, logs.list.size());
        ILoggingEvent event = logs.list.get(0);
        assertEquals(Level.WARN, event.getLevel());
        String line = event.getFormattedMessage();
        for (String expected : List.of("operation=" + operation.getId(), "tenant=gateprf", "decision=ACTIVE", "attempts=3",
                "nextAttemptAt=2023-11-14T22:13:20Z", "httpStatus=404", "code=OPERATION_NOT_FOUND"))
            assertTrue(line, line.contains(expected));
        assertFalse(line, line.contains(TOKEN));
        assertFalse(line, line.toLowerCase(Locale.ROOT).contains("bearer"));
    }

    @Test public void tenthFailedAttemptLogsOnceAtError() {
        OnboardingSteps steps = mock(OnboardingSteps.class);
        OnboardingRepository repository = mock(OnboardingRepository.class);
        OnboardingOperation operation = OnboardingOperation.builder().id(UUID.randomUUID()).lifecycleDecision("ACTIVE").lifecycleRestartNo(0).build();
        when(repository.pendingPublications(anyLong())).thenReturn(List.of(operation));
        doThrow(new OnboardingFailure("IDENTITY_UNAVAILABLE", true, 503)).when(steps).publish(operation);
        var publisher = new OnboardingLifecyclePublisher(repository, steps);
        for (int attempts = 9; attempts <= 11; attempts++) {
            when(repository.deferPublication(eq(operation), anyLong()))
                    .thenReturn(Optional.of(new OnboardingRepository.PublicationDeferral("gateprf", attempts, 0L)));
            publisher.publishPending();
        }
        assertEquals(List.of(Level.WARN, Level.ERROR, Level.WARN), logs.list.stream().map(ILoggingEvent::getLevel).toList());
        assertTrue(logs.list.get(1).getFormattedMessage().contains("attempts=" + OnboardingLifecyclePublisher.STUCK_ATTEMPTS));
    }

    @Test public void publicationThatRacedToAcknowledgementLogsNothing() {
        OnboardingSteps steps = mock(OnboardingSteps.class);
        OnboardingRepository repository = mock(OnboardingRepository.class);
        OnboardingOperation operation = OnboardingOperation.builder().id(UUID.randomUUID()).lifecycleDecision("ACTIVE").lifecycleRestartNo(0).build();
        when(repository.pendingPublications(anyLong())).thenReturn(List.of(operation));
        when(repository.deferPublication(any(), anyLong())).thenReturn(Optional.empty());
        doThrow(new OnboardingFailure("IDENTITY_UNAVAILABLE", true, 503)).when(steps).publish(operation);
        new OnboardingLifecyclePublisher(repository, steps).publishPending();
        assertTrue(logs.list.isEmpty());
    }
}
