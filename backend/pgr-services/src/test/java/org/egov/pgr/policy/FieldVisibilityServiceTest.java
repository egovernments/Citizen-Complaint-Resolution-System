package org.egov.pgr.policy;

import org.egov.common.contract.request.RequestInfo;
import org.egov.pgr.analytics.AnalyticsScope;
import org.egov.pgr.web.models.Service;
import org.egov.pgr.web.models.ServiceWrapper;
import org.egov.pgr.web.models.User;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;

/**
 * Uses the real {@link PolicyEvaluator} and {@link PolicyInputBuilder} (only
 * {@link AccessPolicyRegistry} is mocked) so this exercises the actual JsonLogic-condition ->
 * mask-or-not decision, not a stand-in.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class FieldVisibilityServiceTest {

    private static final String TENANT_ID = "pg.city";
    private static final String ACTION_URL = AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL;

    @Mock
    private AccessPolicyRegistry registry;

    private FieldVisibilityService service;

    private void setup() {
        service = new FieldVisibilityService(registry, new PolicyEvaluator(), new PolicyInputBuilder());
    }

    @Test
    void deniedFieldIsRedacted() {
        setup();
        when(registry.getFieldVisibilityRules(eq(ACTION_URL), any(), eq(TENANT_ID), eq("complaint")))
                .thenReturn(Map.of("citizen.mobileNumber", new FieldVisibilityRule("false", Map.of("strategy", "REDACT"))));

        ServiceWrapper wrapper = wrapper("citizen-1", "9998887766");
        service.apply(requestInfo("citizen-1"), TENANT_ID, ownScope(), ACTION_URL, "complaint", List.of(wrapper));

        assertNull(wrapper.getService().getCitizen().getMobileNumber());
    }

    @Test
    void deniedFieldIsMaskedShowLastN() {
        setup();
        when(registry.getFieldVisibilityRules(eq(ACTION_URL), any(), eq(TENANT_ID), eq("complaint")))
                .thenReturn(Map.of("citizen.mobileNumber",
                        new FieldVisibilityRule("false", Map.of("strategy", "MASK_SHOW_LAST_N", "n", 2))));

        ServiceWrapper wrapper = wrapper("citizen-1", "9998887766");
        service.apply(requestInfo("citizen-1"), TENANT_ID, ownScope(), ACTION_URL, "complaint", List.of(wrapper));

        assertEquals("XXXXXXXX66", wrapper.getService().getCitizen().getMobileNumber());
    }

    @Test
    void allowedFieldIsLeftUntouched() {
        setup();
        when(registry.getFieldVisibilityRules(eq(ACTION_URL), any(), eq(TENANT_ID), eq("complaint")))
                .thenReturn(Map.of("citizen.mobileNumber", new FieldVisibilityRule("true", Map.of("strategy", "REDACT"))));

        ServiceWrapper wrapper = wrapper("citizen-1", "9998887766");
        service.apply(requestInfo("citizen-1"), TENANT_ID, ownScope(), ACTION_URL, "complaint", List.of(wrapper));

        assertEquals("9998887766", wrapper.getService().getCitizen().getMobileNumber());
    }

    @Test
    void ownRecordConditionAllowsTheOwningCitizenButMasksForOthers() {
        setup();
        String condition = "{\"or\": [{\"==\": [{\"var\": \"user.attributes.tenantWide\"}, true]},"
                + "{\"==\": [{\"var\": \"resource.complaint.accountId\"}, {\"var\": \"user.uuid\"}]}]}";
        when(registry.getFieldVisibilityRules(eq(ACTION_URL), any(), eq(TENANT_ID), eq("complaint")))
                .thenReturn(Map.of("citizen.mobileNumber", new FieldVisibilityRule(condition, Map.of("strategy", "REDACT"))));

        ServiceWrapper ownComplaint = wrapper("citizen-1", "9998887766");
        ServiceWrapper othersComplaint = wrapper("citizen-2", "8887776655");
        List<ServiceWrapper> wrappers = List.of(ownComplaint, othersComplaint);

        // Caller is citizen-1 with a self-only scope (mirrors what PrincipalScopeResolver
        // produces for a pure citizen) — their own complaint's mobileNumber stays visible, the
        // other citizen's is masked.
        service.apply(requestInfo("citizen-1"), TENANT_ID, ownScope(), ACTION_URL, "complaint", wrappers);

        assertEquals("9998887766", ownComplaint.getService().getCitizen().getMobileNumber());
        assertNull(othersComplaint.getService().getCitizen().getMobileNumber());
    }

    @Test
    void noRulesConfiguredIsANoOp() {
        setup();
        when(registry.getFieldVisibilityRules(any(), any(), any(), any())).thenReturn(Map.of());

        ServiceWrapper wrapper = wrapper("citizen-1", "9998887766");
        service.apply(requestInfo("citizen-1"), TENANT_ID, ownScope(), ACTION_URL, "complaint", List.of(wrapper));

        assertEquals("9998887766", wrapper.getService().getCitizen().getMobileNumber());
    }

    @Test
    void missingCitizenObjectDoesNotThrow() {
        setup();
        when(registry.getFieldVisibilityRules(any(), any(), any(), any()))
                .thenReturn(Map.of("citizen.mobileNumber", new FieldVisibilityRule("false", Map.of("strategy", "REDACT"))));

        Service noCitizen = Service.builder().accountId("citizen-1").tenantId(TENANT_ID).build();
        ServiceWrapper wrapper = ServiceWrapper.builder().service(noCitizen).build();

        assertDoesNotThrow(() ->
                service.apply(requestInfo("citizen-1"), TENANT_ID, ownScope(), ACTION_URL, "complaint", List.of(wrapper)));
    }

    private AnalyticsScope ownScope() {
        return new AnalyticsScope(TENANT_ID, false, "citizen-1", null, null);
    }

    private RequestInfo requestInfo(String uuid) {
        org.egov.common.contract.request.User user = new org.egov.common.contract.request.User();
        user.setUuid(uuid);
        user.setType("CITIZEN");
        RequestInfo requestInfo = new RequestInfo();
        requestInfo.setUserInfo(user);
        return requestInfo;
    }

    private ServiceWrapper wrapper(String accountId, String mobileNumber) {
        User citizen = new User();
        citizen.setMobileNumber(mobileNumber);
        Service service = Service.builder().accountId(accountId).tenantId(TENANT_ID).citizen(citizen).build();
        return ServiceWrapper.builder().service(service).build();
    }
}
