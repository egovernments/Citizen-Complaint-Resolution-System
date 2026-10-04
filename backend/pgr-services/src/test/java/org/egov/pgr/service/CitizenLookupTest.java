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
import org.egov.tracer.model.CustomException;
import org.junit.Test;
import java.util.List;
import static org.junit.Assert.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;

public class CitizenLookupTest {
    @Test public void bffCitizenIsFoundByMobileWithoutDuplicate() { exercise(false, false); }
    @Test public void legacyUsernameStillWins() { exercise(true, false); }
    @Test public void existingNameUpdateIsPreserved() { exercise(false, true); }

    private void exercise(boolean legacy, boolean rename) {
        UserUtils utils = mock(UserUtils.class);
        PGRConfiguration config = mock(PGRConfiguration.class);
        when(config.getUserHost()).thenReturn("http://user");
        when(config.getUserSearchEndpoint()).thenReturn("/_search");
        when(utils.getStateLevelTenant("test")).thenReturn("test");
        User found = User.builder().uuid("existing").userName(legacy ? "9876543210" : "identity-citizen")
                .mobileNumber("9876543210").name("Citizen").build();
        RequestInfo info = new RequestInfo();
        when(utils.userCall(any(), any())).thenAnswer(call -> {
            Object body = call.getArgument(0);
            if (body instanceof UserSearchRequest search) {
                assertSame(info, search.getRequestInfo());
                assertEquals("test", search.getTenantId());
                assertEquals("CITIZEN", search.getUserType());
                if (search.getMobileNumber() != null) {
                    assertNull(search.getUserName());
                    assertEquals("9876543210", search.getMobileNumber());
                    return new UserDetailResponse(null, List.of(found));
                }
                return new UserDetailResponse(null, legacy ? List.of(found) : List.of());
            }
            assertTrue(rename);
            assertTrue(body instanceof CreateUserRequest);
            return new UserDetailResponse(null, List.of(found));
        });
        ServiceRequest request = ServiceRequest.builder().requestInfo(info).service(Service.builder()
                .tenantId("test").citizen(User.builder().mobileNumber("9876543210")
                        .name(rename ? "Updated" : "Citizen").build()).build()).build();
        new UserService(utils, config).callUserService(request);
        assertEquals("existing", request.getService().getAccountId());
        verify(utils, times((legacy ? 1 : 2) + (rename ? 1 : 0))).userCall(any(), any());
        verify(utils, never()).addUserDefaultFields(any(), any(), any());
        if (rename) assertEquals("Updated", found.getName());
    }
}
