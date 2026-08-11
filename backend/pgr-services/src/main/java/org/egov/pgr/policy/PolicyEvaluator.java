package org.egov.pgr.policy;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.github.jamsesso.jsonlogic.JsonLogic;
import io.github.jamsesso.jsonlogic.JsonLogicException;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.util.Map;

/** Evaluates JsonLogic policy conditions and fails closed on every invalid outcome. */
@Component
@Slf4j
public class PolicyEvaluator {

    private final JsonLogic jsonLogic = new JsonLogic();
    private final ObjectMapper objectMapper;

    public PolicyEvaluator(ObjectMapper objectMapper) {
        this.objectMapper = java.util.Objects.requireNonNull(objectMapper, "objectMapper");
    }

    /**
     * Evaluates a parsed JSON condition and returns true only when it produces the Boolean value
     * {@code true}. JsonLogic's broader truthiness rules are useful for expressions, but accepting
     * a truthy scalar as a final authorization verdict would contradict the fail-closed contract.
     */
    public boolean isAllowed(Object condition, Map<String, Object> data) {
        if (condition == null || data == null) {
            log.error("PolicyEvaluator: missing condition or input document; denying");
            return false;
        }
        try {
            String conditionJson = objectMapper.writeValueAsString(condition);
            Object result = jsonLogic.apply(conditionJson, data);
            return Boolean.TRUE.equals(result);
        } catch (JsonProcessingException | JsonLogicException | RuntimeException e) {
            log.error("PolicyEvaluator: condition evaluation failed; denying: {}", e.getMessage());
            return false;
        }
    }
}
