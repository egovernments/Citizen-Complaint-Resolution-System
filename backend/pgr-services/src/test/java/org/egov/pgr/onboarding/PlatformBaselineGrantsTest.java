package org.egov.pgr.onboarding;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.Test;
import java.util.*;
import static org.junit.Assert.*;

/** Kong authorizes the exact request URI, so every workspace-setup MDMS write needs a founder grant in the seed. */
public class PlatformBaselineGrantsTest {
    // MDMS writes made by the configurator's workspace setup: ENDPOINTS.MDMS_CREATE/MDMS_UPDATE
    // (configurator/src/api/config.ts) + "/" + schema code, as used by mdmsService.create/update/
    // setActive/upsertMapConfig from configurator/src/onboarding/** (brandingApi.ts,
    // complaints/complaintsApi.ts, departments/mastersApi.ts, geography/BoundaryImport.tsx).
    // configurator/src/identity/workspace.ts (workspace settings) writes identity.invitationPolicy.
    // Keep in sync when a setup step writes a new master.
    private static final List<String> WORKSPACE_SETUP_MDMS_WRITES = List.of(
            "/mdms-v2/v2/_update/tenant.tenants",
            "/mdms-v2/v2/_create/common-masters.ThemeConfig", "/mdms-v2/v2/_update/common-masters.ThemeConfig",
            "/mdms-v2/v2/_create/RAINMAKER-PGR.ComplaintHierarchyDefinition", "/mdms-v2/v2/_update/RAINMAKER-PGR.ComplaintHierarchyDefinition",
            "/mdms-v2/v2/_create/RAINMAKER-PGR.ComplaintHierarchy", "/mdms-v2/v2/_update/RAINMAKER-PGR.ComplaintHierarchy",
            "/mdms-v2/v2/_create/common-masters.Department", "/mdms-v2/v2/_update/common-masters.Department",
            "/mdms-v2/v2/_create/common-masters.Designation", "/mdms-v2/v2/_update/common-masters.Designation",
            "/mdms-v2/v2/_create/RAINMAKER-PGR.MapConfig", "/mdms-v2/v2/_update/RAINMAKER-PGR.MapConfig",
            "/mdms-v2/v2/_create/CMS-BOUNDARY.HierarchySchema",
            "/mdms-v2/v2/_create/identity.invitationPolicy", "/mdms-v2/v2/_update/identity.invitationPolicy");

    @Test public void everyWorkspaceSetupMdmsWriteIsGrantedToAFounderRole() throws Exception {
        var seed = new PlatformBaseline(new ObjectMapper());
        Set<String> founder = new HashSet<>(); seed.founderRoles().forEach(r -> founder.add(r.asText()));
        Map<String, Set<Long>> actions = new HashMap<>(); Map<Long, Set<String>> grants = new HashMap<>(); Set<Long> ids = new HashSet<>();
        for (JsonNode row : seed.records()) {
            JsonNode data = row.path("data");
            if ("ACCESSCONTROL-ACTIONS-TEST.actions-test".equals(row.path("schemaCode").asText())) {
                assertTrue("duplicate action id " + data.path("id"), ids.add(data.path("id").asLong()));
                // egov-accesscontrol loads actions with filter [*]['id','url'] and never reads "enabled".
                actions.computeIfAbsent(data.path("url").asText(), k -> new HashSet<>()).add(data.path("id").asLong());
            }
            if ("ACCESSCONTROL-ROLEACTIONS.roleactions".equals(row.path("schemaCode").asText()))
                grants.computeIfAbsent(data.path("actionid").asLong(), k -> new HashSet<>()).add(data.path("rolecode").asText());
        }
        for (String uri : WORKSPACE_SETUP_MDMS_WRITES)
            assertTrue(uri + " has no founder grant", actions.getOrDefault(uri, Set.of()).stream()
                    .anyMatch(id -> grants.getOrDefault(id, Set.of()).stream().anyMatch(founder::contains)));
    }

    /** digit-ui calls the inbox routes when InboxVisibilityConfig.serverSide is true; a role that can search complaints must reach it. */
    @Test public void inboxSearchAndCountAreGrantedToTheSameEmployeeRolesAsExistingTenants() throws Exception {
        Map<Long, String> urls = new HashMap<>(); Map<String, Set<String>> roles = new HashMap<>();
        var records = new PlatformBaseline(new ObjectMapper()).records();
        for (JsonNode row : records) if ("ACCESSCONTROL-ACTIONS-TEST.actions-test".equals(row.path("schemaCode").asText()))
            urls.put(row.path("data").path("id").asLong(), row.path("data").path("url").asText());
        for (JsonNode row : records) if ("ACCESSCONTROL-ROLEACTIONS.roleactions".equals(row.path("schemaCode").asText())) {
            String url = urls.get(row.path("data").path("actionid").asLong());
            if (url != null) roles.computeIfAbsent(url, k -> new TreeSet<>()).add(row.path("data").path("rolecode").asText());
        }
        // Actions 4559 (_search) and 4560 (_count) on existing tenants: employee endpoints, never CITIZEN.
        // The server-side inbox calls both; the count must not 403 where the search succeeds.
        for (String url : List.of("/pgr-services/v2/request/inbox/_search", "/pgr-services/v2/request/inbox/_count"))
            assertEquals(url, new TreeSet<>(List.of("ACCOUNT_ADMIN", "AUTO_ESCALATE", "CSR", "GRO", "PGR_LME", "SUPERUSER")),
                    roles.getOrDefault(url, Set.of()));
        assertEquals("/pgr-services/v2/request/inbox/_count", urls.get(4560L));
    }
}
