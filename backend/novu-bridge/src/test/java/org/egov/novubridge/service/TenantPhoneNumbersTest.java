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
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
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
    /** Every MDMS read fails while true; a tenant in downFor fails alone. */
    private boolean mdmsDown;
    private final Set<String> downFor = new HashSet<>();
    private long now = 1_000_000L;

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
            if (mdmsDown || downFor.contains(tenant)) {
                throw new ResourceAccessException("mdms down");
            }
            return new ResponseEntity(Map.of("mdms", rules.getOrDefault(tenant, List.of())), HttpStatus.OK);
        });
        phones = phones();
    }

    private TenantPhoneNumbers phones() {
        TenantPhoneNumbers fresh = new TenantPhoneNumbers(mdms, config);
        fresh.clock = () -> now;
        return fresh;
    }

    private void ruleWithPattern(String tenant, String countryCode, String regex) {
        rules.computeIfAbsent(tenant, t -> new ArrayList<>()).add(Map.of("tenantId", tenant, "isActive", true,
                "data", Map.of("countryCode", countryCode, "mobileNumberRegex", regex, "default", true)));
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
        phones = phones();
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
    void theRuleIsReadOncePerTtl() {
        rule("kworkspace", "+254", true, true);
        for (int i = 0; i < 5; i++) {
            assertEquals("+254762061507", phones.toE164("762061507", "kworkspace"));
        }
        assertEquals(1, asked.size());
        now += 60_000L;
        phones.toE164("762061507", "kworkspace");
        assertEquals(2, asked.size(), "read again once the TTL is over");
    }

    // ---- a failed read is NOT "no rule" (review of #2342) -------------------------------------

    /**
     * Probe from the review: with MDMS down and nothing cached, an Indian workspace's number was
     * completed with a Kenyan deployment code ({@code +2549415787824}) for a whole TTL.
     */
    @Test
    void anOutageWithNothingCached_neverUsesTheDeploymentCode_itIsRetryable() {
        config.setCoreSmsCountryCode("+254");
        mdmsDown = true;

        TenantPhoneNumbers.RuleUnavailable ex = assertThrows(TenantPhoneNumbers.RuleUnavailable.class,
                () -> phones.toE164("9415787824", "iworkspace"));
        assertEquals("NB_CONFIG_UNAVAILABLE", ex.getCode());
        assertTrue(ex.getMessage().contains("iworkspace"), ex.getMessage());
        assertThrows(TenantPhoneNumbers.RuleUnavailable.class, () -> phones.dialCode("iworkspace"));
    }

    @Test
    void aFailureIsRememberedForAShortBackoff_notAWholeTtl() {
        rule("iworkspace", "+91", true, true);
        mdmsDown = true;
        assertThrows(TenantPhoneNumbers.RuleUnavailable.class, () -> phones.toE164("9415787824", "iworkspace"));
        assertThrows(TenantPhoneNumbers.RuleUnavailable.class, () -> phones.toE164("9415787824", "iworkspace"));
        assertEquals(1, asked.size(), "not one MDMS call per message during the back-off");

        mdmsDown = false;
        now += TenantPhoneNumbers.FAILURE_BACKOFF_MS;
        assertEquals("+919415787824", phones.toE164("9415787824", "iworkspace"),
                "asked again after the back-off, long before the 60s TTL");
        assertEquals(2, asked.size());
    }

    @Test
    void anOutageServesTheLastRuleMdmsGave() {
        config.setCoreSmsCountryCode("+254");
        rule("iworkspace", "+91", true, true);
        assertEquals("+919415787824", phones.toE164("9415787824", "iworkspace"));

        now += 60_000L;   // the TTL is over, and MDMS is down
        mdmsDown = true;
        for (int i = 0; i < 3; i++) {
            assertEquals("+919415787824", phones.toE164("9415787824", "iworkspace"));
        }
        assertEquals(2, asked.size(), "one failed read, then the back-off");
    }

    @Test
    void aStaleNoRuleAnswer_stillMeansNoRule() {
        config.setCoreSmsCountryCode("+255");
        assertEquals("+255712345678", phones.toE164("0712345678", "norule"));
        now += 60_000L;
        mdmsDown = true;

        assertEquals("+255712345678", phones.toE164("0712345678", "norule"),
                "MDMS did answer \"no rule\" last time; that answer is served, not an exception");
    }

    // ---- city -> state root while MDMS fails ---------------------------------------------------

    @Test
    void aCityWhoseOwnReadFails_doesNotFallToItsRoot_itMayHaveARuleOfItsOwn() {
        rule("ke", "+254", true, true);
        downFor.add("ke.bomet");

        assertThrows(TenantPhoneNumbers.RuleUnavailable.class, () -> phones.toE164("0762061507", "ke.bomet"));
        assertEquals(List.of("ke.bomet"), asked);
    }

    @Test
    void aCityWithNoRule_whoseRootFails_isRetryable_notTheDeploymentCode() {
        config.setCoreSmsCountryCode("+91");
        downFor.add("ke");

        assertThrows(TenantPhoneNumbers.RuleUnavailable.class, () -> phones.toE164("0762061507", "ke.bomet"));
        assertEquals(List.of("ke.bomet", "ke"), asked);
    }

    @Test
    void aCityAndItsRoot_bothStale_serveTheRootsLastRule() {
        config.setCoreSmsCountryCode("+91");
        rule("ke", "+254", true, true);
        assertEquals("+254762061507", phones.toE164("0762061507", "ke.bomet"));
        now += 60_000L;
        mdmsDown = true;

        assertEquals("+254762061507", phones.toE164("0762061507", "ke.bomet"));
    }

    // ---- the rule's pattern decides whether the code is already there --------------------------

    @Test
    void theRulesPatternDecides_whetherDigitsStartingWithTheCodeAlreadyCarryIt() {
        // Singapore: 8-digit numbers. "6581234567" leaves 8 after 65, under the 9-digit heuristic.
        ruleWithPattern("sworkspace", "+65", "^[89][0-9]{7}$");
        assertEquals("+6581234567", phones.toE164("6581234567", "sworkspace"));
        assertEquals("+6581234567", phones.toE164("81234567", "sworkspace"));

        // A national number that starts with the code and is long: Germany's area code 491.
        ruleWithPattern("dworkspace", "+49", "^[1-9][0-9]{9,10}$");
        assertEquals("+4949112345678", phones.toE164("49112345678", "dworkspace"));
    }

    @Test
    void aLoosePattern_orNone_orOneThatDoesNotCompile_leavesTheHeuristic() {
        ruleWithPattern("loose", "+254", "^[0-9]+$");   // both readings match
        assertEquals("+254712345678", phones.toE164("254712345678", "loose"));
        ruleWithPattern("broken", "+254", "^[0-9(+$");
        assertEquals("+254712345678", phones.toE164("254712345678", "broken"));
        assertEquals("+254712345678", phones.toE164("712345678", "broken"), "its country code still applies");
    }

    @Test
    void withoutMdms_onlyTheDeploymentCodeApplies() {
        config.setCoreSmsCountryCode("254");
        TenantPhoneNumbers deploymentOnly = new TenantPhoneNumbers(config);
        assertEquals("+254762061507", deploymentOnly.toE164("762061507", "anything"));
    }
}
