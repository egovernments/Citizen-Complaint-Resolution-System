package org.egov.pgr.policy;

/**
 * How restrictive a single axis (e.g. department, jurisdiction) is for a role, per the
 * MDMS-authored {@link ScopePolicy}. {@code ALL} means unrestricted on that axis; {@code OWN}
 * means restricted to the caller's own HRMS-resolved value(s) for that axis. A future {@code TEAM}
 * level (self + reportees, via the existing HRMS reportee-hierarchy machinery already used by
 * {@code VisibilityService}) is a natural extension point — callers switch on this enum's value,
 * not on which axes exist, so adding a level here never requires new branches at call sites.
 */
public enum ScopeLevel {
    ALL,
    OWN;

    /**
     * Case-insensitive, fail-safe parse of an MDMS-authored level string. Unrecognized/blank
     * values return {@code null} — callers must decide what "malformed" degrades to (never guess
     * ALL, since that would silently widen access on a typo).
     */
    public static ScopeLevel parse(String raw) {
        if (raw == null)
            return null;
        String trimmed = raw.trim();
        for (ScopeLevel level : values())
            if (level.name().equalsIgnoreCase(trimmed))
                return level;
        return null;
    }
}
