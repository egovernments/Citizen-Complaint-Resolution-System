package org.egov.pgr.onboarding;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.egov.pgr.web.controllers.OnboardingApiController;
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
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import java.util.*;
import static org.junit.Assert.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** Executed with -Donboarding.test.jdbc=jdbc:postgresql://127.0.0.1:16432/onboarding_test. */
public class OnboardingPostgresTest {
    private DriverManagerDataSource source;
    private JdbcTemplate jdbc;
    private OnboardingRepository repository;
    private ObjectMapper mapper=new ObjectMapper();private PlatformBaseline seed;
    private String schema;
    private OnboardingSignup signup;
    @Before public void setup() throws Exception {
        String url=System.getProperty("onboarding.test.jdbc");Assume.assumeNotNull(url);
        schema="onb_test_"+UUID.randomUUID().toString().replace("-","");
        var admin=new DriverManagerDataSource(url,"postgres","onboarding-test-only");new JdbcTemplate(admin).execute("CREATE SCHEMA "+schema);
        source=new DriverManagerDataSource(url+"?currentSchema="+schema,"postgres","onboarding-test-only");
        jdbc=new JdbcTemplate(source);repository=new OnboardingRepository(jdbc,mapper);seed=new PlatformBaseline(mapper);
        var migrations=new ResourceDatabasePopulator();
        for(String name:List.of("V20260914000000__create_onboarding_tables.sql","V20260914120000__add_onboarding_operation_lease.sql",
                "V20260918000000__onboarding_create_idempotency_per_subject.sql","V20261004000000__onboarding_restart_and_publication.sql","V20261004010000__onboarding_workspace.sql","V20261005000000__onboarding_automatic_retry.sql"))migrations.addScript(new ClassPathResource("db/migration/main/"+name));
        migrations.execute(source);
        // Dollar-quoted migration must run as one statement on the same transaction connection.
        String normalization;
        try(var input=new ClassPathResource("db/migration/main/V20261004020000__workspace_name_normalization.sql").getInputStream()) {
            normalization=new String(input.readAllBytes(),java.nio.charset.StandardCharsets.UTF_8);
        }
        new TransactionTemplate(new DataSourceTransactionManager(source)).execute(tx->{jdbc.execute(normalization);return null;});
        signup=OnboardingSignup.builder().id(UUID.randomUUID()).ownerIssuer("issuer").ownerSubject("founder").status("DRAFT").accountName("Example")
                .accountCode("EXAMPLE").urlSlug("example").organizationAlias("example").requestedTenantId("example").countryCode("IN")
                .languages(List.of("en","hi")).timeZone("Asia/Kolkata").financialYearPolicy("APRIL").acceptedTermsVersion("1")
                .tenantMetadata(Map.of("schemaVersion",1,"tenantAdmin",Map.of("mobileNumber","9876543210","countryCode","+91")))
                .createdAt(1L).updatedAt(1L).version(1).build();repository.insertSignup(signup,"create");
    }
    @After public void cleanup(){if(jdbc!=null)jdbc.execute("DROP SCHEMA "+schema+" CASCADE");}
    @SuppressWarnings("unchecked") private <T>T transactional(T target){var proxy=new ProxyFactory(target);proxy.setProxyTargetClass(true);proxy.addAdvice(new TransactionInterceptor(new DataSourceTransactionManager(source),new AnnotationTransactionAttributeSource()));return (T)proxy.getProxy();}
    private OnboardingLease claim(){return repository.claimOperation("test",UUID.randomUUID(),System.currentTimeMillis()+120000,System.currentTimeMillis()).orElseThrow();}
    private OnboardingOperation submit(){return repository.submit(signup,"submit",System.currentTimeMillis());}

    @Test public void expiredOrReplacedLeaseCannotCheckpointOrFinish(){
        submit();var lease=claim();var op=lease.getOperation();
        assertTrue(repository.checkpoint(op,lease.getLeaseToken(),System.currentTimeMillis()));
        assertFalse(repository.checkpoint(op,UUID.randomUUID(),System.currentTimeMillis()));
        jdbc.update("UPDATE eg_pgr_onboarding_operation SET lease_expires_at=0 WHERE id=?",op.getId());
        assertFalse(repository.finishOperation(op.getId(),lease.getLeaseToken(),"SUCCEEDED",List.of(),null,null,null,System.currentTimeMillis()));
        var next=claim();assertNotEquals(lease.getLeaseToken(),next.getLeaseToken());
        assertFalse(repository.checkpoint(op,lease.getLeaseToken(),System.currentTimeMillis()));
    }
    @Test public void terminalBeforeAnyEnsureSettlesPublicationAndRestartKeepsFounder(){
        submit();var lease=claim();var op=lease.getOperation();op.setFounderDigitUuid("founder-uuid");repository.checkpoint(op,lease.getLeaseToken(),System.currentTimeMillis());
        var worker=transactional(new OnboardingWorkerService(repository,seed,"INPUT_REJECTED"));
        worker.fail(op.getId(),lease.getLeaseToken(),false,"INPUT_REJECTED","input","FOUNDER_HRMS",List.of());
        var failed=repository.findOperation(op.getId()).orElseThrow();assertNotNull(failed.getLifecyclePublishedAt());
        assertEquals("NO_IDENTITY_SIDE_EFFECTS",jdbc.queryForObject("SELECT lifecycle_publication_reason FROM eg_pgr_onboarding_operation WHERE id=?",String.class,op.getId()));
        var service=transactional(new OnboardingService(repository,new OnboardingIdentifierService()));
        service.submit(new OnboardingPrincipal("issuer","founder","founder@example.test","Founder",true),Map.of("id",signup.getId().toString()),"resubmit");
        var restarted=repository.findOperation(op.getId()).orElseThrow();assertEquals(1,restarted.getRestartNo());assertEquals("founder-uuid",restarted.getFounderDigitUuid());
        assertNull(restarted.getLifecycleDecision());
    }
    @Test public void historicalEnsureCannotUseNoIdentitySideEffectsBypass(){
        submit();var lease=claim();var op=lease.getOperation();op.setOrganizationEnsureStarted(true);repository.checkpoint(op,lease.getLeaseToken(),System.currentTimeMillis());
        var worker=transactional(new OnboardingWorkerService(repository,seed,"INPUT_REJECTED"));worker.fail(op.getId(),lease.getLeaseToken(),false,"INPUT_REJECTED","input","BINDING",List.of());
        var failed=repository.findOperation(op.getId()).orElseThrow();assertNull(failed.getLifecyclePublishedAt());
        var tx=new TransactionTemplate(new DataSourceTransactionManager(source));
        assertThrows(RuntimeException.class,()->tx.execute(s->repository.resubmit(failed,"restart",System.currentTimeMillis())));
        assertEquals("DRAFT",repository.findSignup(signup.getId()).orElseThrow().getStatus());
        repository.acknowledgePublication(failed,System.currentTimeMillis());tx.execute(s->repository.resubmit(failed,"restart",System.currentTimeMillis()));
        var retry=claim();assertTrue(retry.getOperation().isOrganizationEnsureStarted());
        worker.fail(op.getId(),retry.getLeaseToken(),false,"INPUT_REJECTED","input","TENANT_FOUNDATION",List.of());
        assertNull(repository.findOperation(op.getId()).orElseThrow().getLifecyclePublishedAt());
    }
    @Test public void signupWorkspaceAndDecisionRollbackTogetherThenCommitTogether(){
        submit();var lease=claim();var worker=new OnboardingWorkerService(repository,seed,"");var tx=new TransactionTemplate(new DataSourceTransactionManager(source));
        assertThrows(IllegalStateException.class,()->tx.execute(s->{worker.complete(lease.getOperation().getId(),lease.getLeaseToken(),List.of("BINDING"));throw new IllegalStateException("crash");}));
        assertEquals("RUNNING",repository.findOperation(lease.getOperation().getId()).orElseThrow().getStatus());
        assertEquals(0,(int)jdbc.queryForObject("SELECT count(*) FROM eg_pgr_onboarding_workspace",Integer.class));
        tx.execute(s->{worker.complete(lease.getOperation().getId(),lease.getLeaseToken(),List.of("BINDING"));return null;});
        assertEquals("ACTIVE",repository.findSignup(signup.getId()).orElseThrow().getStatus());
        assertEquals("NOT_STARTED",jdbc.queryForObject("SELECT status FROM eg_pgr_onboarding_workspace",String.class));
        assertEquals("ACTIVE",repository.findOperation(lease.getOperation().getId()).orElseThrow().getLifecycleDecision());
    }
    @Test public void realSubmitEndpointReopensFailedBoundFounderWithSameAndChangedSlug() throws Exception{
        var service=transactional(new OnboardingService(repository,new OnboardingIdentifierService()));
        var identity=mock(IdentitySessionClient.class);when(identity.introspect(any())).thenReturn(new OnboardingPrincipal("issuer","founder","founder@example.test","Founder",true));
        when(identity.identifierAvailable(any(),any())).thenReturn(true);
        MockMvc mvc=MockMvcBuilders.standaloneSetup(new OnboardingApiController(identity,new OnboardingIdentifierService(),service)).build();
        String body=mapper.writeValueAsString(Map.of("Signup",Map.of("id",signup.getId().toString())));
        mvc.perform(post("/v2/onboarding/signups/_submit").header("Cookie","test").header("Idempotency-Key","initial").contentType("application/json").content(body)).andExpect(status().isAccepted());
        var worker=transactional(new OnboardingWorkerService(repository,seed,"INPUT_REJECTED"));var identitySteps=mock(OnboardingSteps.class);
        var publisher=transactional(new OnboardingLifecyclePublisher(repository,identitySteps));
        UUID operationId=repository.findOperationBySignup(signup.getId()).orElseThrow().getId();
        for(int restart=1;restart<=2;restart++){
            var lease=claim();var op=lease.getOperation();op.setFounderDigitUuid("same-uuid");op.setOrganizationEnsureStarted(true);op.setCompletedSteps(new ArrayList<>(List.of("FOUNDER_HRMS","ORGANIZATION","MEMBERSHIP","BINDING")));
            repository.checkpoint(op,lease.getLeaseToken(),System.currentTimeMillis());worker.fail(op.getId(),lease.getLeaseToken(),false,"INPUT_REJECTED","input","AFTER_BINDING",op.getCompletedSteps());
            publisher.publishPending();
            if(restart==2)mvc.perform(post("/v2/onboarding/signups/_update").header("Cookie","test").contentType("application/json")
                    .content(mapper.writeValueAsString(Map.of("Signup",Map.of("id",signup.getId().toString(),"urlSlug","renamed-example"))))).andExpect(status().isOk());
            mvc.perform(post("/v2/onboarding/signups/_submit").header("Cookie","test").header("Idempotency-Key","restart-"+restart).contentType("application/json").content(body)).andExpect(status().isAccepted());
            var current=repository.findOperation(operationId).orElseThrow();assertEquals(restart,current.getRestartNo());assertEquals("same-uuid",current.getFounderDigitUuid());assertTrue(current.getCompletedSteps().isEmpty());
            assertEquals("example",repository.findSignup(signup.getId()).orElseThrow().getRequestedTenantId());
        }
        assertEquals("renamed-example",repository.findSignup(signup.getId()).orElseThrow().getUrlSlug());
    }
    @Test public void actualBffBoundFounderRestartCollisionAndCrashBeforeAcknowledgement() throws Exception {
        String base=System.getProperty("onboarding.test.bff");Assume.assumeNotNull(base);
        var http=new org.springframework.web.client.RestTemplate();
        String uniqueTenant="recovery"+signup.getId().toString().replaceAll("[^a-f]","");
        signup.setRequestedTenantId(uniqueTenant);signup.setUrlSlug(uniqueTenant);signup.setOrganizationAlias(uniqueTenant);signup.setAccountCode(uniqueTenant.toUpperCase());signup.setAccountName(uniqueTenant);
        jdbc.update("UPDATE eg_pgr_onboarding_signup SET requested_tenant_id=?,url_slug=?,organization_alias=?,account_code=?,account_name=? WHERE id=?",uniqueTenant,uniqueTenant,uniqueTenant,signup.getAccountCode(),uniqueTenant,signup.getId());
        Map<?,?> person=http.postForObject(base+"/__fixture/person",Map.of("tenantId",signup.getRequestedTenantId()),Map.class);
        String subject=person.get("subject").toString(),uuid=person.get("uuid").toString();
        jdbc.update("UPDATE eg_pgr_onboarding_signup SET owner_subject=? WHERE id=?",subject,signup.getId());signup.setOwnerSubject(subject);
        var service=transactional(new OnboardingService(repository,new OnboardingIdentifierService()));
        var auth=mock(IdentitySessionClient.class);when(auth.introspect(any())).thenReturn(new OnboardingPrincipal("issuer",subject,"founder@example.test","Founder",true));when(auth.identifierAvailable(any(),any())).thenReturn(true);
        MockMvc mvc=MockMvcBuilders.standaloneSetup(new OnboardingApiController(auth,new OnboardingIdentifierService(),service)).build();
        String body=mapper.writeValueAsString(Map.of("Signup",Map.of("id",signup.getId().toString())));
        var env=new org.springframework.mock.env.MockEnvironment().withProperty("pgr.onboarding.identity-bff.url",base).withProperty("pgr.onboarding.identity-bff.token","pgr-fixture-token");
        var client=new OnboardingProvisionerClient(http,mapper,env);
        var realSteps=new OnboardingSteps(client,new PlatformBaseline(mapper),mapper);
        var worker=transactional(new OnboardingWorkerService(repository,seed,"INPUT_REJECTED,SLUG_TAKEN"));
        var publisher=transactional(new OnboardingLifecyclePublisher(repository,realSteps));
        for(int restart=0;restart<=1;restart++) {
            mvc.perform(post("/v2/onboarding/signups/_submit").header("Cookie","test").header("Idempotency-Key","attempt-"+restart).contentType("application/json").content(body)).andExpect(status().isAccepted());
            var lease=claim();var op=lease.getOperation();assertEquals(restart,op.getRestartNo());op.setFounderDigitUuid(uuid);
            var currentSignup=repository.findSignup(signup.getId()).orElseThrow();var progress=new OnboardingProgress(repository,op,lease.getLeaseToken());
            for(String step:List.of("ORGANIZATION","MEMBERSHIP","BINDING"))realSteps.perform(step,currentSignup,op,progress);
            worker.fail(op.getId(),lease.getLeaseToken(),false,"INPUT_REJECTED","input","AFTER_BINDING",List.of("BINDING"));publisher.publishPending();
            assertNotNull(repository.findOperation(op.getId()).orElseThrow().getLifecyclePublishedAt());
        }
        mvc.perform(post("/v2/onboarding/signups/_update").header("Cookie","test").contentType("application/json").content(mapper.writeValueAsString(Map.of("Signup",Map.of("id",signup.getId().toString(),"urlSlug",uniqueTenant+"-changed"))))).andExpect(status().isOk());
        mvc.perform(post("/v2/onboarding/signups/_submit").header("Cookie","test").header("Idempotency-Key","attempt-2").contentType("application/json").content(body)).andExpect(status().isAccepted());
        var lease=claim();var op=lease.getOperation();assertEquals(2,op.getRestartNo());assertEquals(uuid,op.getFounderDigitUuid());
        var currentSignup=repository.findSignup(signup.getId()).orElseThrow();
        http.postForObject(base+"/__fixture/collision",Map.of("count",2),Map.class);
        OnboardingFailure collision=assertThrows(OnboardingFailure.class,()->realSteps.perform("ORGANIZATION",currentSignup,op,new OnboardingProgress(repository,op,lease.getLeaseToken())));
        assertEquals("SLUG_TAKEN",collision.getCode());worker.fail(op.getId(),lease.getLeaseToken(),false,collision.getCode(),"collision","ORGANIZATION",List.of());
        OnboardingRepository crashRepository=spy(repository);
        doThrow(new IllegalStateException("crash after BFF publication before PGR acknowledgement")).when(crashRepository).acknowledgePublication(any(),anyLong());
        var crashing=transactional(new OnboardingLifecyclePublisher(crashRepository,realSteps));assertThrows(IllegalStateException.class,crashing::publishPending);
        assertNull(repository.findOperation(op.getId()).orElseThrow().getLifecyclePublishedAt());
        OnboardingFailure terminal=assertThrows(OnboardingFailure.class,()->realSteps.ensureOrganization(currentSignup,repository.findOperation(op.getId()).orElseThrow()));assertEquals("LIFECYCLE_CONFLICT",terminal.getCode());
        publisher.publishPending();assertNotNull(repository.findOperation(op.getId()).orElseThrow().getLifecyclePublishedAt());
        mvc.perform(post("/v2/onboarding/signups/_submit").header("Cookie","test").header("Idempotency-Key","attempt-3").contentType("application/json").content(body)).andExpect(status().isAccepted());
        var resumed=claim();var latest=resumed.getOperation();assertEquals(3,latest.getRestartNo());assertEquals(uuid,latest.getFounderDigitUuid());
        var progress=new OnboardingProgress(repository,latest,resumed.getLeaseToken());
        for(String step:List.of("ORGANIZATION","MEMBERSHIP","BINDING"))realSteps.perform(step,repository.findSignup(signup.getId()).orElseThrow(),latest,progress);
        worker.complete(latest.getId(),resumed.getLeaseToken(),List.of("BINDING"));publisher.publishPending();
        assertEquals("ACTIVE",repository.findSignup(signup.getId()).orElseThrow().getStatus());assertNotNull(repository.findOperation(latest.getId()).orElseThrow().getLifecyclePublishedAt());
        assertEquals("ATTEMPT_STALE",assertThrows(OnboardingFailure.class,()->client.identity("organizations/_lifecycle",Map.of("operationId",op.getId().toString(),"restartNo",2,"state","FAILED"))).getCode());
        var state=http.postForObject(base+"/__fixture/state",Map.of("subject",subject),com.fasterxml.jackson.databind.JsonNode.class);
        assertEquals(1,state.path("bindings").size());assertEquals(uuid,state.path("bindings").path(0).path("uuid").asText());
    }
    @Test public void retryableFailureBecomesClaimableWithoutManualRetry() {
        submit();long now=System.currentTimeMillis();
        var lease=repository.claimOperation("first",UUID.randomUUID(),now+120000,now).orElseThrow();
        assertTrue(repository.finishOperation(lease.getOperation().getId(),lease.getLeaseToken(),"RETRYABLE_FAILED",List.of(),"PLATFORM_BASELINE","MDMS_RECORD_NOT_VISIBLE","wait",now));
        assertTrue(repository.claimOperation("automatic",UUID.randomUUID(),now+240000,now+120000).isPresent());
    }
    private int retryCount(UUID id) { return jdbc.queryForObject("SELECT retry_count FROM eg_pgr_onboarding_operation WHERE id=?",Integer.class,id); }
    private Long retryAt(UUID id) { return jdbc.queryForObject("SELECT next_retry_at FROM eg_pgr_onboarding_operation WHERE id=?",Long.class,id); }
    private void failRetry(OnboardingLease lease,long now) {
        var op=lease.getOperation();assertTrue(repository.finishOperation(op.getId(),lease.getLeaseToken(),"RETRYABLE_FAILED",op.getCompletedSteps(),"PLATFORM_BASELINE","MDMS_RECORD_NOT_VISIBLE","wait",now));
    }
    @Test public void retryBackoffIsDueBoundedAndManualRecoveryKeepsAttemptIdentity() {
        var original=submit();long now=System.currentTimeMillis();
        for(int failure=1;failure<=12;failure++) {
            var lease=repository.claimOperation("worker",UUID.randomUUID(),now+120000,now).orElseThrow();
            assertEquals(original.getId(),lease.getOperation().getId());assertEquals(0,lease.getOperation().getRestartNo());
            assertEquals(failure,lease.getOperation().getAttempt());failRetry(lease,now);assertEquals(failure,retryCount(original.getId()));
            if(failure<12) {
                long due=now+Math.min(60000,1000L << Math.min(failure-1,6));assertEquals(Long.valueOf(due),retryAt(original.getId()));
                assertTrue(repository.claimOperation("early",UUID.randomUUID(),due+120000,due-1).isEmpty());now=due;
            }
        }
        assertNull(retryAt(original.getId()));assertTrue(repository.claimOperation("late",UUID.randomUUID(),now+1000000,now+900000).isEmpty());
        var exhausted=repository.findOperation(original.getId()).orElseThrow();assertEquals("RETRYABLE_FAILED",exhausted.getStatus());
        assertNull(exhausted.getLifecycleDecision());assertEquals("PROVISIONING",repository.findSignup(signup.getId()).orElseThrow().getStatus());
        repository.retry(exhausted,now);assertEquals(0,retryCount(original.getId()));
        var manual=repository.claimOperation("manual",UUID.randomUUID(),now+120000,now).orElseThrow();assertEquals(13,manual.getOperation().getAttempt());assertEquals(0,manual.getOperation().getRestartNo());
    }
    @Test public void onlyNewDurableRecordOrStepCompletionResetsRetryBudget() {
        var original=submit();long now=System.currentTimeMillis();var first=repository.claimOperation("first",UUID.randomUUID(),now+120000,now).orElseThrow();failRetry(first,now);
        now+=1000;var second=repository.claimOperation("second",UUID.randomUUID(),now+120000,now).orElseThrow();var op=second.getOperation();
        repository.checkpoint(op,second.getLeaseToken(),now);assertEquals(1,retryCount(op.getId()));
        op.getRecordProgress().put("first","STARTED");repository.checkpoint(op,second.getLeaseToken(),now);assertEquals(1,retryCount(op.getId()));
        op.getRecordProgress().put("first","DONE");repository.checkpoint(op,second.getLeaseToken(),now);assertEquals(0,retryCount(op.getId()));
        failRetry(second,now);now+=1000;var third=repository.claimOperation("third",UUID.randomUUID(),now+120000,now).orElseThrow();op=third.getOperation();
        repository.checkpoint(op,third.getLeaseToken(),now);assertEquals(1,retryCount(op.getId()));
        op.getRecordProgress().put("second","STARTED");repository.checkpoint(op,third.getLeaseToken(),now);assertEquals(1,retryCount(op.getId()));
        op.getCompletedSteps().add("TENANT_FOUNDATION");repository.checkpoint(op,third.getLeaseToken(),now);assertEquals(0,retryCount(op.getId()));
        failRetry(third,now);assertEquals(Long.valueOf(now+1000),retryAt(original.getId()));
    }
    @Test public void concurrentAutomaticClaimsHaveOneLeaseWinner() throws Exception {
        submit();long now=System.currentTimeMillis();var first=repository.claimOperation("first",UUID.randomUUID(),now+120000,now).orElseThrow();failRetry(first,now);
        var pool=java.util.concurrent.Executors.newFixedThreadPool(2);var start=new java.util.concurrent.CountDownLatch(1);
        try {
            java.util.concurrent.Callable<Optional<OnboardingLease>> attempt=()->{start.await();return repository.claimOperation("racer",UUID.randomUUID(),now+121000,now+1000);};
            var a=pool.submit(attempt);var b=pool.submit(attempt);start.countDown();var left=a.get();var right=b.get();assertNotEquals(left.isPresent(),right.isPresent());
            assertFalse(repository.checkpoint(first.getOperation(),first.getLeaseToken(),now+1000));
        } finally {pool.shutdownNow();}
    }

    @Test public void trustedVerifiedEmailFlowsThroughHttpControllerDatabaseAndHrms() throws Exception { founderEmailFlow(true); }
    @Test public void retryRefreshesTrustedFounderEmailBeforeHrmsWithoutReplacingIdentity() throws Exception { founderEmailFlow(false); }
    private void founderEmailFlow(boolean initiallyVerified) throws Exception {
        var verified=new java.util.concurrent.atomic.AtomicBoolean(initiallyVerified);
        var email=new java.util.concurrent.atomic.AtomicReference<>("trusted@example.test");
        var employee=new java.util.concurrent.atomic.AtomicReference<com.fasterxml.jackson.databind.JsonNode>();
        var cookie=new java.util.concurrent.atomic.AtomicReference<String>();var authorization=new java.util.concurrent.atomic.AtomicReference<String>();
        var server=com.sun.net.httpserver.HttpServer.create(new java.net.InetSocketAddress("127.0.0.1",0),0);
        server.createContext("/",exchange->{
            Object response;String path=exchange.getRequestURI().getPath();
            if(path.endsWith("/_introspect")) {
                cookie.set(exchange.getRequestHeaders().getFirst("Cookie"));authorization.set(exchange.getRequestHeaders().getFirst("Authorization"));
                response=Map.of("identity",Map.of("issuer","issuer","subject","founder","name","Trusted Founder","email",email.get(),"emailVerified",verified.get()));
            } else if(path.endsWith("/_check")) response=Map.of("available",true);
            else if(path.endsWith("/_details")) response=Map.of("UserRequest",Map.of("uuid","provisioner","userName","fixture","tenantId","pg","type","EMPLOYEE","active",true,"roles",List.of("MDMS_ADMIN","ACCOUNT_ADMIN","LOC_ADMIN","HRMS_ADMIN").stream().map(role->Map.of("code",role,"tenantId","pg")).toList()));
            else if(path.endsWith("/oauth/token")) response=Map.of("access_token","fixture-token","UserRequest",Map.of("uuid","provisioner"));
            else if(path.endsWith("/_create")) {
                var created=mapper.readTree(exchange.getRequestBody()).path("Employees").path(0).deepCopy();
                ((com.fasterxml.jackson.databind.node.ObjectNode)created.path("user")).put("uuid","stable-founder");employee.set(created);response=Map.of("Employees",List.of(created));
            } else response=Map.of("Employees",employee.get()==null?List.of():List.of(employee.get()));
            byte[] bytes=mapper.writeValueAsBytes(response);exchange.getResponseHeaders().set("Content-Type","application/json");exchange.sendResponseHeaders(200,bytes.length);exchange.getResponseBody().write(bytes);exchange.close();
        });server.start();
        try {
            String base="http://127.0.0.1:"+server.getAddress().getPort();var http=new org.springframework.web.client.RestTemplate();
            var auth=new IdentitySessionClient(http,base,"fixture-workload-token");var service=transactional(new OnboardingService(repository,new OnboardingIdentifierService()));
            var mvc=MockMvcBuilders.standaloneSetup(new OnboardingApiController(auth,new OnboardingIdentifierService(),service)).build();
            String submitBody=mapper.writeValueAsString(Map.of("Signup",Map.of("id",signup.getId().toString(),"founderEmail","forged@example.test","founderEmailVerified",true)));
            mvc.perform(post("/v2/onboarding/signups/_submit").header("Cookie","identity=fixture").header("Idempotency-Key","email-submit").contentType("application/json").content(submitBody)).andExpect(status().isAccepted());
            assertEquals("identity=fixture",cookie.get());assertEquals("Bearer fixture-workload-token",authorization.get());
            var snapshot=repository.findSignup(signup.getId()).orElseThrow();assertEquals(initiallyVerified,snapshot.isFounderEmailVerified());assertEquals(initiallyVerified?email.get():null,snapshot.getFounderEmail());
            var operation=repository.findOperationBySignup(signup.getId()).orElseThrow();
            if(!initiallyVerified) {
                var lease=claim();failRetry(lease,System.currentTimeMillis());verified.set(true);
                mvc.perform(post("/v2/onboarding/operations/_retry").header("Cookie","identity=fixture").contentType("application/json").content(mapper.writeValueAsString(Map.of("Operation",Map.of("id",operation.getId().toString(),"founderEmail","forged@example.test"))))).andExpect(status().isAccepted());
                snapshot=repository.findSignup(signup.getId()).orElseThrow();assertTrue(snapshot.isFounderEmailVerified());assertEquals(email.get(),snapshot.getFounderEmail());
            }
            var env=new org.springframework.mock.env.MockEnvironment().withProperty("egov.user.host",base).withProperty("egov.hrms.host",base)
                    .withProperty("pgr.onboarding.provisioner.username","fixture").withProperty("pgr.onboarding.provisioner.password","fixture-only").withProperty("pgr.onboarding.provisioner.tenant-id","pg");
            var steps=new OnboardingSteps(new OnboardingProvisionerClient(http,mapper,env),new PlatformBaseline(mapper),mapper);
            var lease=claim();lease.getOperation().setCurrentStep("FOUNDER_HRMS");repository.checkpoint(lease.getOperation(),lease.getLeaseToken(),System.currentTimeMillis());steps.perform("FOUNDER_HRMS",snapshot,lease.getOperation(),new OnboardingProgress(repository,lease.getOperation(),lease.getLeaseToken()));
            assertEquals("trusted@example.test",employee.get().path("user").path("emailId").asText());assertFalse(employee.get().path("user").has("password"));
            failRetry(lease,System.currentTimeMillis());verified.set(false);email.set("unverified-change@example.test");
            mvc.perform(post("/v2/onboarding/operations/_retry").header("Cookie","identity=fixture").contentType("application/json").content(mapper.writeValueAsString(Map.of("Operation",Map.of("id",operation.getId().toString()))))).andExpect(status().isAccepted());
            var same=repository.findOperation(operation.getId()).orElseThrow();assertEquals("stable-founder",same.getFounderDigitUuid());assertEquals(0,same.getRestartNo());
            var refreshed=repository.findSignup(signup.getId()).orElseThrow();assertFalse(refreshed.isFounderEmailVerified());assertNull(refreshed.getFounderEmail());
            var last=claim();failRetry(last,System.currentTimeMillis());verified.set(true);email.set("");
            mvc.perform(post("/v2/onboarding/operations/_retry").header("Cookie","identity=fixture").contentType("application/json").content(mapper.writeValueAsString(Map.of("Operation",Map.of("id",operation.getId().toString()))))).andExpect(status().isAccepted());
            var missing=repository.findSignup(signup.getId()).orElseThrow();assertFalse(missing.isFounderEmailVerified());assertNull(missing.getFounderEmail());
        } finally {server.stop(0);}
    }

    @Test @SuppressWarnings("unchecked") public void delayedMdmsProjectionAutomaticallyCompletesBeyondOneRetryBudget() throws Exception {
        // Small seed exercises the real six-step runner and durable record checkpoints.
        var baseline=spy(new PlatformBaseline(mapper));var records=mapper.createArrayNode();
        for(int i=0;i<15;i++) records.add(mapper.valueToTree(Map.of("schemaCode","test.Record","uniqueIdentifier","record"+i,"data",Map.of("code","record"+i))));
        doReturn(records).when(baseline).records();
        doReturn(mapper.valueToTree(List.of(Map.of("code","tenant.tenants"),Map.of("code","test.Record")))).when(baseline).schemas();
        var client=mock(OnboardingProvisionerClient.class);Map<String,Object> stored=new HashMap<>();Set<String> hidden=new HashSet<>();
        org.mockito.stubbing.Answer<com.fasterxml.jackson.databind.JsonNode> api=call->{
            int offset=call.getMethod().getName().equals("write")?1:0;
            String service=call.getArgument(offset),path=call.getArgument(offset+1);Map<String,Object> body=call.getArgument(offset+2);
            if(service.equals("mdms")) {
                if(path.contains("schema/v1/_search")) return mapper.valueToTree(Map.of("SchemaDefinitions",List.of(Map.of("code","present"))));
                if(path.contains("/v2/_search")) {
                    var criteria=(Map<String,Object>)body.get("MdmsCriteria");var ids=(List<String>)criteria.get("uniqueIdentifiers");
                    String key=criteria.get("tenantId")+"|"+criteria.get("schemaCode")+"|"+(ids==null?"":ids.get(0));
                    return mapper.valueToTree(Map.of("mdms",hidden.remove(key)||!stored.containsKey(key)?List.of():List.of(stored.get(key))));
                }
                var record=(Map<String,Object>)body.get("Mdms");String key=record.get("tenantId")+"|"+record.get("schemaCode")+"|"+record.get("uniqueIdentifier");
                assertFalse("projection recovery must search before another create",stored.containsKey(key));stored.put(key,record);hidden.add(key);return mapper.createObjectNode();
            }
            if(service.equals("hrms")) return mapper.valueToTree(Map.of("Employees",List.of(Map.of("user",Map.of("uuid","stable-founder")))));
            // The baseline seeds the PGR workflow: a search finds none, the accepted create is the checkpoint.
            if(service.equals("workflow")) return path.contains("_search")?mapper.valueToTree(Map.of("BusinessServices",List.of())):mapper.createObjectNode();
            if(service.equals("boundary")) return mapper.valueToTree(Map.of("BoundaryHierarchy",List.of(Map.of("hierarchyType",OnboardingSteps.WORKSPACE_HIERARCHY)),"Boundary",List.of(Map.of("code","example")),"TenantBoundary",List.of(Map.of("tenantId","example","hierarchyType",OnboardingSteps.WORKSPACE_HIERARCHY,"boundary",List.of(Map.of("code","example","boundaryType","ROOT"))))));
            return mapper.createObjectNode();
        };
        when(client.read(anyString(),anyString(),anyMap())).thenAnswer(api);
        when(client.write(any(),anyString(),anyString(),anyMap())).thenAnswer(api);
        var realSteps=new OnboardingSteps(client,baseline,mapper);var worker=transactional(new OnboardingWorkerService(repository,seed,"COUNTRY_NOT_SUPPORTED"));
        var publisher=transactional(new OnboardingLifecyclePublisher(repository,realSteps));var runner=new OnboardingRunner(worker,repository,realSteps,publisher);
        var original=submit();int retries=0;
        for(int ticks=0;ticks<30;ticks++) {
            runner.tick();var op=repository.findOperation(original.getId()).orElseThrow();
            if("SUCCEEDED".equals(op.getStatus())) break;
            assertEquals("RETRYABLE_FAILED",op.getStatus());assertNotNull(retryAt(op.getId()));assertTrue(retryCount(op.getId())<12);retries++;
            // Advance the due time deterministically; no user/manual retry endpoint.
            jdbc.update("UPDATE eg_pgr_onboarding_operation SET next_retry_at=0 WHERE id=?",op.getId());
        }
        var finished=repository.findOperation(original.getId()).orElseThrow();assertTrue(retries>12);assertEquals("SUCCEEDED",finished.getStatus());assertEquals(0,finished.getRestartNo());
        assertEquals("stable-founder",finished.getFounderDigitUuid());assertEquals(OnboardingRunner.STEPS,finished.getCompletedSteps());
        assertEquals("ACTIVE",repository.findSignup(signup.getId()).orElseThrow().getStatus());
    }

    @Test public void workerWinningClaimPreventsRetryFromChangingItsFounderSnapshot() {
        repository.snapshotFounder(signup.getId(),new OnboardingPrincipal("issuer","founder","original@example.test","Founder",true));
        var op=submit();var first=claim();failRetry(first,System.currentTimeMillis());
        jdbc.update("UPDATE eg_pgr_onboarding_operation SET next_retry_at=0 WHERE id=?",op.getId());claim();
        var service=transactional(new OnboardingService(repository,new OnboardingIdentifierService()));
        assertThrows(org.egov.tracer.model.CustomException.class,()->service.retry(new OnboardingPrincipal("issuer","founder","changed@example.test","Founder",true),Map.of("id",op.getId().toString())));
        assertEquals("original@example.test",repository.findSignup(signup.getId()).orElseThrow().getFounderEmail());
    }

    @Test public void signupWriteScopeUsesPersistedTenantStepRestartAndCurrentLease() {
        submit();var lease=claim();var op=lease.getOperation();var progress=new OnboardingProgress(repository,op,lease.getLeaseToken());
        var valid=progress.writeScope(signup,"TENANT_FOUNDATION");valid.requireLiveLease();
        signup.setRequestedTenantId("foreign");var forgedTenant=progress.writeScope(signup,"TENANT_FOUNDATION");
        assertThrows(OnboardingFailure.class,forgedTenant::requireLiveLease);signup.setRequestedTenantId("example");
        assertThrows(OnboardingFailure.class,()->progress.writeScope(signup,"FOUNDER_HRMS").requireLiveLease());
        op.setRestartNo(99);assertThrows(OnboardingFailure.class,()->progress.writeScope(signup,"TENANT_FOUNDATION").requireLiveLease());op.setRestartNo(0);
        var stranger=new OnboardingProgress(repository,op,UUID.randomUUID()).writeScope(signup,"TENANT_FOUNDATION");assertThrows(OnboardingFailure.class,stranger::requireLiveLease);
        jdbc.update("UPDATE eg_pgr_onboarding_operation SET lease_expires_at=0 WHERE id=?",op.getId());assertThrows(OnboardingFailure.class,valid::requireLiveLease);
        var replacement=claim();assertThrows(OnboardingFailure.class,valid::requireLiveLease);
        new OnboardingProgress(repository,replacement.getOperation(),replacement.getLeaseToken()).writeScope(signup,"TENANT_FOUNDATION").requireLiveLease();
        jdbc.update("UPDATE eg_pgr_onboarding_signup SET status='ACTIVE' WHERE id=?",signup.getId());
        assertThrows(OnboardingFailure.class,()->new OnboardingProgress(repository,replacement.getOperation(),replacement.getLeaseToken()).writeScope(signup,"TENANT_FOUNDATION").requireLiveLease());
    }

}
