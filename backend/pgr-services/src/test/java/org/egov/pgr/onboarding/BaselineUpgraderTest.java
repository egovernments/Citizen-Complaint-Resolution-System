package org.egov.pgr.onboarding;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.*;
import java.util.*;
import static org.junit.Assert.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;

/** Seed v1 -> current upgrade against an in-memory MDMS and egov-localization (tenant chain [T, default]). */
public class BaselineUpgraderTest {
    private final ObjectMapper mapper = new ObjectMapper();
    private OnboardingProvisionerClient client; private WorkspaceRepository workspaces; private PlatformBaseline seed; private OnboardingSteps steps;
    private BaselineUpgrader upgrader; private OnboardingSignup signup;
    private final Map<String, JsonNode> rows = new LinkedHashMap<>(); private final Set<String> schemas = new HashSet<>();
    /** tenant|locale|module|code -> message */
    private final Map<String, String> messages = new LinkedHashMap<>();
    private final List<String> writes = new ArrayList<>();
    private Map<String, Object> finished;

    @Before @SuppressWarnings("unchecked") public void setup() throws Exception {
        client = mock(OnboardingProvisionerClient.class); seed = new PlatformBaseline(mapper); steps = new OnboardingSteps(client, seed, mapper);
        signup = OnboardingSignup.builder().id(UUID.randomUUID()).requestedTenantId("walkone").accountName("Walk One").accountCode("WALK1")
                .countryCode("KE").timeZone("Africa/Nairobi").languages(List.of("en")).build();
        OnboardingRepository onboarding = mock(OnboardingRepository.class);
        when(onboarding.findActiveSignupByTenant("walkone")).thenReturn(Optional.of(signup));
        workspaces = mock(WorkspaceRepository.class);
        when(workspaces.upgradeCheckpoint(anyString(), any(), anyMap(), anyLong(), anyLong())).thenReturn(true);
        when(workspaces.holdsUpgrade(anyString(), any(), anyLong())).thenReturn(true);
        when(workspaces.finishUpgrade(anyString(), any(), anyString(), any(), anyLong())).thenAnswer(call -> {
            finished = (Map<String, Object>) call.getArgument(3); return true; });
        upgrader = new BaselineUpgrader(workspaces, onboarding, steps, client, seed, mapper, true);
        when(client.read(anyString(), anyString(), anyMap())).thenAnswer(call -> read(call.getArgument(0), call.getArgument(1), call.getArgument(2)));
        when(client.write(any(), anyString(), anyString(), anyMap())).thenAnswer(call -> write(call.getArgument(1), call.getArgument(2), call.getArgument(3)));
        v1Workspace();
    }

    /** What seed v1 left at a KE workspace: no inbox/_count grant, StateInfo [en_KE], name key only in en_KE, packs in en_IN. */
    private void v1Workspace() {
        seed.schemas().forEach(s -> schemas.add(s.path("code").asText()));
        for (JsonNode row : seed.records()) if (!row.path("uniqueIdentifier").asText().matches("(.*\\.)?4560"))
            put(row.path("schemaCode").asText(), row.path("uniqueIdentifier").asText(), steps.substitute(row.path("data"), "walkone"));
        put("common-masters.IdFormat", "pgr.servicerequestid", Map.of("idname", "pgr.servicerequestid", "format", "WALK1-PGR"));
        put("common-masters.MobileNumberValidation", "+254", Map.of("countryCode", "+254"));
        put("dss.DashboardConfig", "default", Map.of("id", "default", "timeZone", "Africa/Nairobi"));
        put("common-masters.StateInfo", "walkone", Map.of("code", "walkone", "name", "Walk One", "languages", List.of(Map.of("label", "en", "value", "en_KE"))));
        rows.put("workflow|PGR", mapper.createObjectNode());
        seed.localizationPacks("en_IN").forEach((module, pack) -> pack.forEach(m -> message("walkone", "en_IN", module, m.path("code").asText(), m.path("message").asText())));
        message("walkone", "en_KE", "rainmaker-common", "TENANT_TENANTS_WALKONE", "Walk One");
    }
    private void put(String schema, String id, Map<String, Object> data) {
        rows.put("walkone|" + schema + "|" + id, mapper.valueToTree(Map.of("id", schema + id, "tenantId", "walkone", "schemaCode", schema,
                "uniqueIdentifier", id, "isActive", true, "data", data)));
    }
    private void message(String tenant, String locale, String module, String code, String text) { messages.put(tenant + "|" + locale + "|" + module + "|" + code, text); }

    @SuppressWarnings("unchecked")
    private JsonNode read(String service, String path, Map<String, Object> body) {
        if (service.equals("mdms") && path.contains("schema/v1/_search")) {
            String code = ((List<String>) ((Map<String, Object>) body.get("SchemaDefCriteria")).get("codes")).get(0);
            return mapper.valueToTree(Map.of("SchemaDefinitions", schemas.contains(code) ? List.of(Map.of("code", code)) : List.of()));
        }
        if (service.equals("mdms")) {
            var criteria = (Map<String, Object>) body.get("MdmsCriteria"); String prefix = criteria.get("tenantId") + "|" + criteria.get("schemaCode") + "|";
            var ids = (List<String>) criteria.get("uniqueIdentifiers");
            return mapper.valueToTree(Map.of("mdms", rows.entrySet().stream().filter(e -> e.getKey().startsWith(prefix)
                    && (ids == null || ids.contains(e.getKey().substring(prefix.length())))).map(Map.Entry::getValue).toList()));
        }
        if (service.equals("workflow")) return mapper.valueToTree(Map.of("BusinessServices", rows.containsKey("workflow|PGR") ? List.of(Map.of()) : List.of()));
        if (service.equals("localization")) {
            Map<String, String> q = new HashMap<>();
            for (String p : path.split("\\?", 2)[1].split("&")) q.put(p.split("=")[0], p.split("=")[1]);
            List<String> modules = List.of(q.get("module").split(","));
            for (String tenant : List.of(q.get("tenantId"), "default")) {
                var found = new ArrayList<Map<String, String>>();
                messages.forEach((key, text) -> {
                    String[] k = key.split("\\|");
                    if (k[0].equals(tenant) && k[1].equals(q.get("locale")) && modules.contains(k[2]) && (!q.containsKey("codes") || q.get("codes").equals(k[3])))
                        found.add(Map.of("code", k[3], "message", text, "module", k[2], "locale", k[1]));
                });
                if (!found.isEmpty()) return mapper.valueToTree(Map.of("messages", found));
            }
            return mapper.valueToTree(Map.of("messages", List.of()));
        }
        throw new AssertionError("unexpected read " + service + path);
    }

    @SuppressWarnings("unchecked")
    private JsonNode write(String service, String path, Map<String, Object> body) {
        if (path.contains("_create/") || path.contains("_update/")) {
            var row = (Map<String, Object>) body.get("Mdms"); put(row.get("schemaCode").toString(), row.get("uniqueIdentifier").toString(), (Map<String, Object>) row.get("data"));
            writes.add((path.contains("_create/") ? "create:" : "update:") + row.get("schemaCode") + ":" + row.get("uniqueIdentifier"));
        } else if (path.endsWith("_upsert") || path.endsWith("_delete")) {
            for (var m : (List<Object>) body.get("messages")) {
                JsonNode n = mapper.valueToTree(m); String key = body.get("tenantId") + "|" + n.path("locale").asText() + "|" + n.path("module").asText() + "|" + n.path("code").asText();
                if (path.endsWith("_upsert")) messages.put(key, n.path("message").asText()); else messages.remove(key);
                writes.add((path.endsWith("_upsert") ? "upsert:" : "delete:") + n.path("locale").asText() + ":" + n.path("code").asText());
            }
        } else writes.add(service + ":" + path);
        return mapper.createObjectNode();
    }

    private void upgrade() { upgrader.upgrade("walkone", 1, new LinkedHashMap<>(), UUID.randomUUID()); }

    @Test public void v1WorkspaceReceivesTheV2RecordsLanguagesAndNameKeys() {
        upgrade();
        assertTrue(writes.contains("create:ACCESSCONTROL-ACTIONS-TEST.actions-test:4560"));
        for (String role : List.of("GRO", "CSR", "PGR_LME", "SUPERUSER")) assertTrue(role, writes.contains("create:ACCESSCONTROL-ROLEACTIONS.roleactions:" + role + ".4560"));
        assertEquals(mapper.valueToTree(List.of(Map.of("label", "en", "value", "en_IN"))), rows.get("walkone|common-masters.StateInfo|walkone").path("data").path("languages"));
        assertEquals("Walk One", rows.get("walkone|common-masters.StateInfo|walkone").path("data").path("name").asText()); // other fields untouched
        assertFalse("stray key masking default in en_KE", messages.containsKey("walkone|en_KE|rainmaker-common|TENANT_TENANTS_WALKONE"));
        assertEquals("Walk One", messages.get("walkone|en_IN|rainmaker-common|TENANT_TENANTS_WALKONE"));
        assertTrue(writes.contains("localization:/localization/messages/cache-bust"));
        assertFalse("existing pack messages are not rewritten", writes.stream().anyMatch(w -> w.startsWith("upsert:en_IN:") && !w.endsWith("TENANT_TENANTS_WALKONE")));
        assertFalse("existing records are not rewritten", writes.stream().anyMatch(w -> w.startsWith("create:") && !w.contains("4560")));
        assertEquals(List.of(), finished.get("kept")); assertEquals("1", finished.get("from")); assertEquals(seed.version(), finished.get("to"));
        verify(workspaces).finishUpgrade(eq("walkone"), any(), eq(seed.version()), any(), anyLong());
    }

    @Test public void rerunMakesNoWrites() {
        upgrade(); writes.clear(); reset(workspaces);
        when(workspaces.upgradeCheckpoint(anyString(), any(), anyMap(), anyLong(), anyLong())).thenReturn(true);
        when(workspaces.holdsUpgrade(anyString(), any(), anyLong())).thenReturn(true);
        when(workspaces.finishUpgrade(anyString(), any(), anyString(), any(), anyLong())).thenReturn(true);
        upgrade();
        assertEquals(List.of(), writes);
    }

    @Test public void founderEditsAreLeftAlone() {
        put("common-masters.StateInfo", "walkone", Map.of("code", "walkone", "languages",
                List.of(Map.of("label", "sw", "value", "sw_KE"), Map.of("label", "en", "value", "en_KE"))));
        message("walkone", "en_KE", "rainmaker-common", "TENANT_TENANTS_WALKONE", "Walk One County");
        String rule = "walkone|ACCESSCONTROL-ROLEACTIONS.roleactions|GRO.4560";
        rows.put(rule, ((com.fasterxml.jackson.databind.node.ObjectNode) mapper.valueToTree(Map.of("tenantId", "walkone", "data", Map.of("rolecode", "GRO")))).put("isActive", false));
        upgrade();
        assertEquals("sw_KE", rows.get("walkone|common-masters.StateInfo|walkone").path("data").path("languages").path(0).path("value").asText());
        assertEquals("Walk One County", messages.get("walkone|en_KE|rainmaker-common|TENANT_TENANTS_WALKONE"));
        assertFalse(writes.stream().anyMatch(w -> w.startsWith("update:") || w.startsWith("delete:") || w.endsWith("GRO.4560")));
        assertEquals(List.of("inactive:ACCESSCONTROL-ROLEACTIONS.roleactions:GRO.4560", "state-info-languages", "name-key:en_KE"), finished.get("kept"));
    }

    @Test public void packsAreFilledOnlyWhereTheTenantAnswersForTheLocale() {
        // A pre-pack v1 workspace in India: en_IN holds only the name key, so the tenant hides `default` there.
        messages.clear(); signup.setCountryCode("IN"); message("walkone", "en_IN", "rainmaker-common", "TENANT_TENANTS_WALKONE", "Walk One");
        put("common-masters.StateInfo", "walkone", Map.of("code", "walkone", "languages", List.of(Map.of("label", "en", "value", "en_IN"))));
        upgrade();
        seed.localizationPacks("en_IN").forEach((module, pack) -> pack.forEach(m ->
                assertEquals(m.path("message").asText(), messages.get("walkone|en_IN|" + module + "|" + m.path("code").asText()))));
        assertFalse(writes.contains("upsert:en_IN:TENANT_TENANTS_WALKONE"));

        // When `default` answers for the locale, nothing at the tenant masks it: no partial pack, no lone name key.
        messages.clear(); writes.clear();
        seed.localizationPacks("en_IN").forEach((module, pack) -> pack.forEach(m -> message("default", "en_IN", module, m.path("code").asText(), m.path("message").asText())));
        upgrade();
        assertEquals(List.of(), writes);
    }

    @Test public void lostLeaseStopsBeforeTheNextWrite() {
        when(workspaces.claimUpgrade(anyLong(), any(), anyLong(), anyLong())).thenReturn(Optional.of(new LinkedHashMap<>(Map.of(
                "tenantId", "walkone", "seedVersion", "1", "progress", new LinkedHashMap<>(Map.of("records", "DONE", "localization-packs", "DONE"))))));
        when(workspaces.upgradeCheckpoint(anyString(), any(), anyMap(), anyLong(), anyLong())).thenReturn(false);
        assertTrue(upgrader.upgradeNext());
        assertEquals("only the StateInfo write before the failed checkpoint", List.of("update:common-masters.StateInfo:walkone"), writes);
        verify(workspaces, never()).retryUpgrade(anyString(), any(), anyString(), anyBoolean(), anyLong());
        verify(workspaces, never()).finishUpgrade(anyString(), any(), anyString(), any(), anyLong());
    }

    @Test public void failuresBackOffAndDisabledUpgraderClaimsNothing() {
        when(workspaces.claimUpgrade(anyLong(), any(), anyLong(), anyLong())).thenReturn(Optional.of(new LinkedHashMap<>(Map.of(
                "tenantId", "walkone", "seedVersion", "1", "progress", new LinkedHashMap<>()))));
        doThrow(new OnboardingFailure("PROVISIONING_UNAVAILABLE", true)).when(client).read(eq("workflow"), anyString(), anyMap());
        assertTrue(upgrader.upgradeNext());
        verify(workspaces).retryUpgrade(eq("walkone"), any(), eq("PROVISIONING_UNAVAILABLE"), eq(true), anyLong());
        verify(workspaces).claimUpgrade(eq((long) seed.versionNumber()), any(), anyLong(), anyLong());

        var off = new BaselineUpgrader(workspaces, mock(OnboardingRepository.class), steps, client, seed, mapper, false);
        assertFalse(off.upgradeNext()); verify(workspaces, times(1)).claimUpgrade(anyLong(), any(), anyLong(), anyLong());
    }
}
