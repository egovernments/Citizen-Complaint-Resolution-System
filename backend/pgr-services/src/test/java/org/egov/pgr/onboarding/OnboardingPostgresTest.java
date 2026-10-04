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
    private ObjectMapper mapper=new ObjectMapper();
    private String schema;
    private OnboardingSignup signup;
    @Before public void setup(){
        String url=System.getProperty("onboarding.test.jdbc");Assume.assumeNotNull(url);
        schema="onb_test_"+UUID.randomUUID().toString().replace("-","");
        var admin=new DriverManagerDataSource(url,"postgres","onboarding-test-only");new JdbcTemplate(admin).execute("CREATE SCHEMA "+schema);
        source=new DriverManagerDataSource(url+"?currentSchema="+schema,"postgres","onboarding-test-only");
        jdbc=new JdbcTemplate(source);repository=new OnboardingRepository(jdbc,mapper);
        var migrations=new ResourceDatabasePopulator();
        for(String name:List.of("V20260914000000__create_onboarding_tables.sql","V20260914120000__add_onboarding_operation_lease.sql",
                "V20260918000000__onboarding_create_idempotency_per_subject.sql","V20261004000000__onboarding_restart_and_publication.sql","V20261004010000__onboarding_workspace.sql"))migrations.addScript(new ClassPathResource("db/migration/main/"+name));
        migrations.execute(source);
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
        var worker=transactional(new OnboardingWorkerService(repository,"INPUT_REJECTED"));
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
        var worker=transactional(new OnboardingWorkerService(repository,"INPUT_REJECTED"));worker.fail(op.getId(),lease.getLeaseToken(),false,"INPUT_REJECTED","input","BINDING",List.of());
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
        submit();var lease=claim();var worker=new OnboardingWorkerService(repository,"");var tx=new TransactionTemplate(new DataSourceTransactionManager(source));
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
        var worker=transactional(new OnboardingWorkerService(repository,"INPUT_REJECTED"));var identitySteps=mock(OnboardingSteps.class);
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
}
