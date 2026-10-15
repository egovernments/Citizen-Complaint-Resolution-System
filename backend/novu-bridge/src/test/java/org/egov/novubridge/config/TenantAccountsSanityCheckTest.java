package org.egov.novubridge.config;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** Per-tenant accounts refuse to start half-configured (fail closed), and change nothing while off. */
class TenantAccountsSanityCheckTest {

    private static TenantAccountsConfiguration on() {
        TenantAccountsConfiguration accounts = new TenantAccountsConfiguration();
        accounts.setEnabled(true);
        accounts.setAdminEmail("admin@example.test");
        accounts.setAdminPassword("Platform-Admin-1");
        accounts.setEncryptionKey("0123456789abcdef0123456789abcdef");
        accounts.setInternalAdminToken("admin-token");
        accounts.setInternalSendToken("send-token");
        return accounts;
    }

    @Test
    void complete_starts() {
        assertDoesNotThrow(() -> new TenantAccountsSanityCheck(on()).verify());
    }

    @Test
    void off_startsWithoutAnyOfIt() {
        assertDoesNotThrow(() -> new TenantAccountsSanityCheck(new TenantAccountsConfiguration()).verify());
    }

    @Test
    void aMissingOrShortEncryptionKey_refusesToStart() {
        TenantAccountsConfiguration accounts = on();
        accounts.setEncryptionKey("short");
        IllegalStateException e = assertThrows(IllegalStateException.class, () -> new TenantAccountsSanityCheck(accounts).verify());
        assertTrue(e.getMessage().contains("encryption.key"), e.getMessage());
        accounts.setEncryptionKey("");
        assertThrows(IllegalStateException.class, () -> new TenantAccountsSanityCheck(accounts).verify());
    }

    @Test
    void aMissingPlatformLogin_refusesToStart() {
        TenantAccountsConfiguration accounts = on();
        accounts.setAdminPassword("");
        IllegalStateException e = assertThrows(IllegalStateException.class, () -> new TenantAccountsSanityCheck(accounts).verify());
        assertTrue(e.getMessage().contains("admin.email/password"), e.getMessage());
    }

    @Test
    void missingInternalTokens_onlySwitchTheirApiOff() {
        TenantAccountsConfiguration accounts = on();
        accounts.setInternalAdminToken("");
        accounts.setInternalSendToken("");
        assertDoesNotThrow(() -> new TenantAccountsSanityCheck(accounts).verify());
    }
}
