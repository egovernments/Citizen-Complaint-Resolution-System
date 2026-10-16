package org.egov.pgr.service;

import io.opentelemetry.api.trace.Span;
import io.opentelemetry.context.Scope;
import io.opentelemetry.sdk.testing.exporter.InMemorySpanExporter;
import io.opentelemetry.sdk.trace.SdkTracerProvider;
import io.opentelemetry.sdk.trace.data.SpanData;
import io.opentelemetry.sdk.trace.export.SimpleSpanProcessor;
import org.egov.pgr.config.PGRConfiguration;
import org.egov.pgr.onboarding.WorkspaceRepository;
import org.egov.pgr.repository.PGRRepository;
import org.egov.pgr.web.models.AuditDetails;
import org.egov.pgr.web.models.Service;
import org.egov.pgr.web.models.ServiceWrapper;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/** A scan must not grow one trace per pass: each complaint is its own root span. */
class EscalationSchedulerTracingTest {

    private static ServiceWrapper complaint(String id) {
        Service service = Service.builder()
                .serviceRequestId(id).tenantId("ke.bomet").applicationStatus("PENDINGATLME")
                .auditDetails(AuditDetails.builder().createdTime(1L).build())
                .build();
        return ServiceWrapper.builder().service(service).build();
    }

    @Test
    void everyComplaintInAScanStartsItsOwnTrace() {
        PGRConfiguration config = mock(PGRConfiguration.class);
        when(config.getEscalationEnabled()).thenReturn(true);
        when(config.getEscalationBatchSize()).thenReturn(50);
        PGRRepository repository = mock(PGRRepository.class);
        when(repository.getServiceWrappers(any())).thenReturn(List.of(complaint("PG-1"), complaint("PG-2")));
        EscalationConfigurationService configurationService = mock(EscalationConfigurationService.class);
        when(configurationService.resolve(any(), anyString())).thenReturn(new EscalationConfigurationService.ResolvedEscalationConfig(
                1, List.of(), List.of(), List.of(), List.of("PENDINGATLME"), Map.of(), Map.of()));
        when(configurationService.resolveStateTenants(any(), anyString())).thenReturn(List.of("ke.bomet"));
        WorkspaceRepository workspaces = mock(WorkspaceRepository.class);
        when(workspaces.onboardedTenantIds()).thenReturn(List.of());

        EscalationScheduler scheduler = new EscalationScheduler(config, repository, mock(EscalationService.class),
                configurationService, mock(PGRService.class), workspaces);
        ReflectionTestUtils.setField(scheduler, "stateLevelTenantId", "ke");

        InMemorySpanExporter exporter = InMemorySpanExporter.create();
        SdkTracerProvider provider = SdkTracerProvider.builder()
                .addSpanProcessor(SimpleSpanProcessor.create(exporter)).build();
        ReflectionTestUtils.setField(scheduler, "tracer", provider.get("test"));

        // Stands in for the javaagent's @Scheduled span around the whole pass.
        Span pass = provider.get("test").spanBuilder("scheduled-pass").startSpan();
        try (Scope ignored = pass.makeCurrent()) {
            scheduler.scanAndEscalate();
        } finally {
            pass.end();
        }

        List<SpanData> complaints = exporter.getFinishedSpanItems().stream()
                .filter(span -> span.getName().equals("pgr.escalation.complaint"))
                .collect(Collectors.toList());
        assertEquals(2, complaints.size());
        Set<String> traces = complaints.stream().map(SpanData::getTraceId).collect(Collectors.toSet());
        assertEquals(2, traces.size(), "each complaint gets its own trace");
        assertFalse(traces.contains(pass.getSpanContext().getTraceId()), "complaints never join the pass trace");
        complaints.forEach(span -> assertFalse(span.getParentSpanContext().isValid()));
    }
}
