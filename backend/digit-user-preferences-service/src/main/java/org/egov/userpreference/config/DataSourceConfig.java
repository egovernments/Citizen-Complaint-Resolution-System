package org.egov.userpreference.config;

import com.zaxxer.hikari.HikariDataSource;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.jdbc.DataSourceProperties;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Primary;

import java.time.Duration;

/**
 * Connection pool, sized from the Go service's own environment variables.
 *
 * <p>The pool is built here rather than left entirely to Boot's
 * autoconfiguration because {@code DB_MAX_CONN_LIFETIME} and
 * {@code DB_MAX_CONN_IDLE_TIME} carry Go duration strings such as {@code 1h}
 * and {@code 30m}. Hikari's own {@code max-lifetime} / {@code idle-timeout}
 * properties bind to a {@code long} of milliseconds and reject those outright,
 * so pointing them straight at the variables would turn a value that is
 * perfectly valid on the image being replaced into a startup failure. Binding
 * to {@link Duration} instead accepts the Go spellings and plain milliseconds
 * alike.
 *
 * <p>{@code @ConfigurationProperties} is still applied on top, so an operator
 * who prefers the Spring-native {@code spring.datasource.hikari.*} keys can
 * override any of this in the usual way.
 *
 * <p>The four knobs are read through {@code user.preference.db.*}, declared in
 * {@code application.properties} as {@code ${DB_…:default}} like every other
 * setting, rather than as bare environment keys with their defaults buried
 * here. Same values, but an operator finds them where they look for them.
 */
@Configuration
@Slf4j
public class DataSourceConfig {

    @Value("${user.preference.db.max-conns}")
    private int maxConnections;

    @Value("${user.preference.db.min-conns}")
    private int minConnections;

    @Value("${user.preference.db.max-conn-lifetime}")
    private Duration maxConnectionLifetime;

    @Value("${user.preference.db.max-conn-idle-time}")
    private Duration maxConnectionIdleTime;

    @Bean
    @Primary
    @ConfigurationProperties("spring.datasource.hikari")
    public HikariDataSource dataSource(DataSourceProperties dataSourceProperties) {
        HikariDataSource dataSource = dataSourceProperties
                .initializeDataSourceBuilder()
                .type(HikariDataSource.class)
                .build();

        dataSource.setMaximumPoolSize(maxConnections);
        dataSource.setMinimumIdle(minConnections);
        dataSource.setMaxLifetime(maxConnectionLifetime.toMillis());
        dataSource.setIdleTimeout(maxConnectionIdleTime.toMillis());

        log.info("Connection pool configured: maxConnections={}, minIdle={}, maxLifetime={}, idleTimeout={}",
                maxConnections, minConnections, maxConnectionLifetime, maxConnectionIdleTime);

        return dataSource;
    }
}
