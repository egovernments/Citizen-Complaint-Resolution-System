package org.egov.pgr.repository.rowmapper;

import org.egov.common.contract.request.RequestInfo;
import org.egov.common.contract.request.Role;
import org.egov.common.contract.request.User;
import org.egov.pgr.config.PGRConfiguration;
import org.egov.pgr.policy.PgrSearchScope;
import org.egov.pgr.policy.PolicyDrivenScopeResolver;
import org.egov.pgr.util.Principals;
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
import java.util.regex.Pattern;

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
    void stateLevelScopeMatchesTheTenantAndItsSubtreeButNotASibling() {
        RequestSearchCriteria criteria = RequestSearchCriteria.builder().tenantId("pg").build();
        List<Object> preparedStmtList = new ArrayList<>();
        PgrSearchScope scope = new PgrSearchScope("pg", true, null, null, null);

        String query = queryBuilder.getPGRSearchQuery(criteria, preparedStmtList, null, scope);

        // `LIKE 'pg%'` alone also matches the unrelated tenant `pgx.city`; the delimiter has to
        // be in the pattern, and the tenant itself matched separately.
        assertTrue(query.contains("(ser.tenantId = ? OR ser.tenantId LIKE ?)"), query);
        assertTrue(preparedStmtList.contains("pg"));
        assertTrue(preparedStmtList.contains("pg.%"));
        assertFalse(preparedStmtList.contains("pg%"));
    }

    @Test
    void aSiblingRootIsNotInsideTheSubtree() {
        // The reachable case at state.level.tenantid.length=1: two ROOTS sharing a character
        // prefix. Root pg must not read root pgx. The scope comes from the real resolver, so the
        // test pins the state production produces (stateLevel=true for a one-segment id).
        PgrSearchScope scope = new PolicyDrivenScopeResolver(config, null, null, new Principals(), null, null)
                .resolve(citizen("pg"), "pg", 1, null);
        assertTrue(scope.tenantStateLevel);

        RequestSearchCriteria criteria = RequestSearchCriteria.builder().tenantId("pg").build();
        List<Object> preparedStmtList = new ArrayList<>();
        String query = queryBuilder.getPGRSearchQuery(criteria, preparedStmtList, null, scope);

        assertTrue(query.contains("(ser.tenantId = ? OR ser.tenantId LIKE ?)"), query);
        String pattern = (String) preparedStmtList.get(preparedStmtList.indexOf("pg") + 1);
        assertEquals("pg.%", pattern);
        assertTrue(likeMatches(pattern, "pg.city"));
        assertFalse(likeMatches(pattern, "pgx"), "a bare 'pg%' would also match root pgx");
        assertFalse(likeMatches(pattern, "pgx.city"));
    }

    private static RequestInfo citizen(String homeTenantId) {
        User user = new User();
        user.setUuid("citizen-1");
        user.setUserName("citizen-1");
        user.setType("CITIZEN");
        user.setTenantId(homeTenantId);
        user.setRoles(List.of(Role.builder().code("CITIZEN").build()));
        RequestInfo requestInfo = new RequestInfo();
        requestInfo.setUserInfo(user);
        return requestInfo;
    }

    /** PostgreSQL LIKE with the default backslash escape, enough to check a bound pattern. */
    private static boolean likeMatches(String pattern, String value) {
        StringBuilder regex = new StringBuilder();
        for (int i = 0; i < pattern.length(); i++) {
            char c = pattern.charAt(i);
            if (c == '\\' && i + 1 < pattern.length()) regex.append(Pattern.quote(String.valueOf(pattern.charAt(++i))));
            else if (c == '%') regex.append(".*");
            else if (c == '_') regex.append('.');
            else regex.append(Pattern.quote(String.valueOf(c)));
        }
        return value.matches(regex.toString());
    }

    @Test
    void likeMetacharactersInATenantIdAreEscaped() {
        // An unescaped '_' matches any single character, silently widening the subtree.
        RequestSearchCriteria criteria = RequestSearchCriteria.builder().tenantId("pg_a").build();
        List<Object> preparedStmtList = new ArrayList<>();
        PgrSearchScope scope = new PgrSearchScope("pg_a", true, null, null, null);

        queryBuilder.getPGRSearchQuery(criteria, preparedStmtList, null, scope);

        assertTrue(preparedStmtList.contains("pg\\_a.%"), preparedStmtList.toString());
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
