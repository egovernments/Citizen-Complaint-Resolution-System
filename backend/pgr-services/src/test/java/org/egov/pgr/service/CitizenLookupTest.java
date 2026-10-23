package org.egov.pgr.service;

import org.egov.common.contract.request.RequestInfo;
import org.egov.pgr.config.PGRConfiguration;
import org.egov.pgr.util.UserUtils;
import org.egov.pgr.web.models.Service;
import org.egov.pgr.web.models.ServiceRequest;
import org.egov.pgr.web.models.User;
import org.egov.pgr.web.models.user.CreateUserRequest;
import org.egov.pgr.web.models.user.UserDetailResponse;
import org.egov.pgr.web.models.user.UserSearchRequest;
import org.junit.Before;
import org.junit.Test;

import java.util.ArrayList;
import java.util.List;

import static org.junit.Assert.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * An employee-filed complaint resolves its citizen by userName = mobileNumber first, then by
 * the one identity-bff citizen account holding the number (#2640), and creates one otherwise.
 * Any other citizen found merely by mobile number (#2167) is never attached, and no existing
 * account is ever renamed.
 */
public class CitizenLookupTest {
    private static final String MOBILE = "9876543210";
    private static final String MARKER = "keycloak-bff:citizen:v1:0f1e2d:test";

    private UserUtils utils;
    private PGRConfiguration config;
    private final RequestInfo info = new RequestInfo();
    private final List<Object> calls = new ArrayList<>();
    private List<User> byUserName;
    private List<User> byMobile = List.of();
    private final User created = User.builder().uuid("created").userName(MOBILE).mobileNumber(MOBILE).name("Victim").build();

    @Before
    public void setUp() {
        utils = mock(UserUtils.class);
        config = mock(PGRConfiguration.class);
        when(config.getUserHost()).thenReturn("http://user");
        when(config.getUserContextPath()).thenReturn("/user");
        when(config.getUserSearchEndpoint()).thenReturn("/_search");
        when(config.getUserCreateEndpoint()).thenReturn("/users/_createnovalidate");
        when(config.getUserUpdateEndpoint()).thenReturn("/users/_updatenovalidate");
        when(utils.getStateLevelTenant("test")).thenReturn("test");
        when(utils.userCall(any(), any())).thenAnswer(call -> {
            Object body = call.getArgument(0);
            calls.add(body);
            if (body instanceof UserSearchRequest search) {
                assertSame(info, search.getRequestInfo());
                assertEquals("test", search.getTenantId());
                assertEquals("CITIZEN", search.getUserType());
                assertEquals(Boolean.TRUE, search.getActive());
                if (search.getMobileNumber() != null) {
                    assertEquals(MOBILE, search.getMobileNumber());
                    assertNull("the number is matched by egov-user, never by userName", search.getUserName());
                    return new UserDetailResponse(null, byMobile);
                }
                assertEquals(MOBILE, search.getUserName());
                return new UserDetailResponse(null, byUserName);
            }
            assertTrue(body instanceof CreateUserRequest);
            assertEquals("http://user/user/users/_createnovalidate", call.getArgument(1).toString());
            return new UserDetailResponse(null, List.of(created));
        });
    }

    private ServiceRequest fileFor(String name) {
        ServiceRequest request = ServiceRequest.builder().requestInfo(info).service(Service.builder()
                .tenantId("test").citizen(User.builder().mobileNumber(MOBILE).name(name).build()).build()).build();
        new UserService(utils, config).callUserService(request);
        return request;
    }

    /** An identity-bff citizen account as egov-user returns it; the mobile may come back masked. */
    private static User bffCitizen(String uuid) {
        return User.builder().uuid(uuid).userName("kcbffc-" + uuid).mobileNumber("******3210").name("Citizen")
                .active(true).identificationMark(MARKER).build();
    }

    private long creates() {
        return calls.stream().filter(call -> call instanceof CreateUserRequest).count();
    }

    // #2640: the citizen signed in by phone OTP before any complaint for their number, so their
    // only account is the BFF's kcbffc-… one, and their token covers only it.
    @Test
    public void theOneBffCitizenWithTheNumberIsUsed() {
        byUserName = List.of();
        User account = bffCitizen("bff-citizen");
        byMobile = List.of(account);
        ServiceRequest request = fileFor("Someone Else");
        assertEquals("bff-citizen", request.getService().getAccountId());
        assertEquals(0, creates());
        assertEquals("the account is never renamed", "Citizen", account.getName());
        assertEquals(2, calls.size());
    }

    @Test
    public void noBffCitizenCreatesTheAccount() {
        byUserName = List.of();
        User inactive = bffCitizen("inactive");
        inactive.setActive(false);
        byMobile = List.of(inactive);
        assertEquals("created", fileFor("Victim").getService().getAccountId());
        assertEquals(1, creates());
        verify(utils).addUserDefaultFields(eq(MOBILE), eq("test"), any());
    }

    @Test
    public void severalBffCitizensWithTheNumberCreateTheAccount() {
        byUserName = List.of();
        byMobile = List.of(bffCitizen("bff-a"), bffCitizen("bff-b"));
        assertEquals("ambiguous: neither is chosen", "created", fileFor("Victim").getService().getAccountId());
        assertEquals(1, creates());
    }

    @Test
    public void citizenWithoutTheBffMarkerIsNeverAttached() {
        byUserName = List.of();
        // Found by mobile only, with no identity-bff marker: its number may be one nobody proved (#2167).
        byMobile = List.of(User.builder().uuid("unverified").userName("kcbff-attacker").mobileNumber(MOBILE)
                        .name("Attacker").active(true).build(),
                User.builder().uuid("other-marker").userName("someone").mobileNumber(MOBILE).active(true)
                        .identificationMark("keycloak-bff:v1:employee:test").build());
        assertEquals("created", fileFor("Victim").getService().getAccountId());
        assertEquals(1, creates());
    }

    @Test
    public void legacyUsernameAccountIsUsed() {
        byUserName = List.of(User.builder().uuid("existing").userName(MOBILE).mobileNumber(MOBILE).name("Citizen").build());
        byMobile = List.of(bffCitizen("bff-citizen"));
        assertEquals("the userName = mobile account comes first", "existing", fileFor("Citizen").getService().getAccountId());
        assertEquals("no mobile search once it is found", 1, calls.size());
    }

    @Test
    public void aMarkerInTheRequestIsNeverForwarded() {
        byUserName = List.of();
        ServiceRequest request = ServiceRequest.builder().requestInfo(info).service(Service.builder().tenantId("test")
                .citizen(User.builder().mobileNumber(MOBILE).name("Victim").identificationMark(MARKER).build()).build()).build();
        new UserService(utils, config).callUserService(request);
        CreateUserRequest create = (CreateUserRequest) calls.stream().filter(call -> call instanceof CreateUserRequest)
                .findFirst().orElseThrow();
        assertNull(create.getUser().getIdentificationMark());
    }

    @Test
    public void existingAccountIsNeverRenamed() {
        User existing = User.builder().uuid("existing").userName(MOBILE).mobileNumber(MOBILE).name("Citizen").build();
        byUserName = List.of(existing);
        ServiceRequest request = fileFor("Someone Else");
        assertEquals("existing", request.getService().getAccountId());
        assertEquals("Citizen", existing.getName());
        assertTrue(calls.stream().noneMatch(call -> call instanceof CreateUserRequest));
        verify(utils, never()).addUserDefaultFields(any(), any(), any());
    }
    // Field finding (dev deployment, 2026-10-07): the citizen a complaint APPLY was filed for reached
    // the notification as 762061507, and from ASSIGN on (enriched from egov-user) as +254762061507.
    @Test
    public void theAccountsCountryCodeIsCarriedOnTheComplaintsCitizen() {
        byUserName = List.of(User.builder().uuid("existing").userName(MOBILE).mobileNumber(MOBILE)
                .countryCode("+254").name("Citizen").build());
        ServiceRequest request = fileFor("Citizen");
        assertEquals("+254", request.getService().getCitizen().getCountryCode());
        assertEquals("the number itself is not rewritten", MOBILE, request.getService().getCitizen().getMobileNumber());
    }

    @Test
    public void aCountryCodeTheEmployeeGaveIsKept() {
        byUserName = List.of(User.builder().uuid("existing").userName(MOBILE).mobileNumber(MOBILE)
                .countryCode("+254").name("Citizen").build());
        ServiceRequest request = ServiceRequest.builder().requestInfo(info).service(Service.builder()
                .tenantId("test").citizen(User.builder().mobileNumber(MOBILE).countryCode("+91").name("C").build())
                .build()).build();
        new UserService(utils, config).callUserService(request);
        assertEquals("+91", request.getService().getCitizen().getCountryCode());
    }
}
