package org.egov.pgr.onboarding;

import org.egov.tracer.model.CustomException;
import org.springframework.stereotype.Service;

import java.text.Normalizer;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Set;
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
    /**
     * URL slugs that would collide with a route on the same host: the SPA's own
     * path words plus every top-level nginx/Kong path prefix. The source of
     * truth is backend/identity-bff/docs/identity-bff.md section 2.4.1; the BFF
     * and the SPA carry the same list (a local-setup static test compares them).
     * The two-letter minimum is enforced by the tenant-id projection below.
     */
    static final Set<String> RESERVED_URL_SLUGS = Set.of(
            "access", "api", "assets", "auth", "boundary-service", "brand", "citizen", "common-persist",
            "configurator", "dashboard", "digit-ui", "egov-bndry-mgmnt", "egov-enc-service", "egov-hrms",
            "egov-idgen", "egov-indexer", "egov-location", "egov-mdms-service", "egov-user-event",
            "egov-workflow-v2", "employee", "env", "file-store", "filestore", "gatus", "grafana", "health",
            "identity", "images", "inbox", "kc", "keycloak", "localization", "matomo", "mcp", "mdms-v2",
            "novu", "novu-api", "novu-bridge", "novu-ws", "otel", "otp", "pgr-services", "static", "status",
            "tests", "tests-v2", "turbopass", "user", "user-otp", "user-preference", "v1", "xstate-chatbot");

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
        return Normalizer.normalize(Normalizer.normalize(value, Normalizer.Form.NFC)
                .replaceAll("[\\u0009-\\u000D\\u0020\\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF]+", " ")
                .trim().toLowerCase(Locale.ROOT), Normalizer.Form.NFC);
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
                if (!SLUG.matcher(value).matches() || RESERVED_URL_SLUGS.contains(value)) invalid(field);
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
