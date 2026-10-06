package org.egov.pgr.onboarding;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.egov.tracer.model.CustomException;
import org.junit.*;
import org.springframework.aop.framework.ProxyFactory;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.init.ResourceDatabasePopulator;
import org.springframework.transaction.annotation.AnnotationTransactionAttributeSource;
import org.springframework.transaction.interceptor.TransactionInterceptor;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.server.ResponseStatusException;
import java.util.*;
import java.util.concurrent.*;
import static org.junit.Assert.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;

/** Uses the existing lane PostgreSQL fixture and an isolated schema per test. */
public class WorkspacePostgresTest {
    private DriverManagerDataSource source;
    private JdbcTemplate jdbc;
    private WorkspaceRepository repository;
    private OnboardingRepository onboarding;
    private WorkspaceGateway gateway;
    private WorkspaceService service;
    private TransactionTemplate tx;
    private final ObjectMapper mapper = new ObjectMapper();
    private String schema;

    @Before public void setup() {
        String url = System.getProperty("onboarding.test.jdbc"); Assume.assumeNotNull(url);
        schema = "workspace_test_" + UUID.randomUUID().toString().replace("-", "");
        var admin = new DriverManagerDataSource(url, "postgres", "onboarding-test-only");
        new JdbcTemplate(admin).execute("CREATE SCHEMA " + schema);
        source = new DriverManagerDataSource(url + "?currentSchema=" + schema, "postgres", "onboarding-test-only");
        jdbc = new JdbcTemplate(source);
        var migrations = new ResourceDatabasePopulator();
        for (String name : List.of("V20260914000000__create_onboarding_tables.sql", "V20260914120000__add_onboarding_operation_lease.sql",
                "V20260918000000__onboarding_create_idempotency_per_subject.sql", "V20261004000000__onboarding_restart_and_publication.sql",
                "V20261004010000__onboarding_workspace.sql")) migrations.addScript(new ClassPathResource("db/migration/main/" + name));
        migrations.execute(source);
        tx = new TransactionTemplate(new DataSourceTransactionManager(source));
        repository = new WorkspaceRepository(jdbc, mapper); onboarding = new OnboardingRepository(jdbc, mapper);
        gateway = mock(WorkspaceGateway.class);
        when(gateway.requireAdmin(anyString(), any())).thenReturn("admin");
        when(gateway.tenant(anyString())).thenAnswer(call -> mapper.valueToTree(Map.of("data", Map.of("name", "Old " + call.getArgument(0)))));
        when(gateway.languages(anyString())).thenReturn(List.of("en_IN", "hi_IN"));
        // These tests cover multi-locale rename publication; which locales qualify is WorkspaceServiceTest's concern.
        when(gateway.seedsTenantNameModule(anyString())).thenReturn(true);
        when(gateway.probes(anyString())).thenReturn(Map.of("BRANDING", true, "DEPARTMENTS", true, "GEOGRAPHY", true, "EMPLOYEES", true, "COMPLAINT_TYPES", true));
        service = transactional(new WorkspaceService(repository, gateway, new OnboardingIdentifierService()));
    }
    @After public void cleanup() { if (jdbc != null) jdbc.execute("DROP SCHEMA " + schema + " CASCADE"); }
    @SuppressWarnings("unchecked") private <T> T transactional(T target) {
        var proxy = new ProxyFactory(target); proxy.setProxyTargetClass(true);
        proxy.addAdvice(new TransactionInterceptor(new DataSourceTransactionManager(source), new AnnotationTransactionAttributeSource()));
        return (T) proxy.getProxy();
    }
    private OnboardingSignup signup(String tenant) {
        var signup = OnboardingSignup.builder().id(UUID.randomUUID()).ownerIssuer("issuer").ownerSubject("founder-" + tenant).status("DRAFT")
                .accountName("Old " + tenant).accountCode(tenant.toUpperCase(Locale.ROOT)).urlSlug(tenant).organizationAlias(tenant)
                .requestedTenantId(tenant).countryCode("IN").languages(List.of("en", "hi")).timeZone("Asia/Kolkata")
                .financialYearPolicy("APRIL").acceptedTermsVersion("1").tenantMetadata(Map.of()).createdAt(1L).updatedAt(1L).version(1).build();
        onboarding.insertSignup(signup, "create-" + tenant); return signup;
    }
    private void activate(OnboardingSignup signup) { tx.execute(s -> { onboarding.settleSignup(signup.getId(), "ACTIVE", "CONSUMED", "1", 2L); return null; }); }
    private Map<String,Object> rename(String tenant, String name, long version) { return Map.of("tenantId", tenant, "name", name, "version", version); }
    private Map<String,Object> update(String tenant, long version) { return Map.of("tenantId", tenant, "step", "BRANDING", "state", "SKIPPED", "version", version); }
    private int count(String table) { return jdbc.queryForObject("SELECT count(*) FROM " + table, Integer.class); }
    private void await(CountDownLatch latch) { try { assertTrue(latch.await(10, TimeUnit.SECONDS)); } catch (InterruptedException e) { throw new AssertionError(e); } }

    @Test public void activationIsAtomicIdempotentAndAudited() {
        var signup = signup("example");
        assertThrows(IllegalStateException.class, () -> tx.execute(s -> {
            onboarding.settleSignup(signup.getId(), "ACTIVE", "CONSUMED", "1", 2L); throw new IllegalStateException("crash");
        }));
        assertEquals("DRAFT", onboarding.findSignup(signup.getId()).orElseThrow().getStatus());
        assertEquals(0, count("eg_pgr_onboarding_workspace")); assertEquals(0, count("eg_pgr_onboarding_workspace_event"));
        activate(signup); activate(signup);
        var row = repository.find("example", false).orElseThrow();
        assertEquals("NOT_STARTED", row.get("status")); assertEquals("1", row.get("seedVersion")); assertEquals(1L, row.get("version"));
        assertEquals(1, count("eg_pgr_onboarding_workspace_event"));
        service.update(update("example", 1));
        assertEquals("WORKSPACE_VERSION_CONFLICT", assertThrows(ResponseStatusException.class, () -> service.update(update("example", 1))).getReason());
        assertEquals(List.of("CREATED", "STEP_UPDATED"), jdbc.queryForList("SELECT event_type FROM eg_pgr_onboarding_workspace_event ORDER BY version", String.class));
        assertEquals(2L, repository.find("example", false).orElseThrow().get("version"));
    }

    /** Escalation scans every live onboarded tenant, whatever its checklist status (#2269 item 8). */
    @Test public void onboardedTenantsAreEveryActiveSignupAndWorkspaceWhateverItsChecklistStatus() {
        signup("draft");
        var failed = signup("failed"); jdbc.update("UPDATE eg_pgr_onboarding_signup SET status='FAILED' WHERE id=?", failed.getId());
        activate(signup("notstarted"));
        activate(signup("inprogress")); service.update(update("inprogress", 1));
        assertEquals("IN_PROGRESS", repository.find("inprogress", false).orElseThrow().get("status"));
        var unmaterialized = signup("noworkspace"); jdbc.update("UPDATE eg_pgr_onboarding_signup SET status='ACTIVE' WHERE id=?", unmaterialized.getId());
        repository.materializeLegacy("legacy");
        assertEquals(List.of("inprogress", "legacy", "notstarted", "noworkspace"), repository.onboardedTenantIds());
    }

    @Test public void signupReservationWinsConcurrentRenameWithoutTheft() throws Exception {
        var signup = signup("newtenant"); activate(signup("existing"));
        var reserved = new CountDownLatch(1); var release = new CountDownLatch(1); var started = new CountDownLatch(1);
        var pool = Executors.newFixedThreadPool(2);
        try {
            var first = pool.submit(() -> tx.execute(s -> { onboarding.reserveIdentifier("ORGANIZATION_NAME", "shared name", signup.getId(), 3L); reserved.countDown(); await(release); return null; }));
            await(reserved);
            var second = pool.submit(() -> { started.countDown(); return service.rename(rename("existing", "Shared Name", 1)); });
            await(started); assertThrows(TimeoutException.class, () -> second.get(200, TimeUnit.MILLISECONDS)); release.countDown(); first.get(10, TimeUnit.SECONDS);
            var failure = assertThrows(ExecutionException.class, () -> second.get(10, TimeUnit.SECONDS));
            assertEquals("WORKSPACE_NAME_TAKEN", ((ResponseStatusException) failure.getCause()).getReason());
            assertEquals("newtenant", jdbc.queryForObject("SELECT tenant_id FROM eg_pgr_onboarding_workspace_name WHERE normalized_name='shared name'", String.class));
            assertEquals(0, count("eg_pgr_onboarding_workspace_rename"));
            assertEquals(1L, repository.find("existing", false).orElseThrow().get("version"));
        } finally { release.countDown(); pool.shutdownNow(); }
    }

    @Test public void renameReservationWinsConcurrentSignupWithoutTheft() throws Exception {
        var signup = signup("newtenant"); activate(signup("existing"));
        var reserved = new CountDownLatch(1); var release = new CountDownLatch(1); var started = new CountDownLatch(1);
        var pool = Executors.newFixedThreadPool(2);
        try {
            var first = pool.submit(() -> tx.execute(s -> { service.rename(rename("existing", "Shared Name", 1)); reserved.countDown(); await(release); return null; }));
            await(reserved);
            var second = pool.submit(() -> tx.execute(s -> { started.countDown(); onboarding.reserveIdentifier("ORGANIZATION_NAME", "shared name", signup.getId(), 3L); return null; }));
            await(started); assertThrows(TimeoutException.class, () -> second.get(200, TimeUnit.MILLISECONDS)); release.countDown(); first.get(10, TimeUnit.SECONDS);
            assertTrue(assertThrows(ExecutionException.class, () -> second.get(10, TimeUnit.SECONDS)).getCause() instanceof CustomException);
            assertEquals("existing", jdbc.queryForObject("SELECT tenant_id FROM eg_pgr_onboarding_workspace_name WHERE normalized_name='shared name'", String.class));
            assertFalse(onboarding.identifierAvailable("ORGANIZATION_NAME", "shared name", signup.getId()));
            assertEquals(0, count("eg_pgr_onboarding_identifier"));
        } finally { release.countDown(); pool.shutdownNow(); }
    }

    @Test public void renameAndSetupAtSameVersionCommitExactlyOnce() throws Exception {
        activate(signup("example")); var start = new CountDownLatch(1); var pool = Executors.newFixedThreadPool(2);
        try {
            var rename = pool.submit(() -> { await(start); return attempt(() -> service.rename(rename("example", "New Name", 1))); });
            var update = pool.submit(() -> { await(start); return attempt(() -> service.update(update("example", 1))); });
            start.countDown(); assertEquals(Set.of("OK", "WORKSPACE_VERSION_CONFLICT"), Set.of(rename.get(10, TimeUnit.SECONDS), update.get(10, TimeUnit.SECONDS)));
            assertEquals(2L, repository.find("example", false).orElseThrow().get("version")); assertEquals(2, count("eg_pgr_onboarding_workspace_event"));
            assertEquals(count("eg_pgr_onboarding_workspace_rename") * 2, count("eg_pgr_onboarding_workspace_name"));
        } finally { pool.shutdownNow(); }
    }
    private String attempt(Runnable call) { try { call.run(); return "OK"; } catch (ResponseStatusException e) { return e.getReason(); } }

    @Test public void simultaneousFirstLegacyRenamesSerializeAndStayUngated() throws Exception {
        var start = new CountDownLatch(1); var pool = Executors.newFixedThreadPool(2);
        try {
            var first = pool.submit(() -> { await(start); return attempt(() -> service.rename(rename("legacy", "First", 0))); });
            var second = pool.submit(() -> { await(start); return attempt(() -> service.rename(rename("legacy", "Second", 0))); });
            start.countDown(); assertEquals(Set.of("OK", "WORKSPACE_VERSION_CONFLICT"), Set.of(first.get(10, TimeUnit.SECONDS), second.get(10, TimeUnit.SECONDS)));
            assertEquals(1, count("eg_pgr_onboarding_workspace_rename"));
            var search = service.search(Map.of("tenantId", "legacy"));
            assertEquals(true, ((Map<?,?>) search.get("Workspace")).get("legacy")); assertNull(search.get("Probes"));
            assertNotNull(search.get("Rename")); verify(gateway, never()).probes(anyString());
            var update = service.update(update("legacy", 1));
            assertEquals("DONE", ((Map<?,?>) update.get("Workspace")).get("status"));
            assertEquals(1L, ((Map<?,?>) update.get("Workspace")).get("version"));
        } finally { pool.shutdownNow(); }
    }

    @Test public void partialPublicationKeepsBothNamesAndResumesWithoutRepeatingAcknowledgedWrites() {
        var signup = signup("example");
        tx.execute(s -> { onboarding.reserveIdentifier("ORGANIZATION_NAME", "old example", signup.getId(), 1L); return null; }); activate(signup);
        service.rename(rename("example", "New Name", 1));
        doThrow(new OnboardingFailure("LOCALIZATION_DOWN", true)).doNothing().when(gateway).renameLocale(eq("example"), eq("New Name"), eq("hi_IN"), any());
        var publisher = transactional(new WorkspaceRenamePublisher(repository, gateway)); assertThrows(ResponseStatusException.class,()->publisher.publish(rename("example","New Name",1)));
        var partial = repository.rename("example", null).orElseThrow();
        assertEquals(List.of("MDMS", "LOCALE:en_IN"), partial.get("progress")); assertEquals("PENDING", partial.get("status")); assertEquals("LOCALIZATION_DOWN", partial.get("lastErrorCode"));
        assertFalse(onboarding.identifierAvailable("ORGANIZATION_NAME", "old example", null)); assertFalse(onboarding.identifierAvailable("ORGANIZATION_NAME", "new name", null));
        assertEquals("WORKSPACE_RENAME_PENDING", assertThrows(ResponseStatusException.class, () -> service.rename(rename("example", "Third", 2))).getReason());
        service.update(update("example", 2));
        publisher.publish(rename("example","New Name",1));
        var done = repository.rename("example", null).orElseThrow(); assertEquals("DONE", done.get("status")); assertFalse(done.containsKey("lastErrorCode"));
        verify(gateway, times(1)).renameMdms(eq("example"), eq("New Name"), any()); verify(gateway, times(1)).renameLocale(eq("example"), eq("New Name"), eq("en_IN"), any());
        verify(gateway, times(2)).renameLocale(eq("example"), eq("New Name"), eq("hi_IN"), any()); verify(gateway).bustCache(eq("example"), any());
        assertTrue(onboarding.identifierAvailable("ORGANIZATION_NAME", "old example", null)); assertFalse(onboarding.identifierAvailable("ORGANIZATION_NAME", "new name", null));
        assertEquals("New Name", onboarding.findSignup(signup.getId()).orElseThrow().getAccountName());
        assertEquals(3L, repository.find("example", false).orElseThrow().get("version"));
        assertEquals("DONE", ((Map<?,?>) service.rename(rename("example", "  NEW   name ", 1)).get("Rename")).get("status"));
        assertEquals(1, (int) jdbc.queryForObject("SELECT count(*) FROM eg_pgr_onboarding_workspace_event WHERE event_type='RENAME_DONE'", Integer.class));
    }

    @Test public void staleCompletionCannotRetireNewReservationsOrOverwriteNewName() {
        var signup = signup("example"); activate(signup);
        service.rename(rename("example", "First", 1));
        var old = repository.rename("example", null).orElseThrow();
        transactional(new WorkspaceRenamePublisher(repository, gateway)).publish(rename("example","First",1));
        when(gateway.tenant("example")).thenReturn(mapper.valueToTree(Map.of("data", Map.of("name", "First"))));
        service.rename(rename("example", "Second", 2));
        tx.execute(s -> { repository.finishRename(old); return null; });
        assertEquals(2, count("eg_pgr_onboarding_workspace_name"));
        assertEquals("PENDING", repository.rename("example", null).orElseThrow().get("status"));
        assertEquals(1, (int) jdbc.queryForObject("SELECT count(*) FROM eg_pgr_onboarding_workspace_event WHERE event_type='RENAME_DONE'", Integer.class));
        transactional(new WorkspaceRenamePublisher(repository, gateway)).publish(rename("example","Second",2));
        tx.execute(s -> { repository.finishRename(old); return null; });
        assertEquals("Second", onboarding.findSignup(signup.getId()).orElseThrow().getAccountName());
        assertEquals("second", jdbc.queryForObject("SELECT normalized_name FROM eg_pgr_onboarding_workspace_name", String.class));
    }
    private void migrateNameKeys() {
        tx.execute(s -> {
            try (var input = new ClassPathResource("db/migration/main/V20261004020000__workspace_name_normalization.sql").getInputStream()) {
                jdbc.execute(new String(input.readAllBytes(), java.nio.charset.StandardCharsets.UTF_8));
            } catch (java.io.IOException e) { throw new IllegalStateException(e); }
            return null;
        });
    }
    @Test public void normalizationMigrationPreservesOwnersHistoryAndMatchesJavaForOldKeys() {
        String[] names = {"Cafe\u0301\u00a0Council", "\ufeffNorth\u2003Office\ufeff", "İZMİR", "ΆΛΦΑ", "ASCII Name", "J\u030c", "Υ\u0308\u0301"};
        var normalizer = new OnboardingIdentifierService();
        for (int i=0;i<names.length;i++) {
            String old = names[i].trim().replaceAll("\\s+", " ").toLowerCase(Locale.ROOT);
            var signup = signup("tenant"+(char)('a'+i));
            tx.execute(s -> { onboarding.reserveIdentifier("ORGANIZATION_NAME",old,signup.getId(),1L); return null; });
        }
        var signup = signup("released");
        onboarding.reserveIdentifier("ORGANIZATION_NAME","released cafe\u0301",signup.getId(),1L);
        jdbc.update("UPDATE eg_pgr_onboarding_identifier SET status='RELEASED' WHERE signup_id=?",signup.getId());
        activate(signup);service.rename(rename("released","Another Name",1));
        jdbc.update("UPDATE eg_pgr_onboarding_identifier SET status='RELEASED' WHERE signup_id=?",signup.getId());
        jdbc.update("UPDATE eg_pgr_onboarding_workspace_rename SET normalized_name=?,old_normalized_name=?","cafe\u0301","old\u00a0name");
        migrateNameKeys();
        for (int i=0;i<names.length;i++) {
            String tenant="tenant"+(char)('a'+i), normalized=normalizer.normalizeOrganizationName(names[i]);
            assertEquals(normalized,jdbc.queryForObject("SELECT normalized_name FROM eg_pgr_onboarding_workspace_name WHERE tenant_id=?",String.class,tenant));
            assertEquals(normalized,jdbc.queryForObject("SELECT normalized_value FROM eg_pgr_onboarding_identifier i JOIN eg_pgr_onboarding_signup s ON s.id=i.signup_id WHERE s.requested_tenant_id=?",String.class,tenant));
            assertFalse(onboarding.identifierAvailable("ORGANIZATION_NAME",normalized,null));
        }
        assertEquals("RELEASED",jdbc.queryForObject("SELECT status FROM eg_pgr_onboarding_identifier WHERE normalized_value='released café'",String.class));
        var rename=repository.rename("released",null).orElseThrow();assertEquals("café",rename.get("normalizedName"));assertEquals("old name",rename.get("oldNormalizedName"));
        assertEquals("PENDING",rename.get("status"));assertEquals(2,count("eg_pgr_onboarding_workspace_event"));
    }
    @Test public void canonicalCollisionAbortsWithoutPartialNormalizationOrOwnershipChanges() {
        jdbc.update("INSERT INTO eg_pgr_onboarding_workspace_name VALUES (?,?),(?,?),(?,?)","cafe\u0301","one","café","two","north\u00a0office","three");
        var error=assertThrows(org.springframework.dao.DataAccessException.class,this::migrateNameKeys);
        assertTrue(error.getMessage().contains("normalization collision"));
        assertEquals("one",jdbc.queryForObject("SELECT tenant_id FROM eg_pgr_onboarding_workspace_name WHERE normalized_name=?",String.class,"cafe\u0301"));
        assertEquals("three",jdbc.queryForObject("SELECT tenant_id FROM eg_pgr_onboarding_workspace_name WHERE normalized_name=?",String.class,"north\u00a0office"));
        assertEquals(3,count("eg_pgr_onboarding_workspace_name"));
    }
    @Test public void releasedIdentifierCollisionAlsoAbortsWithoutDeletingHistory() {
        var first=signup("first");var second=signup("second");
        onboarding.reserveIdentifier("ORGANIZATION_NAME","cafe\u0301",first.getId(),1L);
        onboarding.reserveIdentifier("ORGANIZATION_NAME","café",second.getId(),1L);
        jdbc.update("DELETE FROM eg_pgr_onboarding_workspace_name");
        jdbc.update("UPDATE eg_pgr_onboarding_identifier SET status='RELEASED'");
        assertThrows(org.springframework.dao.DataAccessException.class,this::migrateNameKeys);
        assertEquals(2,count("eg_pgr_onboarding_identifier"));
        assertEquals(2,(int)jdbc.queryForObject("SELECT count(*) FROM eg_pgr_onboarding_identifier WHERE status='RELEASED'",Integer.class));
    }

    @Test public void productionFlywayParserExecutesDollarQuotedMigrationTransactionally() {
        jdbc.update("INSERT INTO eg_pgr_onboarding_workspace_name VALUES (?,?)","cafe\u0301\u00a0council","example");
        var flyway=org.flywaydb.core.Flyway.configure().dataSource(source).defaultSchema(schema)
                .baselineOnMigrate(true).baselineVersion("20261004010000").locations("classpath:db/migration/main").load();
        assertEquals(4,flyway.migrate().migrationsExecuted);
        assertEquals("café council",jdbc.queryForObject("SELECT normalized_name FROM eg_pgr_onboarding_workspace_name",String.class));
        assertEquals(0,flyway.migrate().migrationsExecuted);
    }
    @Test public void crossTableOwnershipCollisionRollsBackUnderFlyway() {
        var signup=signup("first");onboarding.reserveIdentifier("ORGANIZATION_NAME","cafe\u0301",signup.getId(),1L);
        jdbc.update("DELETE FROM eg_pgr_onboarding_workspace_name");
        jdbc.update("INSERT INTO eg_pgr_onboarding_workspace_name VALUES (?,?),(?,?)","café","other","north\u00a0office","third");
        var flyway=org.flywaydb.core.Flyway.configure().dataSource(source).defaultSchema(schema)
                .baselineOnMigrate(true).baselineVersion("20261004010000").locations("classpath:db/migration/main").load();
        var failure=assertThrows(org.flywaydb.core.api.FlywayException.class,flyway::migrate);
        assertTrue(failure.getMessage().contains("normalization ownership conflict"));
        assertEquals("cafe\u0301",jdbc.queryForObject("SELECT normalized_value FROM eg_pgr_onboarding_identifier",String.class));
        assertEquals("other",jdbc.queryForObject("SELECT tenant_id FROM eg_pgr_onboarding_workspace_name WHERE normalized_name='café'",String.class));
        assertEquals("third",jdbc.queryForObject("SELECT tenant_id FROM eg_pgr_onboarding_workspace_name WHERE normalized_name=?",String.class,"north\u00a0office"));
        assertEquals(0,(int)jdbc.queryForObject("SELECT count(*) FROM flyway_schema_history WHERE version='20261004020000'",Integer.class));
    }

    @Test public void seedUpgradeLeasesOneOlderWorkspaceAtATimeAndSkipsLockedRows() throws Exception {
        upgradeColumns();
        for (String tenant : List.of("alpha", "beta", "fresh")) {
            var signup = signup(tenant); tx.execute(s -> { onboarding.settleSignup(signup.getId(), "ACTIVE", "CONSUMED", tenant.equals("fresh") ? "2" : "1", 2L); return null; });
        }
        repository.materializeLegacy("legacy"); // seed_version NULL: not onboarded here, never upgraded
        long now = 1_000_000; UUID first = UUID.randomUUID(), second = UUID.randomUUID(), third = UUID.randomUUID();
        assertEquals("alpha", repository.claimUpgrade(2, first, now + 600_000, now).orElseThrow().get("tenantId"));
        // Another worker's claim transaction holds beta's row: SKIP LOCKED passes over it instead of waiting.
        var locked = new CountDownLatch(1); var release = new CountDownLatch(1); var pool = Executors.newFixedThreadPool(1);
        try {
            var holder = pool.submit(() -> tx.execute(s -> { jdbc.queryForList("SELECT 1 FROM eg_pgr_onboarding_workspace WHERE tenant_id='beta' FOR UPDATE"); locked.countDown(); await(release); return null; }));
            await(locked);
            assertTrue(repository.claimUpgrade(2, second, now + 600_000, now).isEmpty());
            release.countDown(); holder.get(10, TimeUnit.SECONDS);
        } finally { release.countDown(); pool.shutdownNow(); }
        var beta = repository.claimUpgrade(2, second, now + 600_000, now).orElseThrow();
        assertEquals("beta", beta.get("tenantId")); assertEquals("1", beta.get("seedVersion")); assertEquals(Map.of(), beta.get("progress"));
        assertTrue(repository.claimUpgrade(2, third, now + 600_000, now).isEmpty()); // fresh is current; legacy has no seed

        // Checkpoints and writes need the live lease; a crash resumes the stored progress once the lease expires.
        assertFalse(repository.upgradeCheckpoint("alpha", second, Map.of("records", "DONE"), now + 600_000, now));
        assertTrue(repository.upgradeCheckpoint("alpha", first, Map.of("records", "DONE"), now + 600_000, now));
        assertTrue(repository.holdsUpgrade("alpha", first, now)); assertFalse(repository.holdsUpgrade("alpha", first, now + 600_001));
        var resumed = repository.claimUpgrade(2, third, now + 1_200_000, now + 600_001).orElseThrow();
        assertEquals("alpha", resumed.get("tenantId")); assertEquals(Map.of("records", "DONE"), resumed.get("progress"));
        assertFalse("the expired holder lost its lease", repository.holdsUpgrade("alpha", first, now + 600_001));

        // A failure releases the lease and backs off; the row is not claimable until the retry is due.
        assertFalse(repository.retryUpgrade("beta", second, "PROVISIONING_UNAVAILABLE", true, "records:masters", 30, now));
        assertEquals("PROVISIONING_UNAVAILABLE", jdbc.queryForObject("SELECT upgrade_error_code FROM eg_pgr_onboarding_workspace WHERE tenant_id='beta'", String.class));
        assertTrue(repository.claimUpgrade(2, UUID.randomUUID(), now + 600_000, now + 500).isEmpty());
        assertEquals("beta", repository.claimUpgrade(2, second, now + 600_000, now + 1_000).orElseThrow().get("tenantId"));

        // Finishing bumps seed_version and records one event, only for the lease holder; the workspace version is untouched.
        long version = (Long) repository.find("alpha", false).orElseThrow().get("version");
        assertFalse(repository.finishUpgrade("alpha", first, "2", Map.of("from", "1"), now + 600_002));
        assertTrue(repository.finishUpgrade("alpha", third, "2", Map.of("from", "1", "to", "2"), now + 600_002));
        var alpha = repository.find("alpha", false).orElseThrow(); assertEquals("2", alpha.get("seedVersion")); assertEquals(version, alpha.get("version"));
        assertEquals(1, (int) jdbc.queryForObject("SELECT count(*) FROM eg_pgr_onboarding_workspace_event WHERE tenant_id='alpha' AND event_type='SEED_UPGRADED' AND details->>'to'='2'", Integer.class));
        assertEquals("beta's lease expired; alpha is done", "beta", repository.claimUpgrade(2, UUID.randomUUID(), now + 1_300_000, now + 700_000).orElseThrow().get("tenantId"));
        assertEquals("1", jdbc.queryForObject("SELECT seed_version FROM eg_pgr_onboarding_workspace WHERE tenant_id='beta'", String.class));
        assertNull(jdbc.queryForObject("SELECT seed_version FROM eg_pgr_onboarding_workspace WHERE tenant_id='legacy'", String.class));
    }

    private void upgradeColumns() {
        new ResourceDatabasePopulator(new ClassPathResource("db/migration/main/V20261005010000__onboarding_baseline_upgrade.sql"),
                new ClassPathResource("db/migration/main/V20261005020000__onboarding_baseline_upgrade_stop.sql")).execute(source);
    }

    @Test public void seedUpgradeStopsAfterRepeatedFailuresAtOnePointWithoutBlockingOthers() {
        upgradeColumns();
        for (String tenant : List.of("delta", "gamma", "omega")) {
            var signup = signup(tenant); tx.execute(s -> { onboarding.settleSignup(signup.getId(), "ACTIVE", "CONSUMED", "1", 2L); return null; });
        }
        long t = 1_000_000; UUID token = UUID.randomUUID();
        assertEquals("delta", repository.claimUpgrade(2, UUID.randomUUID(), Long.MAX_VALUE / 2, t).orElseThrow().get("tenantId")); // busy elsewhere
        assertEquals("gamma", repository.claimUpgrade(2, token, t + 600_000, t).orElseThrow().get("tenantId"));
        assertEquals("omega", repository.claimUpgrade(2, token, 300_000_000, t).orElseThrow().get("tenantId")); // its lease ends at t=3e8

        // Failures at a new point restart the count; the 30th in a row at one point stops gamma.
        assertFalse(repository.retryUpgrade("gamma", token, "MDMS_RECORD_NOT_VISIBLE", true, "records:common-masters.StateInfo:a", 30, t));
        for (int failure = 1; failure <= 30; failure++) {
            t += 7_200_000; // past the longest backoff
            assertEquals("gamma", repository.claimUpgrade(2, token, t + 600_000, t).orElseThrow().get("tenantId"));
            assertEquals(failure == 30, repository.retryUpgrade("gamma", token, "MDMS_RECORD_NOT_VISIBLE", true, "records:common-masters.StateInfo:b", 30, t));
        }
        assertEquals(Map.of("upgrade_attempts", 30, "upgrade_failed_step", "records:common-masters.StateInfo:b", "upgrade_error_code", "MDMS_RECORD_NOT_VISIBLE"),
                jdbc.queryForMap("SELECT upgrade_attempts,upgrade_failed_step,upgrade_error_code FROM eg_pgr_onboarding_workspace WHERE tenant_id='gamma'"));

        // Stopped gamma is never claimed again; omega still is. A non-retryable failure stops at once.
        t = 400_000_000;
        assertEquals("omega", repository.claimUpgrade(2, token, t + 600_000, t).orElseThrow().get("tenantId"));
        assertTrue(repository.retryUpgrade("omega", token, "SIGNUP_WRITE_SCOPE_DENIED", false, "state-info", 30, t));
        assertTrue(repository.claimUpgrade(2, token, t + 600_000, t + 100_000_000).isEmpty());

        // The documented operator reset makes gamma claimable again, with a fresh count.
        jdbc.update("UPDATE eg_pgr_onboarding_workspace SET upgrade_stopped_at=NULL, upgrade_attempts=0, upgrade_failed_step=NULL, upgrade_next_attempt_at=NULL WHERE tenant_id='gamma'");
        assertEquals("gamma", repository.claimUpgrade(2, token, t + 600_000, t).orElseThrow().get("tenantId"));
        assertFalse(repository.retryUpgrade("gamma", token, "MDMS_RECORD_NOT_VISIBLE", true, "records:common-masters.StateInfo:b", 30, t));
    }

    @Test public void authenticatedRouteResumesPartialRenameWithFreshTokenAndNeverPersistsTokens() throws Exception {
        activate(signup("example"));
        var publisher=transactional(new WorkspaceRenamePublisher(repository,gateway));
        var mvc=org.springframework.test.web.servlet.setup.MockMvcBuilders.standaloneSetup(
                new org.egov.pgr.web.controllers.WorkspaceApiController(service,publisher)).build();
        doAnswer(call->{
            Map<?,?> request=call.getArgument(3);String token=((Map<?,?>)request.get("RequestInfo")).get("authToken").toString();
            if(token.equals("expired-after-mdms"))throw new ResponseStatusException(org.springframework.http.HttpStatus.UNAUTHORIZED,"WORKSPACE_AUTH_REQUIRED");
            assertEquals("fresh-caller-token",token);return null;
        }).when(gateway).renameLocale(eq("example"),eq("New Name"),eq("hi_IN"),any());
        var request=new LinkedHashMap<>(rename("example","New Name",1));
        request.put("RequestInfo",Map.of("authToken","expired-after-mdms"));
        mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post("/v2/onboarding/workspaces/_rename")
                .contentType("application/json").content(mapper.writeValueAsString(request)))
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.status().isUnauthorized());
        assertEquals(List.of("MDMS","LOCALE:en_IN"),repository.rename("example",1L).orElseThrow().get("progress"));
        assertEquals(2,count("eg_pgr_onboarding_workspace_name"));
        service.update(update("example",2)); // Setup has advanced version; replay must still use the original 1.
        clearInvocations(gateway);
        service.search(Map.of("tenantId","example","RequestInfo",Map.of("authToken","fresh-caller-token")));
        verify(gateway,never()).renameMdms(any(),any(),any());verify(gateway,never()).renameLocale(any(),any(),any(),any());verify(gateway,never()).bustCache(any(),any());
        request.put("RequestInfo",Map.of("authToken","fresh-caller-token"));
        mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post("/v2/onboarding/workspaces/_rename")
                .contentType("application/json").content(mapper.writeValueAsString(request)))
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.status().isAccepted())
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath("$.Rename.status").value("DONE"));
        verify(gateway,never()).renameMdms(any(),any(),any());verify(gateway,never()).renameLocale(eq("example"),eq("New Name"),eq("en_IN"),any());
        verify(gateway).renameLocale(eq("example"),eq("New Name"),eq("hi_IN"),argThat(r->"fresh-caller-token".equals(((Map<?,?>)r.get("RequestInfo")).get("authToken"))));
        verify(gateway).bustCache(eq("example"),argThat(r->"fresh-caller-token".equals(((Map<?,?>)r.get("RequestInfo")).get("authToken"))));
        assertEquals(1,count("eg_pgr_onboarding_workspace_rename"));assertEquals(3L,repository.find("example",false).orElseThrow().get("version"));
        for(String table:List.of("eg_pgr_onboarding_workspace","eg_pgr_onboarding_workspace_rename","eg_pgr_onboarding_workspace_event","eg_pgr_onboarding_workspace_name")) {
            String stored=jdbc.queryForList("SELECT row_to_json(t)::text FROM "+table+" t",String.class).toString();
            assertFalse(stored.contains("expired-after-mdms"));assertFalse(stored.contains("fresh-caller-token"));assertFalse(stored.contains("authToken"));
        }
        for(var method:WorkspaceRenamePublisher.class.getDeclaredMethods())assertNull(method.getAnnotation(org.springframework.scheduling.annotation.Scheduled.class));
    }

}
