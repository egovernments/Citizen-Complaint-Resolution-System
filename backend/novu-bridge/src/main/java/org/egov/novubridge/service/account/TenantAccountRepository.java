package org.egov.novubridge.service.account;

import lombok.Builder;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

/**
 * {@code nb_tenant_account}: parameterized SQL only. The provisioning claim is a row-level
 * lease so two bridge replicas (or a retry racing a slow first attempt) never work on the same
 * tenant at once: the second caller sees {@code PROVISIONING} and backs off.
 */
@Repository
public class TenantAccountRepository {

    public static final String PROVISIONING = "PROVISIONING";
    public static final String PROVISIONED = "PROVISIONED";
    public static final String FAILED = "FAILED";
    public static final String DEPROVISIONED = "DEPROVISIONED";

    @Builder(toBuilder = true)
    public record Row(String tenantId, String status, String organizationId, String organizationName,
                      String environmentId, String environmentName, String apiKeyCiphertext, String apiKeyId,
                      int workflowsVersion, String lastErrorCode, String lastErrorMessage, String leaseOwner,
                      Long leaseUntil, Long provisionedTime, Long deprovisionedTime, long createdTime,
                      long lastModifiedTime) {

        public boolean provisioned() {
            return PROVISIONED.equals(status);
        }
    }

    private static final String COLUMNS = "tenant_id, status, novu_organization_id, novu_organization_name, "
            + "novu_environment_id, novu_environment_name, api_key_ciphertext, api_key_id, workflows_version, "
            + "last_error_code, last_error_message, lease_owner, lease_until, provisioned_time, "
            + "deprovisioned_time, created_time, last_modified_time";

    private static final RowMapper<Row> MAPPER = (rs, n) -> new Row(
            rs.getString("tenant_id"), rs.getString("status"), rs.getString("novu_organization_id"),
            rs.getString("novu_organization_name"), rs.getString("novu_environment_id"),
            rs.getString("novu_environment_name"), rs.getString("api_key_ciphertext"), rs.getString("api_key_id"),
            rs.getInt("workflows_version"), rs.getString("last_error_code"), rs.getString("last_error_message"),
            rs.getString("lease_owner"), (Long) rs.getObject("lease_until"), (Long) rs.getObject("provisioned_time"),
            (Long) rs.getObject("deprovisioned_time"), rs.getLong("created_time"), rs.getLong("last_modified_time"));

    private final JdbcTemplate jdbc;

    public TenantAccountRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public Optional<Row> find(String tenantId) {
        List<Row> rows = jdbc.query("SELECT " + COLUMNS + " FROM nb_tenant_account WHERE tenant_id = ?", MAPPER, tenantId);
        return rows.isEmpty() ? Optional.empty() : Optional.of(rows.get(0));
    }

    public List<Row> list() {
        return jdbc.query("SELECT " + COLUMNS + " FROM nb_tenant_account ORDER BY tenant_id", MAPPER);
    }

    /**
     * Takes the provisioning lease: inserts a PROVISIONING row, or leases an existing row when
     * nobody else holds a live lease. An existing row keeps its status while leased, so a tenant
     * being re-ensured stays PROVISIONED and its messages keep flowing. False = someone else holds it.
     */
    public boolean claim(String tenantId, String owner, long now, long leaseUntil) {
        int inserted = jdbc.update("INSERT INTO nb_tenant_account (tenant_id, status, lease_owner, lease_until, "
                        + "created_time, last_modified_time) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (tenant_id) DO NOTHING",
                tenantId, PROVISIONING, owner, leaseUntil, now, now);
        if (inserted == 1) {
            return true;
        }
        int updated = jdbc.update("UPDATE nb_tenant_account SET lease_owner = ?, lease_until = ?, last_modified_time = ? "
                        + "WHERE tenant_id = ? AND (lease_owner IS NULL OR lease_until IS NULL OR lease_until < ? OR lease_owner = ?)",
                owner, leaseUntil, now, tenantId, now, owner);
        return updated == 1;
    }

    /** Drops the lease without touching anything else. */
    public void release(String tenantId, String owner, long now) {
        jdbc.update("UPDATE nb_tenant_account SET lease_owner = NULL, lease_until = NULL, last_modified_time = ? "
                + "WHERE tenant_id = ? AND lease_owner = ?", now, tenantId, owner);
    }

    /** The organization exists in Novu: written before any further call so a retry adopts it. */
    public void recordOrganization(String tenantId, String organizationId, String organizationName, long now) {
        jdbc.update("UPDATE nb_tenant_account SET novu_organization_id = ?, novu_organization_name = ?, "
                + "last_modified_time = ? WHERE tenant_id = ?", organizationId, organizationName, now, tenantId);
    }

    public void markProvisioned(String tenantId, String owner, String environmentId, String environmentName,
                                String ciphertext, String keyId, int workflowsVersion, long now) {
        jdbc.update("UPDATE nb_tenant_account SET status = ?, novu_environment_id = ?, novu_environment_name = ?, "
                        + "api_key_ciphertext = ?, api_key_id = ?, workflows_version = ?, last_error_code = NULL, "
                        + "last_error_message = NULL, lease_owner = NULL, lease_until = NULL, provisioned_time = ?, "
                        + "deprovisioned_time = NULL, last_modified_time = ? WHERE tenant_id = ? AND lease_owner = ?",
                PROVISIONED, environmentId, environmentName, ciphertext, keyId, workflowsVersion, now, now, tenantId, owner);
    }

    /** A failed re-ensure on a PROVISIONED tenant keeps it PROVISIONED: its key still works. */
    public void markFailed(String tenantId, String owner, String status, String code, String message, long now) {
        jdbc.update("UPDATE nb_tenant_account SET status = ?, last_error_code = ?, last_error_message = ?, "
                        + "lease_owner = NULL, lease_until = NULL, last_modified_time = ? WHERE tenant_id = ? AND lease_owner = ?",
                status, code, message, now, tenantId, owner);
    }

    public void markDeprovisioned(String tenantId, String owner, long now) {
        jdbc.update("UPDATE nb_tenant_account SET status = ?, api_key_ciphertext = NULL, api_key_id = NULL, "
                        + "workflows_version = 0, last_error_code = NULL, last_error_message = NULL, lease_owner = NULL, "
                        + "lease_until = NULL, deprovisioned_time = ?, last_modified_time = ? WHERE tenant_id = ? AND lease_owner = ?",
                DEPROVISIONED, now, now, tenantId, owner);
    }
}
