package org.egov.pgr.service;

import com.zaxxer.hikari.HikariDataSource;
import jakarta.annotation.PreDestroy;
import lombok.extern.slf4j.Slf4j;
import org.egov.pgr.config.PGRConfiguration;
import org.egov.tracer.model.CustomException;
import org.springframework.boot.autoconfigure.jdbc.DataSourceProperties;
import org.springframework.stereotype.Component;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.function.Supplier;

/**
 * Cross-replica serialization for one complaint's ESCALATE operation.
 *
 * <p>The advisory lock is transaction-scoped on a dedicated connection. Keeping that
 * connection inside an explicit transaction is required when the datasource points at
 * PgBouncer in transaction-pooling mode: separate auto-commit statements are otherwise
 * free to use different PostgreSQL sessions, leaking session-scoped locks. The business
 * update still uses its normal datasource/transaction; this private transaction exists
 * only to pin and release the cross-replica lock.</p>
 */
@Component
@Slf4j
public class EscalationLockManager {

    private static final String TRY_LOCK = "SELECT pg_try_advisory_xact_lock(hashtextextended(?, 0))";

    private final HikariDataSource lockDataSource;

    public EscalationLockManager(DataSourceProperties dataSourceProperties, PGRConfiguration config) {
        lockDataSource = dataSourceProperties.initializeDataSourceBuilder()
                .type(HikariDataSource.class)
                .build();
        lockDataSource.setPoolName("pgr-escalation-locks");
        Integer configuredPoolSize = config.getEscalationLockPoolSize();
        Long configuredTimeout = config.getEscalationLockConnectionTimeoutMs();
        lockDataSource.setMaximumPoolSize(Math.max(1,
                configuredPoolSize == null ? 4 : configuredPoolSize));
        lockDataSource.setMinimumIdle(0);
        lockDataSource.setConnectionTimeout(Math.max(250L,
                configuredTimeout == null ? 30_000L : configuredTimeout));
    }

    public <T> T withComplaintLock(String tenantId, String complaintId, Supplier<T> operation) {
        if (tenantId == null || tenantId.isBlank()
                || complaintId == null || complaintId.isBlank()) {
            throw new CustomException("INVALID_ESCALATION_ID",
                    "tenantId and complaint id are required for ESCALATE");
        }

        String normalizedTenant = tenantId.trim();
        String normalizedComplaintId = complaintId.trim();
        // PostgreSQL text cannot contain NUL. Length-prefix both identifiers so
        // different tenant/request splits cannot produce the same source string.
        String lockKey = normalizedTenant.length() + ":" + normalizedTenant
                + normalizedComplaintId.length() + ":" + normalizedComplaintId;
        try (Connection connection = lockDataSource.getConnection()) {
            // Pins one PostgreSQL backend for the lifetime of the advisory lock even
            // when the JDBC URL fronts PgBouncer in transaction-pooling mode.
            connection.setAutoCommit(false);
            if (!executeBoolean(connection, TRY_LOCK, lockKey)) {
                connection.rollback();
                throw new CustomException("ESCALATION_IN_PROGRESS",
                        "Another escalation for complaint " + complaintId + " is still being persisted");
            }

            try {
                T result = operation.get();
                connection.commit();
                return result;
            } catch (RuntimeException | Error e) {
                rollback(connection, complaintId);
                throw e;
            } catch (SQLException e) {
                rollback(connection, complaintId);
                throw e;
            }
        } catch (CustomException e) {
            throw e;
        } catch (SQLException e) {
            log.error("Could not acquire the escalation lock for complaint {}", complaintId, e);
            throw new CustomException("ESCALATION_LOCK_UNAVAILABLE",
                    "Escalation locking is temporarily unavailable for complaint " + complaintId);
        }
    }

    private void rollback(Connection connection, String serviceRequestId) {
        try {
            connection.rollback();
        } catch (SQLException e) {
            // Closing an evicted connection also ends the transaction and releases the
            // xact lock. Never return a connection with an uncertain transaction state.
            lockDataSource.evictConnection(connection);
            log.error("Could not roll back the escalation lock transaction for complaint {}; evicted its connection",
                    serviceRequestId, e);
        }
    }

    private static boolean executeBoolean(Connection connection, String sql, String lockKey)
            throws SQLException {
        try (PreparedStatement statement = connection.prepareStatement(sql)) {
            statement.setString(1, lockKey);
            try (ResultSet result = statement.executeQuery()) {
                return result.next() && result.getBoolean(1);
            }
        }
    }

    @PreDestroy
    public void close() {
        lockDataSource.close();
    }
}
