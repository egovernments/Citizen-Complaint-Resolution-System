package org.egov.userpreference.utils;

import java.util.List;

public class QueryUtil {

    private QueryUtil() {
    }

    /**
     * Open the WHERE clause on the first predicate and AND the rest onto it.
     * {@code preparedStmtList} doubles as the "have we written anything yet?"
     * marker, as it does in digit-config-service.
     */
    public static void addClauseIfRequired(StringBuilder query, List<Object> preparedStmtList) {
        if (preparedStmtList.isEmpty()) {
            query.append(" WHERE ");
        } else {
            query.append(" AND ");
        }
    }
}
