package org.egov.userpreference.utils;

/**
 * String helpers that reproduce Go's zero-value semantics.
 *
 * <p>A Go {@code string} is never null — an absent JSON field leaves it
 * {@code ""} — so the original code could write {@code s != ""} and
 * {@code strings.TrimSpace(s)} without a nil check. In Java the same field is
 * {@code null} when absent, and these two helpers keep every comparison and
 * trim in the ported code reading the way the Go did instead of scattering
 * null checks through it.
 */
public final class StringUtil {

    private StringUtil() {
    }

    /** Equivalent of Go's {@code s != ""}. */
    public static boolean isNotEmpty(String value) {
        return value != null && !value.isEmpty();
    }

    /** Equivalent of Go's {@code s == ""}. */
    public static boolean isEmpty(String value) {
        return !isNotEmpty(value);
    }

    /** Maps an absent value onto Go's {@code string} zero value. */
    public static String nullToEmpty(String value) {
        return value == null ? "" : value;
    }

    /** Equivalent of Go's {@code strings.TrimSpace(s)}. */
    public static String trimToEmpty(String value) {
        return value == null ? "" : value.trim();
    }

    /** Length of the value, counting an absent one as 0 like Go's {@code len(s)}. */
    public static int length(String value) {
        return value == null ? 0 : value.length();
    }
}
