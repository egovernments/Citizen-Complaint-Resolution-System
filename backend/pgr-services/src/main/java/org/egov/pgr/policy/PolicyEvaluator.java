package org.egov.pgr.policy;

import io.github.jamsesso.jsonlogic.JsonLogic;
import io.github.jamsesso.jsonlogic.JsonLogicException;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.util.Map;

/**
 * Thin wrapper around the JsonLogic evaluator (io.github.jamsesso:json-logic-java). This is the
 * Tier-2 PDP's actual runtime evaluation step from the access-control policy design doc: given a
 * condition and an input document, decide allow/deny. Fail-CLOSED on any problem (missing
 * condition, malformed JSON, evaluator exception, non-boolean result) — never silently allow.
 */
@Component
@Slf4j
public class PolicyEvaluator {

    private final JsonLogic jsonLogic = new JsonLogic();

    public boolean isAllowed(String conditionJson, Map<String, Object> data) {
        if (conditionJson == null || conditionJson.isBlank()) {
            log.error("PolicyEvaluator: missing condition — denying (fail-closed)");
            return false;
        }
        try {
            Object result = jsonLogic.apply(conditionJson, data);
            return JsonLogic.truthy(result);
        } catch (JsonLogicException | RuntimeException e) {
            log.error("PolicyEvaluator: condition evaluation failed — denying (fail-closed): {}", e.getMessage());
            return false;
        }
    }
}
