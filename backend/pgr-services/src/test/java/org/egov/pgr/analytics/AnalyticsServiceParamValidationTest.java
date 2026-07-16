package org.egov.pgr.analytics;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.egov.pgr.analytics.model.KpiDefinition;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

/**
 * #1111/R3: pins the generalized allow-list enforcement (formerly window-only C1) —
 * ANY declared param with a non-empty {@code allowed} list is validated against it,
 * out-of-list values are {@code invalid_param}, and the original window behaviour is
 * unchanged (regression). Declared-without-allow-list and undeclared params stay open.
 */
public class AnalyticsServiceParamValidationTest {

    private final ObjectMapper om = new ObjectMapper();
    private final AnalyticsService service =
            new AnalyticsService(null, null, null, null, null, null, new AnalyticsMetrics());

    private KpiDefinition def(String paramsJson) {
        try {
            return om.readValue("{\"id\":\"cl_test\",\"version\":\"1.0.0\",\"status\":\"published\","
                    + "\"params\":" + paramsJson + "}", KpiDefinition.class);
        } catch (Exception e) { throw new RuntimeException(e); }
    }

    private JsonNode json(String s) {
        try { return om.readTree(s); } catch (Exception e) { throw new RuntimeException(e); }
    }

    private static final String SEEDED_PARAMS =
            "[{\"name\":\"window\",\"default\":\"last_7d\",\"allowed\":[\"last_1d\",\"last_7d\",\"last_30d\",\"wtd\",\"mtd\"]},"
            + "{\"name\":\"hierLevel\",\"default\":\"1\",\"allowed\":[\"leaf\",\"1\",\"2\",\"3\",\"4\"]}]";

    @Test
    public void hierLevelOutsideAllowedListIsRejected() {
        IllegalArgumentException ex = assertThrows(IllegalArgumentException.class, () ->
                service.validateAllowedParams(def(SEEDED_PARAMS), json("{\"hierLevel\":\"7\"}")));
        assertTrue(ex.getMessage().startsWith("invalid_param"), ex.getMessage());
        assertTrue(ex.getMessage().contains("hierLevel"), ex.getMessage());
    }

    @Test
    public void hierLevelInsideAllowedListPasses() {
        service.validateAllowedParams(def(SEEDED_PARAMS), json("{\"hierLevel\":\"leaf\"}"));
        service.validateAllowedParams(def(SEEDED_PARAMS), json("{\"hierLevel\":\"2\"}"));
    }

    @Test
    public void windowRegressionStillEnforced() {
        // The original C1 behaviour, now served by the generalized path.
        IllegalArgumentException ex = assertThrows(IllegalArgumentException.class, () ->
                service.validateAllowedParams(def(SEEDED_PARAMS), json("{\"window\":\"last_999d\"}")));
        assertTrue(ex.getMessage().startsWith("invalid_param"), ex.getMessage());
        assertTrue(ex.getMessage().contains("window"), ex.getMessage());
        service.validateAllowedParams(def(SEEDED_PARAMS), json("{\"window\":\"last_30d\"}"));
    }

    @Test
    public void bothParamsValidatedTogether() {
        // window fine, hierLevel out of list — must still throw.
        assertThrows(IllegalArgumentException.class, () -> service.validateAllowedParams(
                def(SEEDED_PARAMS), json("{\"window\":\"last_7d\",\"hierLevel\":\"12\"}")));
    }

    @Test
    public void declaredParamWithoutAllowedListIsOpen() {
        service.validateAllowedParams(def("[{\"name\":\"hierLevel\",\"default\":\"leaf\"}]"),
                json("{\"hierLevel\":\"anything\"}"));   // no allow-list declared -> open
    }

    @Test
    public void undeclaredParamsAreNotValidated() {
        service.validateAllowedParams(def(SEEDED_PARAMS),
                json("{\"ward\":\"W1\",\"serviceCode\":\"x\",\"series\":\"daily\"}"));
    }

    @Test
    public void emptyAndAbsentValuesPass() {
        service.validateAllowedParams(def(SEEDED_PARAMS), json("{\"hierLevel\":\"\"}"));
        service.validateAllowedParams(def(SEEDED_PARAMS), json("{}"));
        service.validateAllowedParams(def(SEEDED_PARAMS), null);
        service.validateAllowedParams(def("null"), json("{\"hierLevel\":\"7\"}"));
    }
}
