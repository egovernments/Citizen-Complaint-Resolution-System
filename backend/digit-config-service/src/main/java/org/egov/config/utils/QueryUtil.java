package org.egov.config.utils;

import com.fasterxml.jackson.databind.ObjectMapper;

import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.StringJoiner;

public class QueryUtil {

    private static final ObjectMapper OBJECT_MAPPER = new ObjectMapper();

    private QueryUtil() {}

    public static void addClauseIfRequired(StringBuilder query, List<Object> preparedStmtList) {
        if (preparedStmtList.isEmpty()) {
            query.append(" WHERE ");
        } else {
            query.append(" AND ");
        }
    }

    public static String createQuery(int count) {
        StringJoiner sj = new StringJoiner(", ");
        for (int i = 0; i < count; i++) {
            sj.add("?");
        }
        return sj.toString();
    }

    public static void addToPreparedStatement(List<Object> preparedStmtList, Collection<String> values) {
        preparedStmtList.addAll(values);
    }

    /**
     * Serializes the criteria filter map to a JSON object string suitable for binding
     * into a {@code data @> CAST(? AS jsonb)} containment predicate.
     *
     * <p>{@code ConfigDataCriteria.criteria} / {@code ResolveParams.criteria} are typed
     * {@code Map<String, Object>}, so a filter value may be a scalar (String/Number/Boolean),
     * or a nested Map/List. Jackson is used for serialization so nested values are emitted as
     * valid JSON (e.g. {@code {"a":1}}) rather than Java's {@code Object.toString()} form
     * (e.g. {@code {a=1}}), which would produce invalid JSON and fail the jsonb cast at query
     * time.
     */
    public static String preparePartialJsonStringFromFilterMap(Map<String, Object> filterMap) {
        if (filterMap == null || filterMap.isEmpty()) {
            return "{}";
        }
        try {
            return OBJECT_MAPPER.writeValueAsString(filterMap);
        } catch (Exception e) {
            throw new RuntimeException("Failed to serialize criteria filter map to JSON", e);
        }
    }
}
