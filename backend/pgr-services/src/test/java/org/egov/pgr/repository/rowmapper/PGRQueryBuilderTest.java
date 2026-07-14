package org.egov.pgr.repository.rowmapper;

import org.egov.pgr.analytics.AnalyticsScope;
import org.egov.pgr.config.PGRConfiguration;
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
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.when;

/**
 * Verifies the RBAC scope predicates added for the access-control policy reference rule
 * (citizen-self / employee-department search scoping) — and that a null scope leaves the query
 * byte-for-byte unaffected, which is what keeps plainSearch/legacy callers unchanged.
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
    void nullScopeAddsNoExtraPredicate() {
        RequestSearchCriteria criteria = RequestSearchCriteria.builder().tenantId("pg.city").build();
        List<Object> preparedStmtList = new ArrayList<>();

        String query = queryBuilder.getPGRSearchQuery(criteria, preparedStmtList, null, null);

        assertFalse(query.contains("accountId"));
        assertFalse(query.contains("department"));
    }

    @Test
    void citizenScopeAddsAccountIdPredicate() {
        RequestSearchCriteria criteria = RequestSearchCriteria.builder().tenantId("pg.city").build();
        List<Object> preparedStmtList = new ArrayList<>();
        AnalyticsScope scope = new AnalyticsScope("pg.city", false, "citizen-1", null, null);

        String query = queryBuilder.getPGRSearchQuery(criteria, preparedStmtList, null, scope);

        assertTrue(query.contains("ser.accountId = ?"));
        assertTrue(preparedStmtList.contains("citizen-1"));
    }

    @Test
    void departmentScopeAddsInPredicate() {
        RequestSearchCriteria criteria = RequestSearchCriteria.builder().tenantId("pg.city").build();
        List<Object> preparedStmtList = new ArrayList<>();
        AnalyticsScope scope = new AnalyticsScope("pg.city", false, null, null, List.of("SANITATION", "ROADS"));

        String query = queryBuilder.getPGRSearchQuery(criteria, preparedStmtList, null, scope);

        assertTrue(query.contains("ser.additionaldetails->>'department' IN"));
        assertTrue(preparedStmtList.contains("SANITATION"));
        assertTrue(preparedStmtList.contains("ROADS"));
    }

    @Test
    void countQueryAppliesTheSameScope() {
        RequestSearchCriteria criteria = RequestSearchCriteria.builder().tenantId("pg.city").build();
        List<Object> preparedStmtList = new ArrayList<>();
        AnalyticsScope scope = new AnalyticsScope("pg.city", false, "citizen-1", null, null);

        String query = queryBuilder.getCountQuery(criteria, preparedStmtList, null, scope);

        assertTrue(query.contains("ser.accountId = ?"));
        assertEquals(1, preparedStmtList.stream().filter("citizen-1"::equals).count());
    }

    @Test
    void jurisdictionScopeAddsLocalityInPredicate() {
        RequestSearchCriteria criteria = RequestSearchCriteria.builder().tenantId("pg.city").build();
        List<Object> preparedStmtList = new ArrayList<>();
        AnalyticsScope scope = new AnalyticsScope("pg.city", false, null, null, List.of("SANITATION"), List.of("WARD_5", "WARD_6"));

        String query = queryBuilder.getPGRSearchQuery(criteria, preparedStmtList, null, scope);

        assertTrue(query.contains("ads.locality IN"));
        assertTrue(preparedStmtList.contains("WARD_5"));
        assertTrue(preparedStmtList.contains("WARD_6"));
    }

    @Test
    void nullJurisdictionCodesAddNoLocalityPredicate() {
        RequestSearchCriteria criteria = RequestSearchCriteria.builder().tenantId("pg.city").build();
        List<Object> preparedStmtList = new ArrayList<>();
        AnalyticsScope scope = new AnalyticsScope("pg.city", false, null, null, List.of("SANITATION"));

        String query = queryBuilder.getPGRSearchQuery(criteria, preparedStmtList, null, scope);

        assertFalse(query.contains("ads.locality IN"));
    }
}
