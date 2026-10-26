package org.egov.novubridge.config;

import jakarta.annotation.PostConstruct;
import lombok.extern.slf4j.Slf4j;
import org.egov.novubridge.service.account.ApiKeyCipher;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

import java.util.ArrayList;
import java.util.List;

/**
 * Per-tenant accounts (#2203) refuse to start half-configured: switched on without a usable
 * encryption key, a stored tenant key could be neither written nor read; without the platform
 * admin login, no tenant could ever be provisioned. Missing internal tokens only warn: they switch
 * their API off (403), which is the safe direction.
 */
@Slf4j
@Component
public class TenantAccountsSanityCheck {

    private final TenantAccountsConfiguration accounts;

    public TenantAccountsSanityCheck(TenantAccountsConfiguration accounts) {
        this.accounts = accounts;
    }

    @PostConstruct
    public void verify() {
        List<String> fatal = new ArrayList<>();
        List<String> warn = new ArrayList<>();
        if (accounts.isEnabled()) {
            if (!StringUtils.hasText(accounts.getEncryptionKey())
                    || accounts.getEncryptionKey().trim().length() < ApiKeyCipher.MIN_SECRET_LENGTH) {
                fatal.add("novu.bridge.tenant.accounts.enabled=true but novu.bridge.tenant.accounts.encryption.key is "
                        + "blank or shorter than " + ApiKeyCipher.MIN_SECRET_LENGTH + " characters: tenant API keys "
                        + "could not be stored or read");
            }
            if (!StringUtils.hasText(accounts.getAdminEmail()) || !StringUtils.hasText(accounts.getAdminPassword())) {
                fatal.add("novu.bridge.tenant.accounts.enabled=true but novu.bridge.tenant.accounts.admin.email/password "
                        + "are blank: no tenant organization could be created");
            }
            if (!accounts.adminApiEnabled()) {
                warn.add("novu.bridge.internal.admin.token is blank: the tenant admin API is off, so tenant creation "
                        + "cannot provision notification accounts (it continues without them)");
            }
            if (!accounts.sendApiEnabled()) {
                warn.add("novu.bridge.internal.send.token is blank: POST /messages/_send is off (403)");
            }
        } else if (accounts.sendApiEnabled()) {
            warn.add("novu.bridge.internal.send.token is set but per-tenant accounts are off: every _send answers "
                    + "409 NB_TENANT_NOT_PROVISIONED");
        }
        warn.forEach(w -> log.warn("novu-bridge tenant accounts: {}", w));
        if (!fatal.isEmpty()) {
            String message = "novu-bridge refuses to start:\n - " + String.join("\n - ", fatal);
            log.error(message);
            throw new IllegalStateException(message);
        }
    }
}
