package org.egov.userpreference.web.model;

/**
 * Reach of a consent grant: everywhere, or only within one tenant.
 *
 * <p>Held as a {@code String} on {@link ConsentPolicy} for the reason
 * documented on {@link ConsentStatus}.
 */
public enum ConsentScope {

    GLOBAL,
    TENANT;

    public static boolean isValid(String value) {
        for (ConsentScope scope : values()) {
            if (scope.name().equals(value)) {
                return true;
            }
        }
        return false;
    }
}
