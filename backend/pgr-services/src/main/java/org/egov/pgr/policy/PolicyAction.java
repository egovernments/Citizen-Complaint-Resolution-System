package org.egov.pgr.policy;

import java.math.BigDecimal;
import java.math.BigInteger;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;

/**
 * One role-visible access-control action and its opaque policy document.
 *
 * <p>The registry treats {@code method} and {@code url} as the action's identity. The remaining
 * document is intentionally opaque here so row, field, and analytics integrations can evolve
 * their policy schema without teaching the cache about domain fields.
 */
public record PolicyAction(String method, String url, Map<String, Object> document) {

    public PolicyAction {
        Objects.requireNonNull(method, "method");
        Objects.requireNonNull(url, "url");
        Objects.requireNonNull(document, "document");
        if (method.isBlank() || !method.equals(method.trim()))
            throw new IllegalArgumentException("method must not be blank");
        if (url.isBlank() || !url.equals(url.trim()))
            throw new IllegalArgumentException("url must not be blank");

        method = method.toUpperCase(Locale.ROOT);
        document = immutableDocument(document);
    }

    /** Returns the parsed JsonLogic condition, or {@code null} when the policy omits it. */
    public Object condition() {
        return document.get("condition");
    }

    private static Map<String, Object> immutableDocument(Map<String, Object> source) {
        Map<String, Object> copy = new LinkedHashMap<>();
        for (Map.Entry<String, Object> entry : source.entrySet()) {
            if (entry.getKey() == null)
                throw new IllegalArgumentException("policy document keys must not be null");
            copy.put(entry.getKey(), immutableJsonValue(entry.getValue()));
        }
        return Collections.unmodifiableMap(copy);
    }

    private static Object immutableJsonValue(Object value) {
        if (value == null || value instanceof String || value instanceof Boolean)
            return value;
        if (value instanceof Float number) {
            if (!Float.isFinite(number))
                throw new IllegalArgumentException("policy document numbers must be finite");
            return number;
        }
        if (value instanceof Double number) {
            if (!Double.isFinite(number))
                throw new IllegalArgumentException("policy document numbers must be finite");
            return number;
        }
        if (value instanceof Byte || value instanceof Short || value instanceof Integer
                || value instanceof Long || value instanceof BigInteger || value instanceof BigDecimal)
            return value;
        if (value instanceof Map<?, ?> map) {
            Map<String, Object> copy = new LinkedHashMap<>();
            for (Map.Entry<?, ?> entry : map.entrySet()) {
                if (!(entry.getKey() instanceof String key))
                    throw new IllegalArgumentException("policy document map keys must be strings");
                copy.put(key, immutableJsonValue(entry.getValue()));
            }
            return Collections.unmodifiableMap(copy);
        }
        if (value instanceof List<?> list) {
            List<Object> copy = new ArrayList<>(list.size());
            for (Object item : list)
                copy.add(immutableJsonValue(item));
            return Collections.unmodifiableList(copy);
        }
        throw new IllegalArgumentException("unsupported policy document value type: " + value.getClass().getName());
    }
}
