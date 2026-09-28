package org.egov.userpreference.repository.querybuilder;

import org.egov.userpreference.web.model.PreferenceCriteria;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class PreferenceQueryBuilderTest {

    private final PreferenceQueryBuilder queryBuilder = new PreferenceQueryBuilder("org.postgresql.Driver");
    private final PreferenceQueryBuilder h2QueryBuilder = new PreferenceQueryBuilder("org.h2.Driver");

    @Test
    void matchesTheTenantColumnWhenATenantIsGiven() {
        List<Object> params = new ArrayList<>();
        String sql = queryBuilder.buildFindByKeyQuery("u1", "pg.citya", "CODE", params);

        assertTrue(sql.contains("WHERE  user_id = ? AND  preference_code = ? AND  tenant_id = ?"), sql);
        assertTrue(sql.endsWith("ORDER BY id LIMIT 1"), sql);
        assertEquals(List.of("u1", "CODE", "pg.citya"), params);
    }

    @Test
    void matchesBothSpellingsOfAnAbsentTenant() {
        // Rows written by the Go service carry '' for a global preference
        // while the column itself is nullable, so the lookup has to accept
        // either. Only two parameters bind: the predicate is literal.
        for (String blank : new String[]{"", null}) {
            List<Object> params = new ArrayList<>();
            String sql = queryBuilder.buildFindByKeyQuery("u1", blank, "CODE", params);

            assertTrue(sql.contains("(tenant_id IS NULL OR tenant_id = '')"), sql);
            assertEquals(List.of("u1", "CODE"), params);
        }
    }

    @Test
    void ordersByIdSoADuplicateKeyResolvesTheSameWayGormDid() {
        // A database created by GORM's AutoMigrate has no unique index and can
        // hold duplicates; GORM's First() took the lowest primary key.
        String sql = queryBuilder.buildFindByKeyQuery("u1", "pg", "CODE", new ArrayList<>());
        assertTrue(sql.contains("ORDER BY id LIMIT 1"), sql);
    }

    @Test
    void filtersOnEveryCriterionSupplied() {
        List<Object> params = new ArrayList<>();
        String sql = queryBuilder.buildSearchQuery(PreferenceCriteria.builder()
                .userId("u1")
                .tenantId("pg.citya")
                .preferenceCode("CODE")
                .limit(25)
                .offset(50)
                .build(), params);

        assertTrue(sql.contains("user_id = ?"), sql);
        assertTrue(sql.contains("tenant_id = ?"), sql);
        assertTrue(sql.contains("preference_code = ?"), sql);
        assertTrue(sql.contains("ORDER BY created_time DESC LIMIT ? OFFSET ?"), sql);
        assertEquals(List.of("u1", "pg.citya", "CODE", 25, 50), params);
    }

    @Test
    void omitsTheCriteriaThatAreNotSupplied() {
        List<Object> params = new ArrayList<>();
        String sql = queryBuilder.buildSearchQuery(PreferenceCriteria.builder()
                .userId("u1")
                .limit(10)
                .offset(0)
                .build(), params);

        assertTrue(sql.contains("WHERE  user_id = ?"), sql);
        assertFalse(sql.contains("tenant_id = ?"), sql);
        assertFalse(sql.contains("preference_code = ?"), sql);
        assertEquals(List.of("u1", 10, 0), params);
    }

    @Test
    void treatsAnEmptyStringCriterionAsAbsent() {
        List<Object> params = new ArrayList<>();
        String sql = queryBuilder.buildSearchQuery(PreferenceCriteria.builder()
                .userId("u1")
                .tenantId("")
                .limit(10)
                .offset(0)
                .build(), params);

        assertFalse(sql.contains("tenant_id = ?"), sql);
        assertEquals(List.of("u1", 10, 0), params);
    }

    @Test
    void countsWithTheSameFiltersButNoPaging() {
        List<Object> params = new ArrayList<>();
        String sql = queryBuilder.buildCountQuery(PreferenceCriteria.builder()
                .tenantId("pg.citya")
                .limit(10)
                .offset(0)
                .build(), params);

        assertTrue(sql.startsWith("SELECT COUNT(*) FROM user_preference"), sql);
        assertTrue(sql.contains("tenant_id = ?"), sql);
        assertFalse(sql.contains("LIMIT"), sql);
        assertEquals(List.of("pg.citya"), params);
    }

    @Test
    void countsEveryRowWhenNoFilterApplies() {
        List<Object> params = new ArrayList<>();
        String sql = queryBuilder.buildCountQuery(PreferenceCriteria.builder().build(), params);

        assertEquals("SELECT COUNT(*) FROM user_preference", sql);
        assertTrue(params.isEmpty());
    }

    @Test
    void castsTheUuidAndJsonbColumnsOnPostgres() {
        // Without the uuid cast the insert succeeds until pgjdbc prepares the
        // statement server-side on its sixth execution, and fails from then
        // on. Both casts are asserted so neither can be dropped quietly.
        assertEquals("INSERT INTO user_preference (id, user_id, tenant_id, preference_code, payload, "
                        + "created_by, created_time, last_modified_by, last_modified_time) "
                        + "VALUES (CAST(? AS uuid), ?, ?, ?, CAST(? AS jsonb), ?, ?, ?, ?)",
                queryBuilder.buildInsertQuery());

        assertEquals("UPDATE user_preference SET payload = CAST(? AS jsonb), "
                        + "last_modified_by = ?, last_modified_time = ? WHERE id = CAST(? AS uuid)",
                queryBuilder.buildUpdateQuery());

        assertTrue(queryBuilder.buildFindByIdQuery("id", new ArrayList<>())
                .contains("id = CAST(? AS uuid)"));
    }

    @Test
    void bindsPlainParametersOnH2WhichHasNeitherType() {
        assertTrue(h2QueryBuilder.buildInsertQuery().contains("VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"),
                h2QueryBuilder.buildInsertQuery());
        assertTrue(h2QueryBuilder.buildUpdateQuery().contains("payload = ?"),
                h2QueryBuilder.buildUpdateQuery());
        assertTrue(h2QueryBuilder.buildUpdateQuery().endsWith("WHERE id = ?"),
                h2QueryBuilder.buildUpdateQuery());
        assertTrue(h2QueryBuilder.buildFindByIdQuery("id", new ArrayList<>()).contains("id = ? ORDER BY"),
                h2QueryBuilder.buildFindByIdQuery("id", new ArrayList<>()));
    }

    @Test
    void movesOnlyThePayloadAndModificationAuditOnUpdate() {
        String sql = h2QueryBuilder.buildUpdateQuery();

        assertTrue(sql.contains("last_modified_by = ?"), sql);
        assertTrue(sql.contains("last_modified_time = ?"), sql);
        assertTrue(sql.contains("WHERE id = ?"), sql);
        assertFalse(sql.contains("created_by"), sql);
        assertFalse(sql.contains("created_time"), sql);
        assertFalse(sql.contains("user_id"), sql);
    }
}
