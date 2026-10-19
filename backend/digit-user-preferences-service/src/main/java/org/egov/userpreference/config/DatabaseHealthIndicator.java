package org.egov.userpreference.config;

import lombok.RequiredArgsConstructor;
import org.egov.userpreference.repository.PreferenceRepository;
import org.springframework.boot.actuate.health.Health;
import org.springframework.boot.actuate.health.HealthIndicator;
import org.springframework.stereotype.Component;

/**
 * Reports database reachability as the {@code database} component of
 * {@code /health}.
 *
 * <p>The bean name is the component key, and it is {@code database} rather
 * than actuator's built-in {@code db} because that is the name the Go service
 * published and anything asserting on {@code components.database.status}
 * still expects. The built-in indicator is disabled in
 * {@code application.properties} so the two do not both appear.
 *
 * <p>The check is the repository's own {@code SELECT 1} rather than
 * {@code DataSourceHealthIndicator}, so liveness reflects a query the service
 * can actually run.
 */
@Component("database")
@RequiredArgsConstructor
public class DatabaseHealthIndicator implements HealthIndicator {

    private final PreferenceRepository preferenceRepository;

    @Override
    public Health health() {
        return preferenceRepository.isReachable() ? Health.up().build() : Health.down().build();
    }
}
