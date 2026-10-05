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

    @Test public void everyRecordHasASeededSchema() {
        Set<String> schemas = new HashSet<>(); seed.schemas().forEach(s -> schemas.add(s.path("code").asText()));
        for (JsonNode row : seed.records())
            assertTrue(row.path("schemaCode").asText() + " has no schema", schemas.contains(row.path("schemaCode").asText()));
    }
}
