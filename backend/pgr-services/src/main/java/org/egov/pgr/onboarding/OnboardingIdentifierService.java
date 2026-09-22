package org.egov.pgr.onboarding;

import org.egov.tracer.model.CustomException;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.regex.Pattern;

/**
 * Canonical identifier validation and projection for onboarding.
 *
 * A URL slug is not independently available when the DIGIT tenant id it
 * projects to is occupied. Callers use the generated identifier list for the
 * advisory check, the authoritative submit check and the atomic reservation so
 * those three paths cannot drift apart.
 */
@Service
public class OnboardingIdentifierService {

    private static final Pattern ACCOUNT_CODE = Pattern.compile("^[A-Z0-9][A-Z0-9-]{1,31}$");
    private static final Pattern SLUG = Pattern.compile("^[a-z0-9][a-z0-9-]{1,62}$");
    // Normal onboarding creates an independent root. Dotted ids are reserved
    // for a separate, explicit subtenant operation and are never derived here.
    private static final Pattern TENANT_ID = Pattern.compile("^[a-z]{2,63}$");

    public List<Identifier> forInput(String rawType, String rawValue) {
        String type = required(rawType, "Identifier.type").toUpperCase(Locale.ROOT);
        String value = normalize(type, required(rawValue, "Identifier.value"), "Identifier.value");
        List<Identifier> identifiers = new ArrayList<>();
        identifiers.add(new Identifier(type, value));
        if ("URL_SLUG".equals(type) || "ORGANIZATION_ALIAS".equals(type)) {
            identifiers.add(new Identifier("TENANT_ID", tenantIdForSlug(value, "Identifier.value")));
        }
        return identifiers;
    }

    public List<Identifier> forSignup(OnboardingSignup signup) {
        return List.of(
                new Identifier("ORGANIZATION_NAME", normalizeOrganizationName(
                        required(signup.getAccountName(), "Signup.accountName"))),
                new Identifier("ACCOUNT_CODE", normalize("ACCOUNT_CODE",
                        required(signup.getAccountCode(), "Signup.accountCode"), "Signup.accountCode")),
                new Identifier("TENANT_ID", normalize("TENANT_ID",
                        required(signup.getRequestedTenantId(), "Signup.requestedTenantId"),
                        "Signup.requestedTenantId")),
                new Identifier("ORGANIZATION_ALIAS", normalize("ORGANIZATION_ALIAS",
                        required(signup.getOrganizationAlias(), "Signup.organizationAlias"),
                        "Signup.organizationAlias")),
                new Identifier("URL_SLUG", normalize("URL_SLUG",
                        required(signup.getUrlSlug(), "Signup.urlSlug"), "Signup.urlSlug")));
    }

    public String accountCode(String value, String field) {
        return normalize("ACCOUNT_CODE", required(value, field), field);
    }

    public String urlSlug(String value, String field) {
        return normalize("URL_SLUG", required(value, field), field);
    }

    /** DIGIT root tenant codes cannot carry digits or hyphens. */
    public String tenantIdForSlug(String slug) {
        return tenantIdForSlug(slug, "Identifier.value");
    }

    private String tenantIdForSlug(String slug, String field) {
        String tenantId = slug.replaceAll("[^a-z]", "");
        if (!TENANT_ID.matcher(tenantId).matches()) invalid(field);
        return tenantId;
    }

    public String normalizeOrganizationName(String value) {
        return value.trim().replaceAll("\\s+", " ").toLowerCase(Locale.ROOT);
    }

    private String normalize(String type, String value, String field) {
        switch (type) {
            case "ACCOUNT_CODE":
                value = value.toUpperCase(Locale.ROOT);
                if (!ACCOUNT_CODE.matcher(value).matches()) invalid(field);
                return value;
            case "ORGANIZATION_NAME":
                return normalizeOrganizationName(value);
            case "TENANT_ID":
                value = value.toLowerCase(Locale.ROOT);
                if (!TENANT_ID.matcher(value).matches()) invalid(field);
                return value;
            case "ORGANIZATION_ALIAS":
            case "URL_SLUG":
                value = value.toLowerCase(Locale.ROOT);
                if (!SLUG.matcher(value).matches()) invalid(field);
                // Apply the same projection validation here, so an unusable slug
                // is rejected at entry rather than surviving until submit.
                tenantIdForSlug(value, field);
                return value;
            default:
                throw new CustomException("ONBOARDING_IDENTIFIER_TYPE_INVALID", "Unsupported identifier type");
        }
    }

    private String required(String value, String field) {
        if (value == null || value.trim().isEmpty()) {
            throw new CustomException("ONBOARDING_VALIDATION_ERROR", field + " is required");
        }
        return value.trim();
    }

    private void invalid(String field) {
        throw new CustomException("ONBOARDING_VALIDATION_ERROR", field + " is invalid");
    }

    public record Identifier(String type, String value) { }
}
