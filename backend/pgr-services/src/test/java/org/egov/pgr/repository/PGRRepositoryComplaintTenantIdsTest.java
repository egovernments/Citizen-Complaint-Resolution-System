package org.egov.pgr.repository;

import org.egov.pgr.util.PGRUtils;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.jdbc.core.JdbcTemplate;

import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** The escalation scheduler's database fallback for tenant discovery stays inside its own root. */
@ExtendWith(MockitoExtension.class)
class PGRRepositoryComplaintTenantIdsTest {

    @Mock
    private JdbcTemplate jdbcTemplate;

    @Mock
    private PGRUtils utils;

    @Test
    void stateTenantLookupEscapesLikeMetacharacters() {
        when(utils.replaceSchemaPlaceholder(anyString(), anyString())).thenAnswer(inv -> inv.getArgument(0));
        PGRRepository repository = new PGRRepository(null, null, null, jdbcTemplate, utils, null);

        repository.getComplaintTenantIds("ke_a");

        // Unescaped, 'ke_a.%' also matches keXa.city, so the scheduler would escalate another
        // root's complaints in its own run.
        verify(jdbcTemplate).queryForList(contains("tenantid = ? OR tenantid LIKE ?"), eq(String.class),
                eq("ke_a"), eq("ke\\_a.%"));
    }
}
