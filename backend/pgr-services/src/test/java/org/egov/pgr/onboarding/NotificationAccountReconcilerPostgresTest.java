package org.egov.pgr.onboarding;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.After;
import org.junit.Assume;
import org.junit.Before;
import org.junit.Test;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.jdbc.datasource.init.ResourceDatabasePopulator;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.Assert.assertEquals;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * The reconciler's SQL against the real onboarding tables. Executed with
 * -Donboarding.test.jdbc=jdbc:postgresql://127.0.0.1:16432/onboarding_test, like OnboardingPostgresTest.
 */
public class NotificationAccountReconcilerPostgresTest {

    private JdbcTemplate jdbc;
    private String schema;
    private OnboardingRepository repository;

    @Before
    public void setup() throws Exception {
        String url = System.getProperty("onboarding.test.jdbc");
        Assume.assumeNotNull(url);
        schema = "onb_test_" + UUID.randomUUID().toString().replace("-", "");
        new JdbcTemplate(new DriverManagerDataSource(url, "postgres", "onboarding-test-only")).execute("CREATE SCHEMA " + schema);
        DriverManagerDataSource source = new DriverManagerDataSource(url + "?currentSchema=" + schema, "postgres", "onboarding-test-only");
        jdbc = new JdbcTemplate(source);
        var migrations = new ResourceDatabasePopulator();
        for (String name : List.of("V20260914000000__create_onboarding_tables.sql", "V20260914120000__add_onboarding_operation_lease.sql",
                "V20260918000000__onboarding_create_idempotency_per_subject.sql", "V20261004000000__onboarding_restart_and_publication.sql",
                "V20261004010000__onboarding_workspace.sql", "V20261005000000__onboarding_automatic_retry.sql"))
            migrations.addScript(new ClassPathResource("db/migration/main/" + name));
        migrations.execute(source);
        String normalization;
        try (var input = new ClassPathResource("db/migration/main/V20261004020000__workspace_name_normalization.sql").getInputStream()) {
            normalization = new String(input.readAllBytes(), java.nio.charset.StandardCharsets.UTF_8);
        }
        new TransactionTemplate(new DataSourceTransactionManager(source)).execute(tx -> { jdbc.execute(normalization); return null; });
        repository = new OnboardingRepository(jdbc, new ObjectMapper());
    }

    @After
    public void cleanup() {
        if (jdbc != null) jdbc.execute("DROP SCHEMA " + schema + " CASCADE");
    }

    /** A finished signup whose NOTIFICATION_ACCOUNT step recorded {@code progress}. */
    private void finishedWorkspace(String tenant, String progress) {
        var signup = OnboardingSignup.builder().id(UUID.randomUUID()).ownerIssuer("issuer").ownerSubject("founder-" + tenant)
                .status("DRAFT").accountName(tenant).accountCode(tenant.toUpperCase()).urlSlug(tenant).organizationAlias(tenant)
                .requestedTenantId(tenant).countryCode("IN").languages(List.of("en")).timeZone("Asia/Kolkata")
                .financialYearPolicy("APRIL").acceptedTermsVersion("1")
                .tenantMetadata(Map.of("schemaVersion", 1, "tenantAdmin", Map.of("mobileNumber", "9876543210", "countryCode", "+91")))
                .createdAt(1L).updatedAt(1L).version(1).build();
        repository.insertSignup(signup, "create-" + tenant);
        var op = repository.submit(signup, "submit-" + tenant, System.currentTimeMillis());
        jdbc.update("UPDATE eg_pgr_onboarding_operation SET status='SUCCEEDED', record_progress=?::jsonb WHERE id=?",
                progress == null ? "{}" : "{\"notification-account\":\"" + progress + "\"}", op.getId());
        jdbc.update("UPDATE eg_pgr_onboarding_signup SET status='ACTIVE' WHERE id=?", signup.getId());
    }

    private String progressOf(String tenant) {
        return jdbc.queryForObject("SELECT o.record_progress->>'notification-account' FROM eg_pgr_onboarding_operation o "
                + "JOIN eg_pgr_onboarding_signup s ON s.id=o.signup_id WHERE s.requested_tenant_id=?", String.class, tenant);
    }

    @Test
    public void onlyDeferredWorkspacesAreRetried_andTheProvisionedOnesAreMarkedDone() {
        finishedWorkspace("deferredok", "DEFERRED");
        finishedWorkspace("deferredko", "DEFERRED");
        finishedWorkspace("alreadydone", "DONE");
        finishedWorkspace("legacy", null);
        NotificationAccountClient client = mock(NotificationAccountClient.class);
        when(client.configured()).thenReturn(true);
        List<List<String>> asked = new java.util.ArrayList<>();
        when(client.backfill(anyList())).thenAnswer(inv -> {
            List<String> ids = inv.getArgument(0);
            asked.add(ids);
            return Map.of("deferredok", "PROVISIONED", "deferredko", "NB_NOVU_UNAVAILABLE");
        });

        assertEquals(1, new NotificationAccountReconciler(jdbc, client, 60_000).reconcile());

        assertEquals(1, asked.size());
        assertEquals(java.util.Set.of("deferredok", "deferredko"), new java.util.HashSet<>(asked.get(0)));
        assertEquals("DONE", progressOf("deferredok"));
        assertEquals("DEFERRED", progressOf("deferredko"));
        assertEquals("DONE", progressOf("alreadydone"));
        assertEquals(null, progressOf("legacy"));
    }
}
