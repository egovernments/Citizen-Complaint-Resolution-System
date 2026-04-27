package org.egov.config.utils;

import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.StringJoiner;

public class QueryUtil {

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

    public static String preparePartialJsonStringFromFilterMap(Map<String, Object> filterMap) {
        if (filterMap == null || filterMap.isEmpty()) {
            return "{}";
        }
        StringBuilder sb = new StringBuilder("{");
        boolean first = true;
        for (Map.Entry<String, Object> entry : filterMap.entrySet()) {
            if (!first) sb.append(",");
            sb.append("\"").append(escapeJson(entry.getKey())).append("\":");
            Object val = entry.getValue();
            if (val instanceof String) {
                sb.append("\"").append(escapeJson((String) val)).append("\"");
            } else {
                sb.append(val);
            }
            first = false;
        }
        sb.append("}");
        return sb.toString();
    }

    private static String escapeJson(String value) {
        if (value == null) return "";
        return value.replace("\\", "\\\\").replace("\"", "\\\"");
    }
}
