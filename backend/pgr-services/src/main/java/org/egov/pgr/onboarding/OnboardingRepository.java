package org.egov.pgr.onboarding;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.egov.tracer.model.CustomException;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.Collections;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public class OnboardingRepository {

    // Explicit columns: through pgbouncer a cached star-select plan fails with
    // "cached plan must not change result type" once a migration adds columns.
    private static final String SIGNUP_COLUMNS = "id, owner_issuer, owner_subject, status, account_name, " +
            "account_code, organization_alias, requested_tenant_id, url_slug, country_code, languages, time_zone, " +
            "financial_year_policy, accepted_terms_version, tenant_metadata, version, created_at, updated_at";
    private static final String OPERATION_COLUMNS = "id, signup_id, status, current_step, completed_steps, " +
            "error_code, error_message, attempt, created_at, updated_at";

    private final JdbcTemplate jdbcTemplate;
    private final ObjectMapper objectMapper;

    public OnboardingRepository(JdbcTemplate jdbcTemplate, ObjectMapper objectMapper) {
        this.jdbcTemplate = jdbcTemplate;
        this.objectMapper = objectMapper;
    }

    public Optional<OnboardingSignup> findSignupByOwner(String issuer, String subject) {
        return first(jdbcTemplate.query(
                "SELECT " + SIGNUP_COLUMNS + " FROM eg_pgr_onboarding_signup WHERE owner_issuer = ? AND owner_subject = ?",
                signupMapper(), issuer, subject));
    }

    public Optional<OnboardingSignup> findOwnedSignup(UUID id, String issuer, String subject) {
        return first(jdbcTemplate.query(
                "SELECT " + SIGNUP_COLUMNS + " FROM eg_pgr_onboarding_signup WHERE id = ? AND owner_issuer = ? AND owner_subject = ?",
                signupMapper(), id, issuer, subject));
    }

    public Optional<OnboardingSignup> findOwnedSignupForUpdate(UUID id, String issuer, String subject) {
        return first(jdbcTemplate.query(
                "SELECT " + SIGNUP_COLUMNS + " FROM eg_pgr_onboarding_signup WHERE id = ? AND owner_issuer = ? " +
                        "AND owner_subject = ? FOR UPDATE",
                signupMapper(), id, issuer, subject));
    }

    public OnboardingSignup insertSignup(OnboardingSignup signup, String idempotencyKey) {
        jdbcTemplate.update("INSERT INTO eg_pgr_onboarding_signup " +
                        "(id, owner_issuer, owner_subject, status, account_name, account_code, organization_alias, " +
                        "requested_tenant_id, url_slug, country_code, languages, time_zone, financial_year_policy, " +
                        "accepted_terms_version, tenant_metadata, idempotency_key, version, created_at, updated_at) " +
                        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb, ?, ?, ?, ?::jsonb, ?, ?, ?, ?)",
                signup.getId(), signup.getOwnerIssuer(), signup.getOwnerSubject(), signup.getStatus(),
                signup.getAccountName(), signup.getAccountCode(), signup.getOrganizationAlias(),
                signup.getRequestedTenantId(), signup.getUrlSlug(), signup.getCountryCode(),
                json(signup.getLanguages()), signup.getTimeZone(), signup.getFinancialYearPolicy(),
                signup.getAcceptedTermsVersion(), json(signup.getTenantMetadata()), idempotencyKey, signup.getVersion(),
                signup.getCreatedAt(), signup.getUpdatedAt());
        return signup;
    }

    public OnboardingSignup updateSignup(OnboardingSignup signup) {
        int changed = jdbcTemplate.update("UPDATE eg_pgr_onboarding_signup SET account_name = ?, account_code = ?, " +
                        "organization_alias = ?, requested_tenant_id = ?, url_slug = ?, country_code = ?, " +
                        "languages = ?::jsonb, time_zone = ?, financial_year_policy = ?, accepted_terms_version = ?, " +
                        "tenant_metadata = ?::jsonb, version = version + 1, updated_at = ? " +
                        "WHERE id = ? AND status = 'DRAFT' AND version = ?",
                signup.getAccountName(), signup.getAccountCode(), signup.getOrganizationAlias(),
                signup.getRequestedTenantId(), signup.getUrlSlug(), signup.getCountryCode(),
                json(signup.getLanguages()), signup.getTimeZone(), signup.getFinancialYearPolicy(),
                signup.getAcceptedTermsVersion(), json(signup.getTenantMetadata()), signup.getUpdatedAt(),
                signup.getId(), signup.getVersion());
        if (changed != 1) {
            throw new CustomException("ONBOARDING_DRAFT_CONFLICT", "The signup draft changed; reload and retry");
        }
        signup.setVersion(signup.getVersion() + 1);
        return signup;
    }

    public boolean identifierAvailable(String type, String value, UUID signupId) {
        Integer count = jdbcTemplate.queryForObject(
                "SELECT count(*) FROM eg_pgr_onboarding_identifier " +
                        "WHERE identifier_type = ? AND normalized_value = ? AND status <> 'RELEASED' AND signup_id <> ?",
                Integer.class, type, value, signupId == null ? new UUID(0, 0) : signupId);
        return count == null || count == 0;
    }

    public void reserveIdentifier(String type, String value, UUID signupId, long now) {
        try {
            int changed = jdbcTemplate.update("INSERT INTO eg_pgr_onboarding_identifier " +
                            "(identifier_type, normalized_value, signup_id, status, reserved_at) " +
                            "VALUES (?, ?, ?, 'RESERVED', ?) " +
                            "ON CONFLICT (identifier_type, normalized_value) DO UPDATE SET status = 'RESERVED' " +
                            "WHERE eg_pgr_onboarding_identifier.signup_id = EXCLUDED.signup_id",
                    type, value, signupId, now);
            if (changed != 1) {
                throw new CustomException("ONBOARDING_IDENTIFIER_TAKEN", type + " is already reserved");
            }
        } catch (DuplicateKeyException exception) {
            throw new CustomException("ONBOARDING_IDENTIFIER_TAKEN", type + " is already reserved");
        }
    }

    public OnboardingOperation submit(OnboardingSignup signup, String idempotencyKey, long now) {
        jdbcTemplate.update("UPDATE eg_pgr_onboarding_signup SET status = 'PROVISIONING', version = version + 1, " +
                "updated_at = ? WHERE id = ? AND status = 'DRAFT'", now, signup.getId());
        OnboardingOperation operation = OnboardingOperation.builder()
                .id(UUID.randomUUID()).signupId(signup.getId()).status("PENDING")
                .currentStep("TENANT_RECORD").attempt(1).createdAt(now).updatedAt(now).build();
        jdbcTemplate.update("INSERT INTO eg_pgr_onboarding_operation " +
                        "(id, signup_id, status, current_step, completed_steps, attempt, idempotency_key, created_at, updated_at) " +
                        "VALUES (?, ?, ?, ?, '[]'::jsonb, ?, ?, ?, ?)",
                operation.getId(), operation.getSignupId(), operation.getStatus(), operation.getCurrentStep(),
                operation.getAttempt(), idempotencyKey, now, now);
        return operation;
    }

    public Optional<OnboardingOperation> findOwnedOperation(UUID operationId, String issuer, String subject) {
        return first(jdbcTemplate.query("SELECT operation." + OPERATION_COLUMNS.replace(", ", ", operation.") +
                        " FROM eg_pgr_onboarding_operation operation " +
                        "JOIN eg_pgr_onboarding_signup signup ON signup.id = operation.signup_id " +
                        "WHERE operation.id = ? AND signup.owner_issuer = ? AND signup.owner_subject = ?",
                operationMapper(), operationId, issuer, subject));
    }

    public Optional<OnboardingOperation> findOperationBySignup(UUID signupId) {
        return first(jdbcTemplate.query(
                "SELECT " + OPERATION_COLUMNS + " FROM eg_pgr_onboarding_operation WHERE signup_id = ?", operationMapper(), signupId));
    }

    public OnboardingOperation retry(OnboardingOperation operation, long now) {
        int changed = jdbcTemplate.update("UPDATE eg_pgr_onboarding_operation SET status = 'PENDING', " +
                        "error_code = NULL, error_message = NULL, attempt = attempt + 1, updated_at = ? " +
                        "WHERE id = ? AND status = 'RETRYABLE_FAILED'",
                now, operation.getId());
        if (changed != 1) {
            throw new CustomException("ONBOARDING_OPERATION_NOT_RETRYABLE", "The operation is not retryable");
        }
        operation.setStatus("PENDING");
        operation.setErrorCode(null);
        operation.setErrorMessage(null);
        operation.setAttempt(operation.getAttempt() + 1);
        operation.setUpdatedAt(now);
        return operation;
    }

    // ---- worker lease -------------------------------------------------------

    /** Claims the oldest PENDING operation, or a RUNNING one whose lease expired. */
    public Optional<OnboardingLease> claimOperation(String workerId, UUID leaseToken, long leaseExpiresAt, long now) {
        return first(jdbcTemplate.query("UPDATE eg_pgr_onboarding_operation SET status = 'RUNNING', " +
                        "lease_owner = ?, lease_token = ?, lease_expires_at = ?, updated_at = ? " +
                        "WHERE id = (SELECT id FROM eg_pgr_onboarding_operation " +
                        "WHERE status = 'PENDING' OR (status = 'RUNNING' AND lease_expires_at < ?) " +
                        "ORDER BY updated_at LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING " + OPERATION_COLUMNS +
                        ", lease_token, lease_expires_at",
                (rs, rowNum) -> new OnboardingLease(operationMapper().mapRow(rs, rowNum),
                        uuid(rs, "lease_token"), rs.getLong("lease_expires_at")),
                workerId, leaseToken, leaseExpiresAt, now, now));
    }

    public Optional<OnboardingOperation> findOperation(UUID id) {
        return first(jdbcTemplate.query(
                "SELECT " + OPERATION_COLUMNS + " FROM eg_pgr_onboarding_operation WHERE id = ?", operationMapper(), id));
    }

    public Optional<OnboardingSignup> findSignup(UUID id) {
        return first(jdbcTemplate.query(
                "SELECT " + SIGNUP_COLUMNS + " FROM eg_pgr_onboarding_signup WHERE id = ?", signupMapper(), id));
    }

    /** Ends a lease. Returns false when the caller no longer holds it. */
    public boolean finishOperation(UUID operationId, UUID leaseToken, String status, List<String> completedSteps,
                                   String currentStep, String errorCode, String errorMessage, long now) {
        int changed = jdbcTemplate.update("UPDATE eg_pgr_onboarding_operation SET status = ?, " +
                        "completed_steps = ?::jsonb, current_step = ?, error_code = ?, error_message = ?, " +
                        "lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL, updated_at = ? " +
                        "WHERE id = ? AND status = 'RUNNING' AND lease_token = ?",
                status, json(completedSteps), currentStep, errorCode, errorMessage, now, operationId, leaseToken);
        return changed == 1;
    }

    public void settleSignup(UUID signupId, String signupStatus, String identifierStatus, long now) {
        jdbcTemplate.update("UPDATE eg_pgr_onboarding_signup SET status = ?, version = version + 1, updated_at = ? " +
                "WHERE id = ?", signupStatus, now, signupId);
        jdbcTemplate.update("UPDATE eg_pgr_onboarding_identifier SET status = ? WHERE signup_id = ?",
                identifierStatus, signupId);
    }

    private RowMapper<OnboardingSignup> signupMapper() {
        return (rs, rowNum) -> OnboardingSignup.builder()
                .id(uuid(rs, "id")).ownerIssuer(rs.getString("owner_issuer"))
                .ownerSubject(rs.getString("owner_subject")).status(rs.getString("status"))
                .accountName(rs.getString("account_name")).accountCode(rs.getString("account_code"))
                .organizationAlias(rs.getString("organization_alias"))
                .requestedTenantId(rs.getString("requested_tenant_id")).urlSlug(rs.getString("url_slug"))
                .countryCode(rs.getString("country_code")).languages(strings(rs.getString("languages")))
                .timeZone(rs.getString("time_zone")).financialYearPolicy(rs.getString("financial_year_policy"))
                .acceptedTermsVersion(rs.getString("accepted_terms_version")).version(rs.getLong("version"))
                .tenantMetadata(map(rs.getString("tenant_metadata")))
                .createdAt(rs.getLong("created_at")).updatedAt(rs.getLong("updated_at")).build();
    }

    private RowMapper<OnboardingOperation> operationMapper() {
        return (rs, rowNum) -> OnboardingOperation.builder()
                .id(uuid(rs, "id")).signupId(uuid(rs, "signup_id")).status(rs.getString("status"))
                .currentStep(rs.getString("current_step")).completedSteps(strings(rs.getString("completed_steps")))
                .errorCode(rs.getString("error_code")).errorMessage(rs.getString("error_message"))
                .attempt(rs.getInt("attempt")).createdAt(rs.getLong("created_at"))
                .updatedAt(rs.getLong("updated_at")).build();
    }

    private UUID uuid(ResultSet resultSet, String column) throws SQLException {
        Object value = resultSet.getObject(column);
        return value instanceof UUID ? (UUID) value : UUID.fromString(value.toString());
    }

    private String json(Object value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (JsonProcessingException exception) {
            throw new CustomException("ONBOARDING_SERIALIZATION_ERROR", "Could not store onboarding data");
        }
    }

    private List<String> strings(String json) {
        if (json == null) return Collections.emptyList();
        try {
            return objectMapper.readValue(json, new TypeReference<List<String>>() { });
        } catch (JsonProcessingException exception) {
            throw new CustomException("ONBOARDING_SERIALIZATION_ERROR", "Could not read onboarding data");
        }
    }

    private java.util.Map<String, Object> map(String json) {
        if (json == null) return Collections.emptyMap();
        try {
            return objectMapper.readValue(json, new TypeReference<java.util.Map<String, Object>>() { });
        } catch (JsonProcessingException exception) {
            throw new CustomException("ONBOARDING_SERIALIZATION_ERROR", "Could not read tenant metadata");
        }
    }

    private <T> Optional<T> first(List<T> values) {
        return values.isEmpty() ? Optional.empty() : Optional.of(values.get(0));
    }
}
