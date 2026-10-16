package org.egov.pgr.util;

/**
 * LIKE helpers for server-derived values. PostgreSQL LIKE uses backslash as its escape character
 * by default, so escaping a value here keeps {@code %} and {@code _} in it literal.
 */
public final class SqlLike {

    private SqlLike() {
    }

    /** Escapes LIKE metacharacters in server-derived text before a wildcard is appended to it. */
    public static String escapeLiteral(String value) {
        return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_");
    }

    /**
     * The LIKE pattern for every tenant strictly below {@code tenantId}: the escaped id plus
     * {@code ".%"}. Pair it with an exact {@code = ?} for the tenant itself. A bare
     * {@code tenantId + "%"} also matches a sibling whose id merely starts with the same
     * characters ({@code ke} matching {@code kenya}), which is a cross-tenant read.
     */
    public static String subtreePattern(String tenantId) {
        return escapeLiteral(tenantId) + ".%";
    }
}
