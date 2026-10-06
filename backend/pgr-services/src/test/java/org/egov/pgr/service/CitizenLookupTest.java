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
 * An employee-filed complaint resolves its citizen by userName = mobileNumber only.
 * A citizen found merely by mobile number (an identity-bff account whose phone may be
 * unverified, #2167) is never attached, and no existing account is ever renamed.
 */
public class CitizenLookupTest {
    private static final String MOBILE = "9876543210";

    private UserUtils utils;
    private PGRConfiguration config;
    private final RequestInfo info = new RequestInfo();
    private final List<Object> calls = new ArrayList<>();
    private List<User> byUserName;
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
                // An identity-bff citizen (userName "kcbff...") with this mobile exists, so a
                // search by mobile number alone WOULD find it.
                if (search.getMobileNumber() != null) {
                    return new UserDetailResponse(null, List.of(User.builder().uuid("unverified-bff-citizen")
                            .userName("kcbff-attacker").mobileNumber(MOBILE).name("Attacker").build()));
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

    @Test
    public void citizenFoundOnlyByMobileIsNeverAttached() {
        byUserName = List.of();
        ServiceRequest request = fileFor("Victim");
        assertEquals("created", request.getService().getAccountId());
        assertTrue(calls.stream().noneMatch(call -> call instanceof UserSearchRequest search && search.getMobileNumber() != null));
        assertEquals(1, calls.stream().filter(call -> call instanceof CreateUserRequest).count());
        verify(utils).addUserDefaultFields(eq(MOBILE), eq("test"), any());
    }

    @Test
    public void legacyUsernameAccountIsUsed() {
        byUserName = List.of(User.builder().uuid("existing").userName(MOBILE).mobileNumber(MOBILE).name("Citizen").build());
        assertEquals("existing", fileFor("Citizen").getService().getAccountId());
        assertEquals(1, calls.size());
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
}
