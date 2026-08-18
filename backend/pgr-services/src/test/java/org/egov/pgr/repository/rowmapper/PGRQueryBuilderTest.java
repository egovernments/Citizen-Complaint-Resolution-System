package org.egov.pgr.repository.rowmapper;

import org.egov.pgr.config.PGRConfiguration;
import org.egov.pgr.policy.PgrSearchScope;
import org.egov.pgr.web.models.RequestSearchCriteria;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.when;

/**
 * Verifies the RBAC scope predicates added for the access-control policy reference rule
 * (citizen-self / employee-department / tenant search scoping) — that a null scope is fail-closed
 * (throws, rather than silently unrestricting), and that {@link PgrSearchScope#UNRESTRICTED} is
 * the only way to opt out, leaving the query byte-for-byte unaffected for plainSearch/legacy callers.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class PGRQueryBuilderTest {

    @Mock
    private PGRConfiguration config;

    private PGRQueryBuilder queryBuilder;

    @BeforeEach
    void setup() {
        when(config.getStateLevelTenantIdLength()).thenReturn(1);
        queryBuilder = new PGRQueryBuilder(config);
    }

    @Test
    void nullScopeThrowsRatherThanSilentlyUnrestricting() {
        RequestSearchCriteria criteria = RequestSearchCriteria.builder().tenantId("pg.city").build();
        List<Object> preparedStmtList = new ArrayList<>();

        assertThrows(IllegalStateException.class,
                () -> queryBuilder.getPGRSearchQuery(criteria, preparedStmtList, null, null));
    }

    @Test
    void unrestrictedSentinelAddsNoExtraPredicate() {
        RequestSearchCriteria criteria = RequestSearchCriteria.builder().tenantId("pg.city").build();
        List<Object> preparedStmtList = new ArrayList<>();

        String query = queryBuilder.getPGRSearchQuery(criteria, preparedStmtList, null, PgrSearchScope.UNRESTRICTED);

        assertFalse(query.contains("accountId"));
        assertFalse(query.contains("department"));
    }

    @Test
    void stateLevelScopeAddsTenantLikePredicate() {
        RequestSearchCriteria criteria = RequestSearchCriteria.builder().tenantId("pg").build();
        List<Object> preparedStmtList = new ArrayList<>();
        PgrSearchScope scope = new PgrSearchScope("pg", true, null, null, null);

        String query = queryBuilder.getPGRSearchQuery(criteria, preparedStmtList, null, scope);

        assertTrue(query.contains("ser.tenantId LIKE ?"));
        assertTrue(preparedStmtList.contains("pg%"));
    }

    @Test
    void cityLevelScopeAddsTenantEqualsPredicate() {
        RequestSearchCriteria criteria = RequestSearchCriteria.builder().tenantId("pg.city").build();
        List<Object> preparedStmtList = new ArrayList<>();
        PgrSearchScope scope = new PgrSearchScope("pg.city", false, null, null, null);

        String query = queryBuilder.getPGRSearchQuery(criteria, preparedStmtList, null, scope);

        assertTrue(query.contains("ser.tenantId = ?"));
        assertTrue(preparedStmtList.contains("pg.city"));
    }

    @Test
    void citizenScopeAddsAccountIdPredicate() {
        RequestSearchCriteria criteria = RequestSearchCriteria.builder().tenantId("pg.city").build();
        List<Object> preparedStmtList = new ArrayList<>();
        PgrSearchScope scope = new PgrSearchScope("pg.city", false, "citizen-1", null, null);

        String query = queryBuilder.getPGRSearchQuery(criteria, preparedStmtList, null, scope);

        assertTrue(query.contains("ser.accountId = ?"));
        assertTrue(preparedStmtList.contains("citizen-1"));
    }

    @Test
    void departmentScopeAddsInPredicate() {
        RequestSearchCriteria criteria = RequestSearchCriteria.builder().tenantId("pg.city").build();
        List<Object> preparedStmtList = new ArrayList<>();
        PgrSearchScope scope = new PgrSearchScope("pg.city", false, null, List.of("SANITATION", "ROADS"), null);

        String query = queryBuilder.getPGRSearchQuery(criteria, preparedStmtList, null, scope);

        assertTrue(query.contains("ser.additionaldetails->>'department' IN"));
        assertTrue(preparedStmtList.contains("SANITATION"));
        assertTrue(preparedStmtList.contains("ROADS"));
    }

    @Test
    void countQueryAppliesTheSameScope() {
        RequestSearchCriteria criteria = RequestSearchCriteria.builder().tenantId("pg.city").build();
        List<Object> preparedStmtList = new ArrayList<>();
        PgrSearchScope scope = new PgrSearchScope("pg.city", false, "citizen-1", null, null);

        String query = queryBuilder.getCountQuery(criteria, preparedStmtList, null, scope);

        assertTrue(query.contains("ser.accountId = ?"));
        assertEquals(1, preparedStmtList.stream().filter("citizen-1"::equals).count());
    }

    @Test
    void jurisdictionScopeAddsLocalityInPredicate() {
        RequestSearchCriteria criteria = RequestSearchCriteria.builder().tenantId("pg.city").build();
        List<Object> preparedStmtList = new ArrayList<>();
        PgrSearchScope scope = new PgrSearchScope("pg.city", false, null, List.of("SANITATION"), List.of("WARD_5", "WARD_6"));

        String query = queryBuilder.getPGRSearchQuery(criteria, preparedStmtList, null, scope);

        assertTrue(query.contains("ads.locality IN"));
        assertTrue(preparedStmtList.contains("WARD_5"));
        assertTrue(preparedStmtList.contains("WARD_6"));
    }

    @Test
    void nullJurisdictionCodesAddNoLocalityPredicate() {
        RequestSearchCriteria criteria = RequestSearchCriteria.builder().tenantId("pg.city").build();
        List<Object> preparedStmtList = new ArrayList<>();
        PgrSearchScope scope = new PgrSearchScope("pg.city", false, null, List.of("SANITATION"), null);

        String query = queryBuilder.getPGRSearchQuery(criteria, preparedStmtList, null, scope);

        assertFalse(query.contains("ads.locality IN"));
    }

    // A non-null EMPTY list means "this axis IS restricted and resolved to zero allowed values" —
    // distinct from null ("axis not restricted"). ScopePolicyEngine.resolve always hands back a
    // non-empty sentinel list instead today, but applyScope must independently deny-all here if
    // that contract ever regresses upstream, rather than silently dropping the axis and returning
    // unrestricted rows (#1441 review).
    @Test
    void emptyNonNullDepartmentCodesDenyAllRatherThanDroppingTheAxis() {
        RequestSearchCriteria criteria = RequestSearchCriteria.builder().tenantId("pg.city").build();
        List<Object> preparedStmtList = new ArrayList<>();
        PgrSearchScope scope = new PgrSearchScope("pg.city", false, null, List.of(), null);

        String query = queryBuilder.getPGRSearchQuery(criteria, preparedStmtList, null, scope);

        assertTrue(query.contains("1 = 0"));
        assertFalse(query.contains("ser.additionaldetails->>'department' IN"));
    }

    @Test
    void emptyNonNullJurisdictionCodesDenyAllRatherThanDroppingTheAxis() {
        RequestSearchCriteria criteria = RequestSearchCriteria.builder().tenantId("pg.city").build();
        List<Object> preparedStmtList = new ArrayList<>();
        PgrSearchScope scope = new PgrSearchScope("pg.city", false, null, null, List.of());

        String query = queryBuilder.getPGRSearchQuery(criteria, preparedStmtList, null, scope);

        assertTrue(query.contains("1 = 0"));
        assertFalse(query.contains("ads.locality IN"));
    }
}
