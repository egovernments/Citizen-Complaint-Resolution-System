package org.egov.userpreference.config;

import com.zaxxer.hikari.HikariDataSource;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;

import javax.sql.DataSource;

import static org.junit.jupiter.api.Assertions.assertEquals;

/** A bare number on the same variables is read as milliseconds. */
@SpringBootTest
@ActiveProfiles("test")
@TestPropertySource(properties = {
        "DB_MAX_CONN_LIFETIME=600000",
        "DB_MAX_CONN_IDLE_TIME=60000"
})
class DataSourceConfigMillisTest {

    @Autowired
    private DataSource dataSource;

    @Test
    void acceptsPlainMilliseconds() {
        HikariDataSource pool = (HikariDataSource) dataSource;

        assertEquals(600_000L, pool.getMaxLifetime());
        assertEquals(60_000L, pool.getIdleTimeout());
    }
}
