package org.egov.novubridge.service.account;

import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * The real SQL of {@code nb_tenant_account} against Postgres, through the shipped migration.
 * Executed with {@code -Dnb.test.jdbc=jdbc:postgresql://host:port/db -Dnb.test.user=.. -Dnb.test.password=..};
 * skipped without it.
 */
class TenantAccountRepositoryPostgresTest {

    private JdbcTemplate jdbc;
    private TenantAccountRepository repository;

    @BeforeEach
    void setUp() throws Exception {
        String url = System.getProperty("nb.test.jdbc");
        Assumptions.assumeTrue(url != null && !url.isBlank(), "set -Dnb.test.jdbc to run against Postgres");
        DriverManagerDataSource ds = new DriverManagerDataSource(url, System.getProperty("nb.test.user", "postgres"),
                System.getProperty("nb.test.password", "postgres"));
        jdbc = new JdbcTemplate(ds);
        jdbc.execute("DROP TABLE IF EXISTS nb_tenant_account");
        jdbc.execute(Files.readString(Path.of("src/main/resources/db/migration/main/V20261007120000__create_nb_tenant_account.sql")));
        jdbc.execute(Files.readString(Path.of("src/main/resources/db/migration/main/V20261007120000__create_nb_tenant_account.sql")));
        repository = new TenantAccountRepository(jdbc);
    }

    @Test
    void theLease_letsOneCallAtATime_andExpires() {
        assertTrue(repository.claim("acme", "a", 1_000, 2_000));
        assertFalse(repository.claim("acme", "b", 1_500, 2_500), "a live lease blocks another owner");
        assertFalse(repository.claim("acme", "a", 1_600, 2_600),
                "a live lease blocks its own token too: owners are per call, never shared by a replica's threads");
        assertTrue(repository.claim("acme", "b", 3_000, 4_000), "an expired lease can be taken over");
        assertEquals("PROVISIONING", repository.find("acme").orElseThrow().status());
    }

    @Test
    void writesAreFencedByTheLeaseOwner() {
        repository.claim("acme", "a", 1_000, 2_000);
        assertEquals(0, repository.recordOrganization("acme", "intruder", "org-x", "DIGIT tenant acme", 1_050));
        assertEquals(1, repository.recordOrganization("acme", "a", "org-1", "DIGIT tenant acme", 1_100));
        assertEquals(0, repository.markProvisioned("acme", "intruder", "env", "Development", "v1:x:y", "x", 1, 1_200),
                "a write without the lease reports that it changed nothing");
        assertEquals("PROVISIONING", repository.find("acme").orElseThrow().status(), "a non-owner cannot mark it");

        assertEquals(1, repository.markProvisioned("acme", "a", "env", "Development", "v1:x:y", "x", 1, 1_300));
        TenantAccountRepository.Row row = repository.find("acme").orElseThrow();
        assertEquals("PROVISIONED", row.status());
        assertEquals("org-1", row.organizationId());
        assertNull(row.leaseOwner());

        assertTrue(repository.claim("acme", "b", 1_400, 2_400), "a re-ensure leases the row");
        assertEquals("PROVISIONED", repository.find("acme").orElseThrow().status(), "while leased it keeps sending");
        repository.markDeprovisioned("acme", "b", 1_500);
        row = repository.find("acme").orElseThrow();
        assertEquals("DEPROVISIONED", row.status());
        assertNull(row.apiKeyCiphertext());
        assertEquals("org-1", row.organizationId(), "the organization is remembered for a re-provision");
    }

    @Test
    void deprovisioning_forgetsTheKeyAtOnce_keepsTheLease_andAFailureKeepsItDeprovisioning() {
        repository.claim("acme", "a", 1_000, 2_000);
        repository.markProvisioned("acme", "a", "env", "Development", "v1:x:y", "x", 1, 1_100);
        assertTrue(repository.claim("acme", "b", 1_200, 2_200));

        repository.markDeprovisioning("acme", "intruder", 1_250);
        assertEquals("PROVISIONED", repository.find("acme").orElseThrow().status(), "fenced by the lease owner");
        repository.markDeprovisioning("acme", "b", 1_300);
        TenantAccountRepository.Row row = repository.find("acme").orElseThrow();
        assertEquals("DEPROVISIONING", row.status());
        assertNull(row.apiKeyCiphertext());
        assertNull(row.apiKeyId());
        assertEquals("b", row.leaseOwner(), "the deprovision keeps its lease for the Novu steps");

        repository.markFailed("acme", "b", "DEPROVISIONING", "NB_NOVU_PLATFORM_FAILED", "down", 1_400);
        row = repository.find("acme").orElseThrow();
        assertEquals("DEPROVISIONING", row.status());
        assertEquals("NB_NOVU_PLATFORM_FAILED", row.lastErrorCode());
        assertNull(row.leaseOwner());
    }

    @Test
    void failureKeepsTheGivenStatus_andReleasesTheLease() {
        repository.claim("acme", "a", 1_000, 2_000);
        repository.markFailed("acme", "a", "FAILED", "NB_NOVU_UNAVAILABLE", "down", 1_100);
        TenantAccountRepository.Row row = repository.find("acme").orElseThrow();
        assertEquals("FAILED", row.status());
        assertEquals("NB_NOVU_UNAVAILABLE", row.lastErrorCode());
        assertNull(row.leaseOwner());
        assertEquals(1, repository.list().size());
    }
}
