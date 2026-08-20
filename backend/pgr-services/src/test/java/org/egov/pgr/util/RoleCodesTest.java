package org.egov.pgr.util;

import org.egov.common.contract.request.RequestInfo;
import org.egov.common.contract.request.Role;
import org.egov.common.contract.request.User;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * The single normalization {@code AccessPolicyRegistry}'s cache key, {@code MDMSUtils}' outbound
 * accesscontrol request body, and {@code PolicyDrivenScopeResolver}'s engine input must all agree
 * on — see {@link RoleCodes}'s class Javadoc for why a drift here is a real bug (#1441 review).
 */
class RoleCodesTest {

    @Test
    void trimsAndUppercases() {
        RequestInfo requestInfo = requestInfo(" gro ");
        assertEquals(Set.of("GRO"), RoleCodes.normalize(requestInfo));
    }

    @Test
    void deduplicatesAfterNormalization() {
        RequestInfo requestInfo = requestInfo("GRO", " gro ", "Gro");
        assertEquals(Set.of("GRO"), RoleCodes.normalize(requestInfo));
    }

    @Test
    void ignoresNullOrBlankCodes() {
        User user = new User();
        user.setRoles(List.of(
                Role.builder().code(null).build(),
                Role.builder().code("  ").build(),
                Role.builder().code("GRO").build()));
        assertEquals(Set.of("GRO"), RoleCodes.normalize(user));
    }

    @Test
    void emptyForMissingIdentity() {
        assertTrue(RoleCodes.normalize((RequestInfo) null).isEmpty());
        assertTrue(RoleCodes.normalize(new RequestInfo()).isEmpty());
        assertTrue(RoleCodes.normalize((User) null).isEmpty());
    }

    private RequestInfo requestInfo(String... roleCodes) {
        User user = new User();
        user.setRoles(List.of(roleCodes).stream().map(c -> Role.builder().code(c).build()).toList());
        RequestInfo requestInfo = new RequestInfo();
        requestInfo.setUserInfo(user);
        return requestInfo;
    }
}
