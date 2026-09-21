package org.egov.novubridge.repository;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.invocation.Invocation;
import org.springframework.jdbc.core.JdbcTemplate;

import java.util.Arrays;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.mockingDetails;

/**
 * Complaints are raised at city level, so an operator signed in at the state tenant read an
 * empty log as "nothing was sent". A state tenant now sees its cities; a city sees itself.
 */
class DispatchLogRepositoryTenantScopeTest {

    private JdbcTemplate jdbcTemplate;
    private DispatchLogRepository repository;

    @BeforeEach
    void setUp() {
        jdbcTemplate = mock(JdbcTemplate.class);
        repository = new DispatchLogRepository(jdbcTemplate, new ObjectMapper(), mock(NovuBridgeConfiguration.class));
    }

    private Invocation invocation(String method) {
        return mockingDetails(jdbcTemplate).getInvocations().stream()
                .filter(i -> method.equals(i.getMethod().getName()))
                .findFirst()
                .orElseThrow(() -> new AssertionError("jdbcTemplate." + method + " was not invoked"));
    }

    /** Mockito expands the varargs, so the binds follow (sql, rowMapper | requiredType). */
    private static List<Object> binds(Invocation invocation) {
        Object[] all = invocation.getArguments();
        return Arrays.asList(all).subList(2, all.length);
    }

    @Test
    @DisplayName("a state tenant lists its own rows and its cities', by bind parameter")
    void aStateTenantSeesItsCities() {
        repository.list("mz", null, false, null, null, null, null, false, 50, 0);

        Invocation query = invocation("query");
        String sql = String.valueOf(query.getArguments()[0]);
        assertTrue(sql.contains("(tenant_id = ? OR tenant_id LIKE ? ESCAPE '\\')"), sql);
        assertEquals(List.of("mz", "mz.%"), binds(query).subList(0, 2));
    }

    @Test
    @DisplayName("the dot is part of the pattern: mz must not match mzx or its cities")
    void aSiblingStateIsNotMatched() {
        repository.list("mz", null, false, null, null, null, null, false, 50, 0);

        assertFalse(binds(invocation("query")).contains("mz%"));
    }

    @Test
    @DisplayName("a city tenant matches only itself")
    void aCityTenantSeesOnlyItself() {
        repository.list("mz.maputo", null, false, null, null, null, null, false, 50, 0);

        Invocation query = invocation("query");
        String sql = String.valueOf(query.getArguments()[0]);
        assertTrue(sql.contains("WHERE tenant_id = ?"), sql);
        assertFalse(sql.contains("LIKE"), sql);
        assertEquals("mz.maputo", binds(query).get(0));
    }

    @Test
    @DisplayName("LIKE wildcards in a tenant id are escaped, not interpreted")
    void wildcardsInTheTenantAreEscaped() {
        repository.list("m_z%", null, false, null, null, null, null, false, 50, 0);

        assertEquals("m\\_z\\%.%", binds(invocation("query")).get(1));
    }

    @Test
    @DisplayName("count pages the same set list returns")
    void countUsesTheSameScope() {
        repository.count("mz", null, false, null, null, null, null, false);

        Invocation count = invocation("queryForObject");
        assertTrue(String.valueOf(count.getArguments()[0]).contains("tenant_id LIKE ?"));
        assertTrue(binds(count).contains("mz.%"));
    }
}
