package org.egov.novubridge.service;

import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestTemplate;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * A national number is completed with the country code of the tenant it is sent for: one
 * deployment serves workspaces in several countries, so one deployment-wide code is wrong for all
 * but one of them (field finding, dev deployment 2026-10-07: KE, IN, ET and MZ workspaces).
 */
class TenantPhoneNumbersTest {

    private RestTemplate mdms;
    private NovuBridgeConfiguration config;
    private TenantPhoneNumbers phones;
    /** tenant -> MobileNumberValidation records (the MDMS wrapper, data inside). */
    private final Map<String, List<Map<String, Object>>> rules = new HashMap<>();
    private final List<String> asked = new ArrayList<>();

    @BeforeEach
    @SuppressWarnings({"unchecked", "rawtypes"})
    void setUp() {
        mdms = mock(RestTemplate.class);
        config = new NovuBridgeConfiguration();
        config.setMdmsHost("http://mdms");
        config.setMdmsSearchPath("/mdms-v2/v2/_search");
        config.setNotificationConfigCacheTtlMs(60_000L);
        when(mdms.exchange(anyString(), eq(HttpMethod.POST), any(HttpEntity.class), eq(Map.class))).thenAnswer(inv -> {
            Map<String, Object> body = (Map<String, Object>) ((HttpEntity) inv.getArgument(2)).getBody();
            Map<String, Object> criteria = (Map<String, Object>) body.get("MdmsCriteria");
            assertEquals(TenantPhoneNumbers.MOBILE_RULE_SCHEMA, criteria.get("schemaCode"));
            String tenant = (String) criteria.get("tenantId");
            asked.add(tenant);
            return new ResponseEntity(Map.of("mdms", rules.getOrDefault(tenant, List.of())), HttpStatus.OK);
        });
        phones = new TenantPhoneNumbers(mdms, config);
    }

    private void rule(String tenant, String countryCode, Boolean isDefault, boolean active) {
        Map<String, Object> data = new HashMap<>(Map.of("countryCode", countryCode, "mobileNumberRegex", "^[0-9]+$"));
        if (isDefault != null) {
            data.put("default", isDefault);
        }
        rules.computeIfAbsent(tenant, t -> new ArrayList<>()).add(Map.of("tenantId", tenant, "isActive", active, "data", data));
    }

    @Test
    void eachWorkspaceUsesItsOwnCountry() {
        rule("kworkspace", "+254", true, true);
        rule("iworkspace", "+91", true, true);

        assertEquals("+254762061507", phones.toE164("762061507", "kworkspace"));
        assertEquals("+919415787824", phones.toE164("9415787824", "iworkspace"));
    }

    @Test
    void aCityWithoutItsOwnRule_usesItsStateRoot() {
        rule("ke", "+254", true, true);

        assertEquals("+254762061507", phones.toE164("0762061507", "ke.bomet"));
        assertEquals(List.of("ke.bomet", "ke"), asked);
    }

    @Test
    void theDefaultRuleWins_andAnInactiveOneIsIgnored() {
        rule("mz", "+91", null, false);
        rule("mz", "+27", false, true);
        rule("mz", "+258", true, true);
        assertEquals("+258841234567", phones.toE164("841234567", "mz"));

        rules.clear();
        phones = new TenantPhoneNumbers(mdms, config);
        rule("et", "+251", null, true);    // no default flagged: the first active one
        assertEquals("+251911234567", phones.toE164("0911234567", "et"));
    }

    @Test
    void theTenantRuleOutranksTheDeploymentCode_whichIsOnlyTheLastResort() {
        config.setCoreSmsCountryCode("+91");
        rule("kworkspace", "+254", true, true);

        assertEquals("+254762061507", phones.toE164("762061507", "kworkspace"));
        assertEquals("+919415787824", phones.toE164("9415787824", "norule"), "no rule at that tenant");
    }

    @Test
    void noRuleAndNoDeploymentCode_isNull() {
        assertNull(phones.toE164("762061507", "norule"));
        assertNull(phones.dialCode("norule"));
    }

    @Test
    void anInternationalNumberNeverCostsAnMdmsRead() {
        assertEquals("+254762061507", phones.toE164("+254 762 061 507", "kworkspace"));
        verify(mdms, never()).exchange(anyString(), any(HttpMethod.class), any(HttpEntity.class), eq(Map.class));
    }

    @Test
    @SuppressWarnings({"unchecked", "rawtypes"})
    void theRuleIsReadOncePerTtl_andAnOutageFallsBackToTheDeploymentCode() {
        rule("kworkspace", "+254", true, true);
        for (int i = 0; i < 5; i++) {
            assertEquals("+254762061507", phones.toE164("762061507", "kworkspace"));
        }
        verify(mdms, times(1)).exchange(anyString(), eq(HttpMethod.POST), any(HttpEntity.class), eq(Map.class));

        when(mdms.exchange(anyString(), eq(HttpMethod.POST), any(HttpEntity.class), eq(Map.class)))
                .thenThrow(new ResourceAccessException("mdms down"));
        config.setCoreSmsCountryCode("+255");
        TenantPhoneNumbers cold = new TenantPhoneNumbers(mdms, config);
        assertEquals("+255712345678", cold.toE164("0712345678", "kworkspace"));
    }

    @Test
    void withoutMdms_onlyTheDeploymentCodeApplies() {
        config.setCoreSmsCountryCode("254");
        TenantPhoneNumbers deploymentOnly = new TenantPhoneNumbers(config);
        assertEquals("+254762061507", deploymentOnly.toE164("762061507", "anything"));
    }
}
