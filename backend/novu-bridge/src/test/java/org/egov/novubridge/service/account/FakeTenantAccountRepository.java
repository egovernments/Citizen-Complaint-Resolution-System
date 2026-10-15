package org.egov.novubridge.service.account;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.TreeMap;

/**
 * {@link TenantAccountRepository} in memory, with the same WHERE clauses the SQL has (the lease
 * owner fences every write, and a write returns how many rows it changed). {@link #failFind} makes
 * reads throw, like a database outage; {@link #afterNextFind} runs once right after the next read,
 * to change the row behind the caller's back the way a concurrent request would.
 */
class FakeTenantAccountRepository extends TenantAccountRepository {

    final Map<String, Row> rows = new TreeMap<>();
    boolean failFind;
    Runnable afterNextFind;
    /** Every lease owner a claim was attempted with, in order. */
    final List<String> claims = new ArrayList<>();

    FakeTenantAccountRepository() {
        super(null);
    }

    @Override
    public Optional<Row> find(String tenantId) {
        if (failFind) {
            throw new IllegalStateException("database unavailable");
        }
        Optional<Row> read = Optional.ofNullable(rows.get(tenantId));
        Runnable hook = afterNextFind;
        if (hook != null) {
            afterNextFind = null;
            hook.run();
        }
        return read;
    }

    @Override
    public List<Row> list() {
        return new ArrayList<>(rows.values());
    }

    @Override
    public boolean claim(String tenantId, String owner, long now, long leaseUntil) {
        claims.add(owner);
        Row row = rows.get(tenantId);
        if (row == null) {
            rows.put(tenantId, Row.builder().tenantId(tenantId).status(PROVISIONING).leaseOwner(owner)
                    .leaseUntil(leaseUntil).createdTime(now).lastModifiedTime(now).build());
            return true;
        }
        if (row.leaseOwner() == null || row.leaseUntil() == null || row.leaseUntil() < now) {
            rows.put(tenantId, row.toBuilder().leaseOwner(owner).leaseUntil(leaseUntil).lastModifiedTime(now).build());
            return true;
        }
        return false;
    }

    @Override
    public void release(String tenantId, String owner, long now) {
        Row row = rows.get(tenantId);
        if (row != null && owner.equals(row.leaseOwner())) {
            rows.put(tenantId, row.toBuilder().leaseOwner(null).leaseUntil(null).lastModifiedTime(now).build());
        }
    }

    @Override
    public int recordOrganization(String tenantId, String owner, String organizationId, String organizationName,
                                  long now) {
        Row row = rows.get(tenantId);
        if (row == null || !owner.equals(row.leaseOwner())) {
            return 0;
        }
        rows.put(tenantId, row.toBuilder().organizationId(organizationId).organizationName(organizationName)
                .lastModifiedTime(now).build());
        return 1;
    }

    @Override
    public int markProvisioned(String tenantId, String owner, String environmentId, String environmentName,
                               String ciphertext, String keyId, int workflowsVersion, long now) {
        Row row = rows.get(tenantId);
        if (row == null || !owner.equals(row.leaseOwner())) {
            return 0;
        }
        rows.put(tenantId, row.toBuilder().status(PROVISIONED).environmentId(environmentId)
                .environmentName(environmentName).apiKeyCiphertext(ciphertext).apiKeyId(keyId)
                .workflowsVersion(workflowsVersion).lastErrorCode(null).lastErrorMessage(null).leaseOwner(null)
                .leaseUntil(null).provisionedTime(now).deprovisionedTime(null).lastModifiedTime(now).build());
        return 1;
    }

    @Override
    public int markFailed(String tenantId, String owner, String status, String code, String message, long now) {
        Row row = rows.get(tenantId);
        if (row == null || !owner.equals(row.leaseOwner())) {
            return 0;
        }
        rows.put(tenantId, row.toBuilder().status(status).lastErrorCode(code).lastErrorMessage(message)
                .leaseOwner(null).leaseUntil(null).lastModifiedTime(now).build());
        return 1;
    }

    @Override
    public int markDeprovisioning(String tenantId, String owner, long now) {
        Row row = rows.get(tenantId);
        if (row == null || !owner.equals(row.leaseOwner())) {
            return 0;
        }
        rows.put(tenantId, row.toBuilder().status(DEPROVISIONING).apiKeyCiphertext(null).apiKeyId(null)
                .workflowsVersion(0).lastErrorCode(null).lastErrorMessage(null).lastModifiedTime(now).build());
        return 1;
    }

    @Override
    public int markDeprovisioned(String tenantId, String owner, long now) {
        Row row = rows.get(tenantId);
        if (row == null || !owner.equals(row.leaseOwner())) {
            return 0;
        }
        rows.put(tenantId, row.toBuilder().status(DEPROVISIONED).apiKeyCiphertext(null).apiKeyId(null)
                .workflowsVersion(0).lastErrorCode(null).lastErrorMessage(null).leaseOwner(null).leaseUntil(null)
                .deprovisionedTime(now).lastModifiedTime(now).build());
        return 1;
    }
}
