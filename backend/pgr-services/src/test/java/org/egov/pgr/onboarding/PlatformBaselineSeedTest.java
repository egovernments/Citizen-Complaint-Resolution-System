package org.egov.pgr.onboarding;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.Test;
import java.util.*;
import java.util.regex.Pattern;
import static org.junit.Assert.*;

/** Structural checks over the platform seed: no tenant leakage and no dangling role, action or schema references. */
public class PlatformBaselineSeedTest {
    private static final Pattern LITERAL_TENANT = Pattern.compile("(pg|ke|statea|citya)(\\..*)?");
    private final PlatformBaseline seed;
    public PlatformBaselineSeedTest() throws Exception { seed = new PlatformBaseline(new ObjectMapper()); }

    /** Recorded per workspace as seed_version; the JSON is the only place it is set. v1 workspaces exist, so it is past 1. */
    @Test public void seedVersionIsAnIntegerPastTheFirstRelease() { assertTrue(seed.versionNumber() >= 2); assertEquals(String.valueOf(seed.versionNumber()), seed.version()); }

    /**
     * Existing workspaces are upgraded (BaselineUpgrader) only when the seed's version rises, so a content change
     * under an unchanged version never reaches them. v2 changed in place until #2269 merged; from then on, changing
     * the seed means bumping "version" and recording both here. v3 carries the onboarding Geography step's labels;
     * v4 drops the TRANSGENDER and OTHERS genders (#2397); v5 the docs rail, tour and next-step card labels (#2439);
     * v6 lets the founder save the dashboard settings (dss.DashboardConfig writes, #2221);
     * v7 drops CSR's /user/users/_createnovalidate grant, which BaselineUpgrader also deactivates (#2239);
     * v8 the fr_FR and pt_BR citizen and employee packs, and the en_IN keys those screens ask for;
     * v9 the dashboard's workspace links card and complaint-desk link in the hi_IN, fr_FR and pt_BR packs (#2589);
     * v10 the employee email sign-in strings, under new keys, in the en_IN, hi_IN, fr_FR and pt_BR configurator-ui packs (#2646);
     * v11 the employee home's Dashboard card title in the en_IN, fr_FR and pt_BR rainmaker-common packs;
     * v12 the bulk-upload CSR-role note (en_IN configurator-ui) and the channel-neutral complaint success text (en_IN rainmaker-pgr);
     * v13 the console Dashboard heading "DIGIT Complaint Management Studio", under the new key app.header.studio_title, in the en_IN, hi_IN, fr_FR and pt_BR configurator-ui packs;
     * v14 the onboarding tour's Complaints Template text, under the new key app.onboarding.home.tour.complaints.body_choice (en_IN configurator-ui);
     * v15 every configurator-ui key in the fr_FR, hi_IN and pt_BR packs, and hi_IN rainmaker-common, -pgr and -hr packs;
     * v16 the dashboard catalog (dss.KpiDefinition and dss.DashboardPack schemas and records), so a workspace that turns
     * its public dashboard on serves its own curated public pack.
     */
    private static final String VERSION = "16";
    private static final String SHA256 = "016d35140da1e44e312a0c6d1156852b5f0f80b231a43dd0f449232fc3e930f0";
    @Test public void contentChangesComeWithAVersionBump() throws Exception {
        byte[] bytes;
        try (var in = PlatformBaselineSeedTest.class.getResourceAsStream("/onboarding/platform-baseline-v1.json")) { bytes = in.readAllBytes(); }
        String sha = java.util.HexFormat.of().formatHex(java.security.MessageDigest.getInstance("SHA-256").digest(bytes));
        if (VERSION.equals(seed.version()))
            assertEquals("platform-baseline-v1.json changed but \"version\" did not: bump it so existing workspaces get the change, then record the new version and SHA-256 here", SHA256, sha);
        else fail("seed version is now " + seed.version() + ": record VERSION=\"" + seed.version() + "\" and SHA256=\"" + sha + "\" in this test");
    }

    private Set<String> codes(String schema, String field) {
        Set<String> out = new HashSet<>();
        for (JsonNode row : seed.records()) if (schema.equals(row.path("schemaCode").asText())) out.add(row.path("data").path(field).asText());
        return out;
    }
    private static void strings(JsonNode node, List<String> out) {
        if (node.isTextual()) out.add(node.asText());
        node.forEach(child -> strings(child, out));
    }
    private static void roleRefs(JsonNode node, Set<String> out) {
        node.fields().forEachRemaining(field -> {
            String key = field.getKey(); JsonNode value = field.getValue();
            if ((key.equals("roleCode") || key.equals("rolecode")) && value.isTextual()) out.add(value.asText());
            if (key.equals("roles") && value.isArray()) value.forEach(r -> out.add(r.isTextual() ? r.asText() : r.path("code").asText()));
        });
        node.forEach(child -> roleRefs(child, out));
    }

    @Test public void seedCarriesNoLiteralTenantIds() {
        List<String> values = new ArrayList<>(); strings(seed.records(), values); strings(seed.workflows(), values);
        for (String value : values) assertFalse("literal tenant id " + value, LITERAL_TENANT.matcher(value).matches());
    }

    @Test public void everyReferencedRoleHasARoleRecord() {
        Set<String> roles = codes("ACCESSCONTROL-ROLES.roles", "code"), referenced = new TreeSet<>();
        for (JsonNode row : seed.records()) {
            String schema = row.path("schemaCode").asText();
            if (schema.startsWith("DataSecurity.") || schema.equals("ACCESSCONTROL-ROLEACTIONS.roleactions")) roleRefs(row.path("data"), referenced);
        }
        roleRefs(seed.workflows(), referenced); seed.founderRoles().forEach(r -> referenced.add(r.asText()));
        referenced.removeAll(roles);
        assertEquals("roles referenced without an ACCESSCONTROL-ROLES record", Set.of(), referenced);
    }

    @Test public void everyRoleActionNamesASeededAction() {
        Set<String> actions = codes("ACCESSCONTROL-ACTIONS-TEST.actions-test", "id");
        for (JsonNode row : seed.records()) if ("ACCESSCONTROL-ROLEACTIONS.roleactions".equals(row.path("schemaCode").asText()))
            assertTrue(row.path("uniqueIdentifier").asText() + " has no action", actions.contains(row.path("data").path("actionid").asText()));
    }

    // mdms-v2 validates with everit 1.5.1, which ignores "const" and "not" next to "type"; it applies
    // "pattern" with java.util.regex find(), so a negative lookahead is what rejects the reserved name.
    @Test public void hierarchySchemaRejectsTheReservedWorkspaceHierarchy() {
        JsonNode hierarchy = null;
        for (JsonNode s : seed.schemas()) if ("CMS-BOUNDARY.HierarchySchema".equals(s.path("code").asText()))
            hierarchy = s.path("definition").path("properties").path("hierarchy");
        assertNotNull("CMS-BOUNDARY.HierarchySchema not seeded", hierarchy);
        Pattern pattern = Pattern.compile(hierarchy.path("pattern").asText());
        assertFalse(pattern.matcher("WORKSPACE").find());
        for (String ok : List.of("ADMIN", "REVENUE", "WORKSPACE_X", "MY_WORKSPACE")) assertTrue(ok, pattern.matcher(ok).find());
    }

    /**
     * The dashboard catalog is copied from its repository source of truth (the files digit-mcp's catalog floor also
     * embeds): schemas from local-setup/db/dss-mdms-seed/schemas, records from ansible/nairobi-mdms/mdms/dss, with the
     * source tenant dropped because onboarding writes each record at the workspace. A source edit must be copied here
     * (with a version bump) or this fails.
     */
    @Test public void dashboardCatalogMatchesItsRepositorySource() throws Exception {
        ObjectMapper mapper = new ObjectMapper(); java.nio.file.Path repo = java.nio.file.Path.of("../..");
        for (String master : List.of("KpiDefinition", "DashboardPack")) {
            String code = "dss." + master;
            JsonNode schema = null;
            for (JsonNode s : seed.schemas()) if (code.equals(s.path("code").asText())) schema = s.path("definition");
            assertEquals(code, mapper.readTree(repo.resolve("local-setup/db/dss-mdms-seed/schemas/" + code + ".json").toFile()), schema);
            List<JsonNode> expected = new ArrayList<>(), seeded = new ArrayList<>();
            for (JsonNode r : mapper.readTree(repo.resolve("ansible/nairobi-mdms/mdms/dss/" + master + ".json").toFile()))
                expected.add(mapper.createObjectNode().put("schemaCode", code).put("uniqueIdentifier", r.path("data").path("id").asText()).set("data", r.path("data")));
            for (JsonNode row : seed.records()) if (code.equals(row.path("schemaCode").asText())) seeded.add(row);
            assertEquals(code, expected, seeded);
        }
    }

    @Test public void everyRecordHasASeededSchema() {
        Set<String> schemas = new HashSet<>(); seed.schemas().forEach(s -> schemas.add(s.path("code").asText()));
        for (JsonNode row : seed.records())
            assertTrue(row.path("schemaCode").asText() + " has no schema", schemas.contains(row.path("schemaCode").asText()));
    }
}
