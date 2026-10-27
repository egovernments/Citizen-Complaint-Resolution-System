package org.egov.pgr.onboarding;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.egov.common.utils.MultiStateInstanceUtil;
import org.egov.mdms.model.MdmsCriteriaReq;
import org.egov.pgr.analytics.AnalyticsCapabilities;
import org.egov.pgr.analytics.KpiCatalogService;
import org.egov.pgr.analytics.model.DashboardPack;
import org.egov.pgr.analytics.model.KpiDefinition;
import org.egov.pgr.config.PGRConfiguration;
import org.egov.pgr.repository.ServiceRequestRepository;
import java.util.*;
import java.util.stream.Collectors;
import static org.junit.Assert.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * Reads what onboarding wrote to an in-memory MDMS (rows keyed "tenant|schemaCode|uniqueIdentifier") through the real
 * {@link KpiCatalogService}, the way the anonymous /v2/analytics/public/* endpoints do.
 */
final class DashboardCatalogProbe {
    private DashboardCatalogProbe() {}

    /**
     * The workspace's public dashboard stays off by default, and once its founder turns it on the workspace's own
     * catalog serves the curated public pack.
     */
    static void assertPublicDashboardServed(Map<String, JsonNode> rows, String tenant, ObjectMapper mapper) {
        assertFalse("public dashboard must stay off until the founder enables it", catalog(rows, mapper).isPublicDashboardEnabled(tenant));

        JsonNode config = rows.get(tenant + "|dss.DashboardConfig|default");
        assertNotNull("onboarding writes the workspace's DashboardConfig", config);
        ((ObjectNode) config.path("data")).put("publicDashboardEnabled", true); // what the configurator switch writes
        KpiCatalogService service = catalog(rows, mapper);
        assertTrue(service.isPublicDashboardEnabled(tenant));

        AnalyticsCapabilities surface = AnalyticsCapabilities.publicSurface();
        List<KpiDefinition> defs = service.getVisibleDefs(tenant, surface);
        Set<String> ids = defs.stream().map(KpiDefinition::getId).collect(Collectors.toSet());
        Optional<DashboardPack> pack = service.getBestPack(tenant, surface, defs);
        assertTrue("no PUBLIC pack for " + tenant, pack.isPresent());
        assertEquals("public-default", pack.get().getId());
        assertFalse(pack.get().getTiles().isEmpty());
        assertTrue("every public tile resolves to a public KPI", ids.containsAll(pack.get().getTiles()));
        assertEquals("the public pack loses no tile to a missing definition",
                rows.get(tenant + "|dss.DashboardPack|public-default").path("data").path("tiles").size(), pack.get().getTiles().size());

        // The signed-in dashboard's pack, from the same catalog: every tile and layout entry names a published KPI.
        JsonNode supervisor = rows.get(tenant + "|dss.DashboardPack|supervisor-default");
        assertNotNull("onboarding writes the supervisor-default pack", supervisor);
        assertFalse(supervisor.path("data").path("tiles").isEmpty());
        List<String> refs = new ArrayList<>();
        supervisor.path("data").path("tiles").forEach(t -> refs.add(t.asText()));
        supervisor.path("data").path("layout").forEach(l -> refs.add(l.path("kpiId").asText()));
        for (String kpiId : refs)
            assertTrue("supervisor-default tile " + kpiId + " has no published definition",
                    service.getDef(kpiId, tenant).map(KpiDefinition::isPublished).orElse(false));
    }

    @SuppressWarnings("unchecked")
    private static KpiCatalogService catalog(Map<String, JsonNode> rows, ObjectMapper mapper) {
        PGRConfiguration config = mock(PGRConfiguration.class);
        when(config.getMdmsHost()).thenReturn("http://mdms-v2:8080");
        when(config.getMdmsEndPoint()).thenReturn("/mdms-v2/v1/_search");
        when(config.getAnalyticsConfigCacheTtlMs()).thenReturn(PGRConfiguration.DEFAULT_ANALYTICS_CONFIG_CACHE_TTL_MS);
        MultiStateInstanceUtil roots = mock(MultiStateInstanceUtil.class);
        when(roots.getStateLevelTenant(anyString())).thenAnswer(call -> call.getArgument(0, String.class).split("\\.")[0]);
        ServiceRequestRepository mdms = mock(ServiceRequestRepository.class);
        when(mdms.fetchResult(any(), any())).thenAnswer(call -> {
            var criteria = call.getArgument(1, MdmsCriteriaReq.class).getMdmsCriteria();
            var module = criteria.getModuleDetails().get(0);
            String master = module.getMasterDetails().get(0).getName();
            String prefix = criteria.getTenantId() + "|" + module.getModuleName() + "." + master + "|";
            List<Object> data = rows.entrySet().stream()
                    .filter(e -> e.getKey().startsWith(prefix) && e.getValue().path("isActive").asBoolean(true))
                    .map(e -> (Object) mapper.convertValue(e.getValue().path("data"), Map.class)).toList();
            return Map.of("MdmsRes", Map.of(module.getModuleName(), Map.of(master, data)));
        });
        return new KpiCatalogService(config, mdms, roots, mapper);
    }
}
