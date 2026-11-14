package org.egov.pgr.repository.rowmapper;

import org.egov.pgr.config.PGRConfiguration;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class DashboardQueryBuilderDepartmentMastersTest {

    @Mock
    private PGRConfiguration config;

    private DashboardQueryBuilder queryBuilder;

    @BeforeEach
    void setUp() {
        when(config.getStateLevelTenantIdLength()).thenReturn(1);
        queryBuilder = new DashboardQueryBuilder(config);
    }

    @Test
    void theDepartmentMastersAreReadFromTheTenantsOwnStateRoot() {
        // ke and kenya may both define STREETLIGHT with different departments; ke's breakdown
        // must use ke's mapping and names, for the state and for a city under it.
        for (String tenant : List.of("ke", "ke.bomet")) {
            List<Object> params = new ArrayList<>();

            String query = queryBuilder.getMvDepartmentQuery(tenant, params);

            String serviceDept = query.substring(query.indexOf("service_dept AS ("), query.indexOf("), dept_names AS ("));
            String deptNames = query.substring(query.indexOf("dept_names AS ("), query.indexOf("), filtered AS ("));
            assertTrue(serviceDept.contains("tenantid = ?"), serviceDept);
            assertTrue(deptNames.contains("tenantid = ?"), deptNames);
            // The two CTE binds come first, ahead of the complaint tenant filter.
            assertEquals(List.of("ke", "ke"), params.subList(0, 2), params.toString());
            assertEquals(query.chars().filter(c -> c == '?').count(), params.size(), query);
        }
    }
}
