package org.egov.userpreference.config;

import com.zaxxer.hikari.HikariDataSource;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.TestPropertySource;

import javax.sql.DataSource;

import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * The Go service's pool variables, with the duration spellings they have
 * always carried. Hikari's own {@code max-lifetime} property binds to a
 * {@code long} of milliseconds and would reject "1h" outright, which is why
 * {@link DataSourceConfig} binds these to {@code Duration} instead: an
 * operator carrying their existing environment over from the Go image must not
 * get a boot failure for it.
 */
@SpringBootTest
@TestPropertySource(properties = {
        "DB_MAX_CONNS=7",
        "DB_MIN_CONNS=2",
        "DB_MAX_CONN_LIFETIME=1h",
        "DB_MAX_CONN_IDLE_TIME=30m"
})
class DataSourceConfigTest {

    @Autowired
    private DataSource dataSource;

    @Test
    void acceptsTheGoPoolSettingsVerbatim() {
        HikariDataSource pool = (HikariDataSource) dataSource;

        assertEquals(7, pool.getMaximumPoolSize());
        assertEquals(2, pool.getMinimumIdle());
        assertEquals(3_600_000L, pool.getMaxLifetime());
        assertEquals(1_800_000L, pool.getIdleTimeout());
    }
}
