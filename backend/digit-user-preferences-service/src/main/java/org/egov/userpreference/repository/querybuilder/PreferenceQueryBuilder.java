package org.egov.userpreference.repository.querybuilder;

import org.egov.userpreference.utils.QueryUtil;
import org.egov.userpreference.utils.StringUtil;
import org.egov.userpreference.web.model.PreferenceCriteria;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.util.List;

/**
 * Builds the SQL for every read and write against {@code user_preference}.
 *
 * <p>Two columns need an explicit cast from the bound string on PostgreSQL:
 * {@code id} is a {@code uuid} and {@code payload} is {@code jsonb}, and
 * neither accepts a {@code varchar} parameter. The tests run against H2, which
 * has no {@code jsonb} type and converts to {@code UUID} implicitly, so both
 * placeholders collapse to a plain {@code ?} there — the same driver switch
 * digit-config-service uses.
 *
 * <p>The {@code id} cast is not optional on PostgreSQL even though a statement
 * without it appears to work at first. pgjdbc sends parameters with an
 * unspecified type until a statement has run {@code prepareThreshold} times
 * (five by default), at which point it prepares it server-side and pins the
 * parameter to {@code varchar} — so the insert starts failing with
 * {@code column "id" is of type uuid but expression is of type character
 * varying} only after the sixth write. A smoke test of a handful of requests
 * would not reach it.
 */
@Component
public class PreferenceQueryBuilder {

    private static final String TABLE = "user_preference";

    private static final String BASE_SELECT =
            "SELECT id, user_id, tenant_id, preference_code, payload, "
                    + "created_by, created_time, last_modified_by, last_modified_time FROM " + TABLE;

    private static final String COUNT_SELECT = "SELECT COUNT(*) FROM " + TABLE;

    private final String idPlaceholder;
    private final String payloadPlaceholder;

    public PreferenceQueryBuilder(
            @Value("${spring.datasource.driver-class-name:org.postgresql.Driver}") String driverClassName) {
        boolean isPostgres = driverClassName.contains("postgresql");
        this.idPlaceholder = isPostgres ? "CAST(? AS uuid)" : "?";
        this.payloadPlaceholder = isPostgres ? "CAST(? AS jsonb)" : "?";
    }

    /**
     * Locates the single row a preference upserts onto.
     *
     * <p>A blank {@code tenantId} matches rows stored with either NULL or an
     * empty tenant. Both spellings exist in deployed databases: the Go
     * service's GORM model wrote {@code ''} for an absent tenant while the
     * column itself is nullable, and the unique index keys on
     * {@code COALESCE(tenant_id, '')} so the two collide by design.
     *
     * <p>{@code ORDER BY id} is not redundant. The unique index only exists on
     * databases created by the Flyway migration; one created by GORM's
     * AutoMigrate has no such index and can hold duplicates, and GORM's
     * {@code First} resolved that by taking the lowest primary key.
     */
    public String buildFindByKeyQuery(String userId, String tenantId, String preferenceCode, List<Object> params) {
        StringBuilder sql = new StringBuilder(BASE_SELECT);

        QueryUtil.addClauseIfRequired(sql, params);
        sql.append(" user_id = ?");
        params.add(userId);

        QueryUtil.addClauseIfRequired(sql, params);
        sql.append(" preference_code = ?");
        params.add(preferenceCode);

        QueryUtil.addClauseIfRequired(sql, params);
        if (StringUtil.isNotEmpty(tenantId)) {
            sql.append(" tenant_id = ?");
            params.add(tenantId);
        } else {
            sql.append(" (tenant_id IS NULL OR tenant_id = '')");
        }

        sql.append(" ORDER BY id LIMIT 1");
        return sql.toString();
    }

    public String buildFindByIdQuery(String id, List<Object> params) {
        StringBuilder sql = new StringBuilder(BASE_SELECT);
        QueryUtil.addClauseIfRequired(sql, params);
        sql.append(" id = ").append(idPlaceholder);
        params.add(id);
        sql.append(" ORDER BY id LIMIT 1");
        return sql.toString();
    }

    /** Newest first, so a tenant-wide listing pages from the most recent consent change. */
    public String buildSearchQuery(PreferenceCriteria criteria, List<Object> params) {
        StringBuilder sql = new StringBuilder(BASE_SELECT);
        buildWhereClause(criteria, sql, params);
        sql.append(" ORDER BY created_time DESC");
        sql.append(" LIMIT ? OFFSET ?");
        params.add(criteria.getLimit());
        params.add(criteria.getOffset());
        return sql.toString();
    }

    public String buildCountQuery(PreferenceCriteria criteria, List<Object> params) {
        StringBuilder sql = new StringBuilder(COUNT_SELECT);
        buildWhereClause(criteria, sql, params);
        return sql.toString();
    }

    public String buildInsertQuery() {
        return "INSERT INTO " + TABLE + " (id, user_id, tenant_id, preference_code, payload, "
                + "created_by, created_time, last_modified_by, last_modified_time) "
                + "VALUES (" + idPlaceholder + ", ?, ?, ?, " + payloadPlaceholder + ", ?, ?, ?, ?)";
    }

    /**
     * Only the payload and the modification audit move on an update — the
     * remaining columns are either the lookup key itself or the creation audit.
     */
    public String buildUpdateQuery() {
        return "UPDATE " + TABLE + " SET payload = " + payloadPlaceholder + ", "
                + "last_modified_by = ?, last_modified_time = ? WHERE id = " + idPlaceholder;
    }

    private void buildWhereClause(PreferenceCriteria criteria, StringBuilder sql, List<Object> params) {
        if (StringUtil.isNotEmpty(criteria.getUserId())) {
            QueryUtil.addClauseIfRequired(sql, params);
            sql.append(" user_id = ?");
            params.add(criteria.getUserId());
        }

        if (StringUtil.isNotEmpty(criteria.getTenantId())) {
            QueryUtil.addClauseIfRequired(sql, params);
            sql.append(" tenant_id = ?");
            params.add(criteria.getTenantId());
        }

        if (StringUtil.isNotEmpty(criteria.getPreferenceCode())) {
            QueryUtil.addClauseIfRequired(sql, params);
            sql.append(" preference_code = ?");
            params.add(criteria.getPreferenceCode());
        }
    }
}
