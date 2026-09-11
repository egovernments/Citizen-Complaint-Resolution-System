package org.egov.pgr.analytics;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

import static org.junit.jupiter.api.Assertions.*;

/** Contract checks for tenant-root timezone resolution in the V2 grain migration. */
public class TenantBusinessCalendarMigrationTest {

    private static final String MIGRATION =
            "db/migration/main/V20260810000000__tenant_business_calendar_grains.sql";

    @Test
    public void bothGrainsChooseTheDeepestDotBoundaryTenantRoot() throws IOException {
        String sql;
        try (InputStream in = getClass().getClassLoader().getResourceAsStream(MIGRATION)) {
            assertNotNull(in, "business-calendar migration must be packaged as a classpath resource");
            sql = new String(in.readAllBytes(), StandardCharsets.UTF_8).replaceAll("\\s+", " ");
        }

        assertEquals(2, occurrences(sql, "FROM pgr_dashboard_tenant_timezone candidate"),
                "complaint_events and complaint_facts must use the same root resolver");
        assertTrue(sql.contains("tx.tenantid = candidate.state_root_tenant_id OR "
                        + "left(tx.tenantid, length(candidate.state_root_tenant_id) + 1) "
                        + "= candidate.state_root_tenant_id || '.'"),
                "event tenants must match exact roots or ancestors at a dot boundary");
        assertTrue(sql.contains("s.tenantid = candidate.state_root_tenant_id OR "
                        + "left(s.tenantid, length(candidate.state_root_tenant_id) + 1) "
                        + "= candidate.state_root_tenant_id || '.'"),
                "fact tenants must match exact roots or ancestors at a dot boundary");
        assertTrue(sql.contains("ORDER BY array_length(string_to_array("
                        + "candidate.state_root_tenant_id, '.'), 1) DESC"),
                "a depth-two root such as ken.bomet must beat its ken ancestor");
        assertFalse(sql.contains("tz.state_root_tenant_id = split_part(tx.tenantid,'.',1)"));
        assertFalse(sql.contains("tz.state_root_tenant_id = split_part(s.tenantid,'.',1)"));
    }

    private int occurrences(String haystack, String needle) {
        int count = 0;
        for (int at = 0; (at = haystack.indexOf(needle, at)) >= 0; at += needle.length()) {
            count++;
        }
        return count;
    }
}
