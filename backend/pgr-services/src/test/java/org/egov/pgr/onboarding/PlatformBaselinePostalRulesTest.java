package org.egov.pgr.onboarding;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.Test;
import java.io.IOException;
import java.util.*;
import java.util.regex.Pattern;
import static org.junit.Assert.*;

/** #2787: the postal-code rule each signup country gets, written as the workspace's FormValidations postalCode row. */
public class PlatformBaselinePostalRulesTest {
    private final ObjectMapper mapper = new ObjectMapper();

    /** The values asked for on #2787 (MZ verbatim, pending confirmation), and KE's existing 5 digits. */
    @Test public void everySignupCountryHasItsPostalRule() throws Exception {
        var seed = new PlatformBaseline(mapper);
        Map<String, String> expected = Map.of("IN", "^[1-9][0-9]{5}$", "KE", "^[0-9]{5}$", "ET", "^[0-9]{4}$",
                "MZ", "^(?:[1-9][0-9]{3}|[0-9]{4}-[0-9]{2}|[1-3][0-9]{4}-[0-9]{3})$");
        assertEquals(expected.keySet(), seed.supportedCountries());
        for (var country : expected.entrySet())
            assertEquals(country.getKey(), country.getValue(), seed.countryPostalRule(country.getKey()).path("regex").asText());
        assertTrue(seed.countryPostalRule("ZZ").isMissingNode());
    }

    /** What each rule accepts and refuses, tested as the browsers do (RegExp.test, i.e. find; the rules anchor themselves). */
    @Test public void eachRuleAcceptsItsCountrysCodesOnly() throws Exception {
        var seed = new PlatformBaseline(mapper);
        Map<String, List<String>> accepted = Map.of(
                "KE", List.of("00100", "20200", "40100"),
                "IN", List.of("110001", "560034"),
                "ET", List.of("1000", "3060"),
                "MZ", List.of("1100", "1102", "1234-56", "12345-678"));
        Map<String, List<String>> refused = Map.of(
                "KE", List.of("0010", "001000", "A0100", " 00100"),
                "IN", List.of("011001", "56003", "5600345"),
                "ET", List.of("100", "10000", "1000-1"),
                // 123456: the issue's description lists plain 6 digits, its regex does not; the regex is what ships.
                "MZ", List.of("0110", "123", "12345", "123456", "42345-678", "1234-567"));
        for (String country : accepted.keySet()) {
            Pattern rule = Pattern.compile(seed.countryPostalRule(country).path("regex").asText());
            for (String code : accepted.get(country)) assertTrue(country + " accepts " + code, rule.matcher(code).find());
            for (String code : refused.get(country)) assertFalse(country + " refuses " + code, rule.matcher(code).find());
        }
    }

    @Test public void aBrokenRuleIsRefusedAtStartup() throws Exception {
        Map<String, String> broken = Map.of(
                "unanchored", "{\"KE\": {\"regex\": \"[0-9]{5}\"}}",
                "does not compile", "{\"KE\": {\"regex\": \"^[0-9{5}$\"}}",
                "not a signup country", "{\"ZZ\": {\"regex\": \"^[0-9]{5}$\"}}",
                "extra field", "{\"KE\": {\"regex\": \"^[0-9]{5}$\", \"default\": true}}",
                "not text", "{\"KE\": {\"regex\": 5}}",
                "not an object", "[]");
        for (var rules : broken.entrySet()) {
            var seed = mapper.readTree("{\"countryMobileRules\": {\"KE\": {}}, \"countryPostalRules\": " + rules.getValue() + "}");
            assertThrows(rules.getKey(), IOException.class, () -> PlatformBaseline.validatePostalRules(seed));
        }
        PlatformBaseline.validatePostalRules(mapper.readTree("{\"countryMobileRules\": {\"KE\": {}}}"));
        PlatformBaseline.validatePostalRules(mapper.readTree("{\"countryMobileRules\": {\"KE\": {}}, \"countryPostalRules\": {\"KE\": {\"regex\": \"^[0-9]{5}$\"}}}"));
    }
}
