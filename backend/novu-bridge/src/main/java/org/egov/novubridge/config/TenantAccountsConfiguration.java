package org.egov.novubridge.config;

import lombok.Data;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

/**
 * Per-tenant Novu accounts (#2203): each provisioned root tenant gets its own Novu
 * ORGANIZATION, created by the bridge with the Novu platform admin's login, and its API key is
 * kept encrypted in {@code nb_tenant_account}. Kept apart from {@link NovuBridgeConfiguration}
 * so the feature's settings read as one block. Defaults: {@code application.properties}.
 */
@Component
@Data
public class TenantAccountsConfiguration {

    /** Off = every tenant uses the deployment's shared Novu account (the pre-#2203 behaviour). */
    @Value("${novu.bridge.tenant.accounts.enabled:false}")
    private Boolean enabled;

    /**
     * The Novu platform admin user the bridge logs in as to create and manage tenant
     * organizations. On the Compose deploy this is the account the deploy mints the shared key
     * with ({@code novu_admin_email}); API keys cannot create organizations, a user JWT can.
     */
    @Value("${novu.bridge.tenant.accounts.admin.email:}")
    private String adminEmail;

    @Value("${novu.bridge.tenant.accounts.admin.password:}")
    private String adminPassword;

    /** AES-256-GCM key material for the stored tenant API keys (SHA-256 of this value). */
    @Value("${novu.bridge.tenant.accounts.encryption.key:}")
    private String encryptionKey;

    /** The previous encryption key during a rotation: still decrypts, never encrypts. */
    @Value("${novu.bridge.tenant.accounts.encryption.key.previous:}")
    private String previousEncryptionKey;

    /** Which of the organization's two environments the bridge sends through. */
    @Value("${novu.bridge.tenant.accounts.environment:Development}")
    private String environmentName;

    /**
     * Prefix of the organization name. The name is the idempotency key that lets a provision
     * interrupted between "Novu created the org" and "the row recorded it" adopt that org
     * instead of creating a second one, so never change it on a running deployment.
     */
    @Value("${novu.bridge.tenant.accounts.organization.prefix:DIGIT tenant }")
    private String organizationPrefix;

    /** How long a tenant's provisioned/unprovisioned answer is cached (bounds multi-replica staleness). */
    @Value("${novu.bridge.tenant.accounts.cache.ttl.ms:30000}")
    private Long cacheTtlMs;

    /** A provisioning claim older than this is considered abandoned (crashed replica). */
    @Value("${novu.bridge.tenant.accounts.lease.ms:120000}")
    private Long leaseMs;

    /** Shared secret for the internal tenant admin API (/novu-adapter/v1/tenants/**). Blank = API off. */
    @Value("${novu.bridge.internal.admin.token:}")
    private String internalAdminToken;

    /** Shared secret for POST /novu-adapter/v1/messages/_send (the Identity BFF). Blank = endpoint off. */
    @Value("${novu.bridge.internal.send.token:}")
    private String internalSendToken;

    /** The OTP workflows every tenant organization is given. */
    @Value("${novu.bridge.workflow.id.otp.sms:digit-otp-sms}")
    private String otpWorkflowSms;

    @Value("${novu.bridge.workflow.id.otp.email:digit-otp-email}")
    private String otpWorkflowEmail;

    /** How long _send waits for Novu's job to finish before answering 202 (still in flight). */
    @Value("${novu.bridge.messages.confirm.timeout.ms:5000}")
    private Long confirmTimeoutMs;

    @Value("${novu.bridge.messages.confirm.poll.ms:400}")
    private Long confirmPollMs;

    public boolean isEnabled() {
        return Boolean.TRUE.equals(enabled);
    }

    public boolean adminApiEnabled() {
        return StringUtils.hasText(internalAdminToken);
    }

    public boolean sendApiEnabled() {
        return StringUtils.hasText(internalSendToken);
    }

    public String organizationName(String rootTenant) {
        return (organizationPrefix == null ? "" : organizationPrefix) + rootTenant;
    }
}
