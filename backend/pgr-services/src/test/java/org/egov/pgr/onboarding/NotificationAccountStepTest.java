package org.egov.pgr.onboarding;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.Before;
import org.junit.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestTemplate;

import java.util.List;
import java.util.UUID;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.content;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.header;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withServerError;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withStatus;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

/**
 * #2203: tenant creation provisions the workspace's own Novu account, and NEVER fails because of it.
 */
public class NotificationAccountStepTest {

    private final ObjectMapper mapper = new ObjectMapper();
    private OnboardingSteps steps;
    private OnboardingSignup signup;
    private OnboardingOperation op;
    private OnboardingProgress progress;
    private OnboardingRepository repository;
    private RestTemplate http;
    private MockRestServiceServer bridge;

    @Before
    public void setup() throws Exception {
        steps = new OnboardingSteps(mock(OnboardingProvisionerClient.class), new PlatformBaseline(mapper), mapper);
        signup = OnboardingSignup.builder().id(UUID.randomUUID()).requestedTenantId("newtown").build();
        op = OnboardingOperation.builder().id(UUID.randomUUID()).signupId(signup.getId())
                .currentStep(OnboardingSteps.NOTIFICATION_ACCOUNT).build();
        repository = mock(OnboardingRepository.class);
        when(repository.checkpoint(any(), any(), anyLong())).thenReturn(true);
        progress = new OnboardingProgress(repository, op, UUID.randomUUID());
        http = new RestTemplate();
        bridge = MockRestServiceServer.bindTo(http).build();
    }

    private NotificationAccountClient client(String url, String token) {
        return new NotificationAccountClient(url, token, http, mapper);
    }

    @Test
    public void theStepIsTheLastOfTheSaga() {
        assertEquals(OnboardingSteps.NOTIFICATION_ACCOUNT, OnboardingRunner.STEPS.get(OnboardingRunner.STEPS.size() - 1));
    }

    @Test
    public void aNewWorkspaceIsProvisioned_throughTheBridgesInternalApi_withItsToken() {
        bridge.expect(requestTo("http://novu-bridge:8080/novu-bridge/novu-adapter/v1/tenants/newtown/_provision"))
                .andExpect(method(HttpMethod.POST))
                .andExpect(header(NotificationAccountClient.TOKEN_HEADER, "admin-token"))
                .andRespond(withSuccess("{\"data\":{\"tenantId\":\"newtown\",\"status\":\"PROVISIONED\",\"organizationCreated\":true}}",
                        MediaType.APPLICATION_JSON));
        steps.setNotificationAccounts(client("http://novu-bridge:8080/novu-bridge/", "admin-token"));

        steps.perform(OnboardingSteps.NOTIFICATION_ACCOUNT, signup, op, progress);

        bridge.verify();
        assertEquals(OnboardingSteps.NOTIFICATION_ACCOUNT_DONE, op.getRecordProgress().get(OnboardingSteps.NOTIFICATION_ACCOUNT_PROGRESS));
    }

    @Test
    public void novuDown_neverFailsTheSignup_theAccountIsDeferred() {
        bridge.expect(requestTo("http://bridge/novu-adapter/v1/tenants/newtown/_provision"))
                .andRespond(withStatus(HttpStatus.BAD_GATEWAY).contentType(MediaType.APPLICATION_JSON)
                        .body("{\"Errors\":[{\"code\":\"NB_NOVU_UNAVAILABLE\",\"message\":\"down\"}]}"));
        steps.setNotificationAccounts(client("http://bridge", "admin-token"));

        steps.perform(OnboardingSteps.NOTIFICATION_ACCOUNT, signup, op, progress); // no exception

        assertEquals(OnboardingSteps.NOTIFICATION_ACCOUNT_DEFERRED, op.getRecordProgress().get(OnboardingSteps.NOTIFICATION_ACCOUNT_PROGRESS));
        verify(repository).checkpoint(eq(op), any(), anyLong());
    }

    @Test
    public void theBridgeUnreachable_isDeferredToo() {
        bridge.expect(requestTo("http://bridge/novu-adapter/v1/tenants/newtown/_provision")).andRespond(withServerError());
        steps.setNotificationAccounts(client("http://bridge", "admin-token"));

        steps.perform(OnboardingSteps.NOTIFICATION_ACCOUNT, signup, op, progress);

        assertEquals(OnboardingSteps.NOTIFICATION_ACCOUNT_DEFERRED, op.getRecordProgress().get(OnboardingSteps.NOTIFICATION_ACCOUNT_PROGRESS));
    }

    @Test
    public void aResumedRunAfterSuccess_doesNotCallTheBridgeAgain() {
        op.getRecordProgress().put(OnboardingSteps.NOTIFICATION_ACCOUNT_PROGRESS, OnboardingSteps.NOTIFICATION_ACCOUNT_DONE);
        steps.setNotificationAccounts(client("http://bridge", "admin-token"));

        steps.perform(OnboardingSteps.NOTIFICATION_ACCOUNT, signup, op, progress);

        bridge.verify(); // no request expected, none made
    }

    @Test
    public void notConfigured_theStepIsANoOp() {
        steps.setNotificationAccounts(client("", "admin-token"));
        steps.perform(OnboardingSteps.NOTIFICATION_ACCOUNT, signup, op, progress);
        steps.setNotificationAccounts(null);
        steps.perform(OnboardingSteps.NOTIFICATION_ACCOUNT, signup, op, progress);

        assertNull(op.getRecordProgress().get(OnboardingSteps.NOTIFICATION_ACCOUNT_PROGRESS));
        verify(repository, never()).checkpoint(any(), any(), anyLong());
    }

    @Test
    public void theClient_neverThrows_andRefusesATenantIdThatIsNotACode() {
        NotificationAccountClient client = client("http://bridge", "admin-token");
        assertFalse(client.provision("../x").ok());
        assertEquals("INVALID_TENANT", client.provision("Bad Tenant").code());
    }

    @Test
    public void theReconciler_retriesDeferredWorkspaces_andMarksTheProvisionedOnesDone() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        when(jdbc.queryForList(anyString(), eq(String.class), any(), any())).thenReturn(List.of("acme", "globex"));
        when(jdbc.update(anyString(), any(), any(), eq("acme"), any(), any())).thenReturn(1);
        bridge.expect(requestTo("http://bridge/novu-adapter/v1/tenants/_backfill"))
                .andExpect(content().json("{\"tenantIds\":[\"acme\",\"globex\"]}"))
                .andRespond(withSuccess("{\"data\":[{\"tenantId\":\"acme\",\"status\":\"PROVISIONED\"},"
                        + "{\"tenantId\":\"globex\",\"status\":\"ERROR\",\"code\":\"NB_NOVU_UNAVAILABLE\"}],\"failed\":1}",
                        MediaType.APPLICATION_JSON));
        NotificationAccountReconciler reconciler = new NotificationAccountReconciler(jdbc, client("http://bridge", "t"), 60_000);

        assertEquals(1, reconciler.reconcile());

        verify(jdbc, times(1)).update(anyString(), any(), any(), eq("acme"), any(), any());
        verify(jdbc, never()).update(anyString(), any(), any(), eq("globex"), any(), any());
    }

    @Test
    public void theReconciler_runsAtMostOncePerInterval_andNotAtAllUnconfigured() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        when(jdbc.queryForList(anyString(), eq(String.class), any(), any())).thenReturn(List.of());
        NotificationAccountReconciler reconciler = new NotificationAccountReconciler(jdbc, client("http://bridge", "t"), 60_000);
        long[] now = {1_000_000};
        reconciler.clock = () -> now[0];

        reconciler.reconcileDue();
        reconciler.reconcileDue();
        now[0] += 60_001;
        reconciler.reconcileDue();
        verify(jdbc, times(2)).queryForList(anyString(), eq(String.class), any(), any());

        NotificationAccountReconciler off = new NotificationAccountReconciler(jdbc, client("", ""), 60_000);
        off.reconcileDue();
        verify(jdbc, times(2)).queryForList(anyString(), eq(String.class), any(), any());
    }
}
