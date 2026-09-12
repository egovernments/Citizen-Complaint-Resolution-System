package org.egov.pgr.service;

import org.egov.common.contract.request.RequestInfo;
import org.egov.common.utils.MultiStateInstanceUtil;
import org.egov.pgr.config.PGRConfiguration;
import org.egov.pgr.repository.ServiceRequestRepository;
import org.egov.pgr.util.MDMSUtils;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class EscalationConfigurationServiceTest {

    @Mock private PGRConfiguration config;
    @Mock private ServiceRequestRepository repository;
    @Mock private MDMSUtils mdmsUtils;
    @Mock private MultiStateInstanceUtil multiStateInstanceUtil;

    private EscalationConfigurationService service;

    @BeforeEach
    void setUp() {
        service = new EscalationConfigurationService(config, repository, mdmsUtils, multiStateInstanceUtil);
        when(mdmsUtils.getMdmsSearchUrl()).thenReturn(new StringBuilder("http://mdms/_search"));
        when(multiStateInstanceUtil.getStateLevelTenant("ke.bomet")).thenReturn("ke");
        when(config.getEscalationMaxDepth()).thenReturn(3);
        when(config.getEscalationDefaultSlaMs()).thenReturn(500L);
    }

    @Test
    void resolvesLeafServiceCodeArrayAndStructuredOverrides() {
        Map<String, Object> record = Map.of(
                "maxDepth", 4,
                "defaultSlaByLevel", List.of(100L, 200L),
                "enabledByLevel", List.of(true, false),
                "overrides", Map.of(
                        "ROAD.POTHOLE", List.of(10L, 20L),
                        "WATER.LEAK", Map.of(
                                "slaByLevel", List.of(30L, 40L),
                                "enabledByLevel", List.of(false, true))));
        when(repository.fetchResult(any(StringBuilder.class), any())).thenReturn(
                Map.of("MdmsRes", Map.of("RAINMAKER-PGR", Map.of("EscalationConfig", List.of(record)))));

        EscalationConfigurationService.ResolvedEscalationConfig resolved =
                service.resolve(RequestInfo.builder().build(), "ke.bomet");

        assertEquals(4, resolved.getMaxDepth());
        assertEquals(20L, resolved.resolveSla("ROAD.POTHOLE", 5));
        assertEquals(40L, resolved.resolveSla("WATER.LEAK", 1));
        assertFalse(resolved.isEnabled("WATER.LEAK", 0));
        assertTrue(resolved.isEnabled("WATER.LEAK", 1));
        assertFalse(resolved.isEnabled("OTHER", 1));
    }

    @Test
    void missingRecordUsesServiceDefaults() {
        when(repository.fetchResult(any(StringBuilder.class), any())).thenReturn(
                Map.of("MdmsRes", Map.of("RAINMAKER-PGR", Map.of("EscalationConfig", List.of()))));

        EscalationConfigurationService.ResolvedEscalationConfig resolved =
                service.resolve(RequestInfo.builder().build(), "ke.bomet");

        assertEquals(3, resolved.getMaxDepth());
        assertEquals(500L, resolved.resolveSla("ANY.LEAF", 9));
        assertTrue(resolved.isEnabled("ANY.LEAF", 9));
    }
}
