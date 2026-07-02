package org.egov.novubridge.web.controllers;

import org.egov.novubridge.repository.DispatchLogRepository;
import org.egov.novubridge.web.models.DispatchLogEntry;
import org.egov.novubridge.web.models.DispatchLogListResponse;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.http.ResponseEntity;

import java.util.Collections;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * NB-5: the read-only {@code /novu-adapter/v1/logs} proxy. Constructed as a POJO
 * (constructor-injected) and its handler called directly. Guards: blank tenant →
 * 400; filters pass through to the repository verbatim; limit clamped to [1,500]
 * (default 50) and offset floored at 0; the response {@code total} comes from the
 * COUNT with the same filters as the LIST.
 */
class DispatchLogControllerTest {

    private DispatchLogRepository repository;
    private DispatchLogController controller;

    @BeforeEach
    void setUp() {
        repository = mock(DispatchLogRepository.class);
        controller = new DispatchLogController(repository);
        when(repository.list(anyString(), any(), anyBoolean(), any(), any(), any(), anyInt(), anyInt()))
                .thenReturn(Collections.emptyList());
        when(repository.count(anyString(), any(), anyBoolean(), any(), any(), any()))
                .thenReturn(0L);
    }

    @Test
    void blankTenantId_returns400_noRepositoryCall() {
        assertEquals(400, controller.logs(null, null, false, null, null, null, null, null).getStatusCode().value());
        assertEquals(400, controller.logs("   ", null, false, null, null, null, null, null).getStatusCode().value());
        verify(repository, never()).list(anyString(), any(), anyBoolean(), any(), any(), any(), anyInt(), anyInt());
        verify(repository, never()).count(anyString(), any(), anyBoolean(), any(), any(), any());
    }

    @Test
    void filters_arePassedThroughVerbatim() {
        controller.logs("ke.bomet", "PGR-001", true, "txn-1", "SMS", "SENT", 25, 5);

        verify(repository).list(eq("ke.bomet"), eq("PGR-001"), eq(true), eq("txn-1"), eq("SMS"), eq("SENT"),
                eq(25), eq(5));
        verify(repository).count(eq("ke.bomet"), eq("PGR-001"), eq(true), eq("txn-1"), eq("SMS"), eq("SENT"));
    }

    @Test
    void limit_isClampedTo1To500_default50_offsetFlooredAt0() {
        ArgumentCaptor<Integer> limit = ArgumentCaptor.forClass(Integer.class);
        ArgumentCaptor<Integer> offset = ArgumentCaptor.forClass(Integer.class);

        controller.logs("ke.bomet", null, false, null, null, null, null, null);   // default
        controller.logs("ke.bomet", null, false, null, null, null, 0, null);      // clamp up to 1
        controller.logs("ke.bomet", null, false, null, null, null, 9999, -10);    // clamp down to 500, offset floor 0

        verify(repository, org.mockito.Mockito.times(3))
                .list(anyString(), any(), anyBoolean(), any(), any(), any(), limit.capture(), offset.capture());

        List<Integer> limits = limit.getAllValues();
        List<Integer> offsets = offset.getAllValues();
        assertEquals(50, limits.get(0));   // null → default 50
        assertEquals(0, offsets.get(0));   // null → 0
        assertEquals(1, limits.get(1));    // 0 → 1
        assertEquals(500, limits.get(2));  // 9999 → 500
        assertEquals(0, offsets.get(2));   // -10 → 0
    }

    @Test
    void total_comesFromCountWithSameFilters() {
        when(repository.count(eq("ke.bomet"), eq("PGR-001"), eq(false), eq("txn-9"), eq("EMAIL"), eq("FAILED")))
                .thenReturn(1234L);

        ResponseEntity<DispatchLogListResponse> response =
                controller.logs("ke.bomet", "PGR-001", false, "txn-9", "EMAIL", "FAILED", 50, 0);

        assertEquals(200, response.getStatusCode().value());
        assertEquals(1234L, response.getBody().getTotal());
        // count must have received the identical filter tuple as list.
        verify(repository).count(eq("ke.bomet"), eq("PGR-001"), eq(false), eq("txn-9"), eq("EMAIL"), eq("FAILED"));
        verify(repository).list(eq("ke.bomet"), eq("PGR-001"), eq(false), eq("txn-9"), eq("EMAIL"), eq("FAILED"),
                eq(50), eq(0));
    }

    @Test
    void recipientPiiIsMaskedInResponseRows() {
        DispatchLogEntry row = DispatchLogEntry.builder()
                .tenantId("ke.bomet").channel("SMS").status("SENT")
                .recipientValue("ke.bomet:0712345678")
                .transactionId("PGR-001:ASSIGN:PENDINGATLME:ke.bomet:0712345678:SMS")
                .build();
        when(repository.list(anyString(), any(), anyBoolean(), any(), any(), any(), anyInt(), anyInt()))
                .thenReturn(List.of(row));

        ResponseEntity<DispatchLogListResponse> response =
                controller.logs("ke.bomet", null, false, null, null, null, null, null);

        DispatchLogEntry masked = response.getBody().getData().get(0);
        // The raw phone-bearing recipient value must never cross the wire.
        org.junit.jupiter.api.Assertions.assertFalse(masked.getRecipientValue().contains("0712345678"),
                "recipient_value must be masked; got " + masked.getRecipientValue());
    }
}
