package org.egov.pgr.onboarding;

import com.google.i18n.phonenumbers.NumberParseException;
import com.google.i18n.phonenumbers.PhoneNumberUtil;
import com.google.i18n.phonenumbers.PhoneNumberUtil.PhoneNumberType;
import com.google.i18n.phonenumbers.Phonenumber.PhoneNumber;
import org.egov.tracer.model.CustomException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;

@Service
public class OnboardingService {

    private static final Pattern ACCOUNT_CODE = Pattern.compile("^[A-Z0-9][A-Z0-9-]{1,31}$");
    private static final Pattern SLUG = Pattern.compile("^[a-z0-9][a-z0-9-]{1,62}$");
    private static final int TENANT_METADATA_SCHEMA_VERSION = 1;
    private static final Set<String> TENANT_METADATA_FIELDS = Set.of("schemaVersion", "tenantAdmin");
    private static final Set<String> TENANT_ADMIN_FIELDS = Set.of("mobileNumber", "countryCode");
    private static final PhoneNumberUtil PHONE_NUMBERS = PhoneNumberUtil.getInstance();
    // Normal onboarding creates an independent root. Dotted ids are reserved
    // for a separate, explicit subtenant operation and are never derived here.
    private static final Pattern TENANT_ID = Pattern.compile("^[a-z]{2,63}$");
    // Both are the same user-typed value, and both derive the same tenant id.
    private static final Set<String> DERIVES_TENANT_ID = Set.of("URL_SLUG", "ORGANIZATION_ALIAS");
    // Mobile lines only. Fixed-line, toll-free and VoIP numbers are valid for a
    // region but egov-user rejects them at DIGIT_ACCOUNT, well after submit.
    private static final Set<PhoneNumberType> MOBILE_TYPES =
            Set.of(PhoneNumberType.MOBILE, PhoneNumberType.FIXED_LINE_OR_MOBILE);

    private final OnboardingRepository repository;

    public OnboardingService(OnboardingRepository repository) {
        this.repository = repository;
    }

    @Transactional
    public OnboardingSignup create(OnboardingPrincipal principal, Map<String, Object> values,
                                   String idempotencyKey) {
        requireIdempotencyKey(idempotencyKey);
        OnboardingSignup existing = repository.findSignupByOwner(principal.getIssuer(), principal.getSubject())
                .orElse(null);
        if (existing != null) return existing;

        long now = System.currentTimeMillis();
        OnboardingSignup signup = OnboardingSignup.builder()
                .id(UUID.randomUUID()).ownerIssuer(principal.getIssuer()).ownerSubject(principal.getSubject())
                .status("DRAFT").version(1).createdAt(now).updatedAt(now).build();
        apply(signup, values);
        // A double-click races the read above. The insert yields to the winner
        // instead of raising, so the loser returns the same draft rather than a 500.
        if (repository.insertSignup(signup, idempotencyKey.trim())) return signup;
        return repository.findSignupByOwner(principal.getIssuer(), principal.getSubject())
                .orElseThrow(() -> new CustomException(
                        "ONBOARDING_SIGNUP_NOT_FOUND", "Signup was not found"));
    }

    @Transactional
    public OnboardingSignup update(OnboardingPrincipal principal, Map<String, Object> values) {
        UUID id = requiredUuid(values.get("id"), "Signup.id");
        OnboardingSignup signup = ownedSignup(id, principal);
        if (!"DRAFT".equals(signup.getStatus())) {
            throw new CustomException("ONBOARDING_DRAFT_LOCKED", "Only a draft signup can be edited");
        }
        if (repository.findOperationBySignup(id).isPresent()) {
            // A reopened draft (see OnboardingWorkerService) already has a tenant and
            // organization materialized under these names. Only the field the worker
            // rejected may change; anything else would orphan that provisioned state.
            applyKeepingProvisionedIdentifiers(signup, values);
        } else {
            apply(signup, values);
        }
        signup.setUpdatedAt(System.currentTimeMillis());
        return repository.updateSignup(signup);
    }

    public List<OnboardingSignup> search(OnboardingPrincipal principal, Map<String, Object> values) {
        Object id = values.get("id");
        if (id == null) {
            return repository.findSignupByOwner(principal.getIssuer(), principal.getSubject())
                    .map(Collections::singletonList).orElseGet(Collections::emptyList);
        }
        return repository.findOwnedSignup(requiredUuid(id, "Signup.id"), principal.getIssuer(), principal.getSubject())
                .map(Collections::singletonList).orElseGet(Collections::emptyList);
    }

    public Map<String, Object> checkIdentifier(OnboardingPrincipal principal, Map<String, Object> values) {
        String type = requiredString(values.get("type"), "Identifier.type").toUpperCase(Locale.ROOT);
        String value = normalizeIdentifier(type, requiredString(values.get("value"), "Identifier.value"));
        UUID signupId = values.get("signupId") == null ? null : requiredUuid(values.get("signupId"), "Identifier.signupId");
        if (signupId != null) ownedSignup(signupId, principal);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("type", type);
        result.put("value", value);
        boolean available = repository.identifierAvailable(type, value, signupId);
        result.put("available", available);
        if (!available) result.put("conflictingType", type);
        // "bomet-county" and "bometcounty" derive the same tenant id, and so do
        // "bomet-2" and "bomet-3". Answer for the derived id here, or submit fails
        // on TENANT_ID: a field the tenant admin never typed.
        if (DERIVES_TENANT_ID.contains(type)) {
            String derived = tenantSegment(value);
            result.put("derivedTenantId", derived);
            if (available && !repository.identifierAvailable("TENANT_ID", derived, signupId)) {
                result.put("available", false);
                result.put("conflictingType", "TENANT_ID");
            }
        }
        return result;
    }

    @Transactional
    public OnboardingOperation submit(OnboardingPrincipal principal, Map<String, Object> values,
                                      String idempotencyKey) {
        requireIdempotencyKey(idempotencyKey);
        UUID signupId = requiredUuid(values.get("id"), "Signup.id");
        OnboardingSignup signup = repository.findOwnedSignupForUpdate(
                        signupId, principal.getIssuer(), principal.getSubject())
                .orElseThrow(() -> new CustomException(
                        "ONBOARDING_SIGNUP_NOT_FOUND", "Signup was not found"));
        OnboardingOperation existing = repository.findOperationBySignup(signup.getId()).orElse(null);
        // The replay still comes back before the DRAFT guard: a resumed signup keeps
        // its retry action (#2078). Only a reopened draft falls through to re-submit.
        if (existing != null && !isReopened(signup, existing)) return existing;
        if (!"DRAFT".equals(signup.getStatus())) {
            throw new CustomException("ONBOARDING_DRAFT_LOCKED", "Signup cannot be submitted in its current state");
        }
        validateComplete(signup);
        long now = System.currentTimeMillis();
        repository.reserveIdentifier("ACCOUNT_CODE", signup.getAccountCode(), signup.getId(), now);
        repository.reserveIdentifier("ORGANIZATION_NAME", normalizeOrganizationName(signup.getAccountName()), signup.getId(), now);
        repository.reserveIdentifier("TENANT_ID", signup.getRequestedTenantId(), signup.getId(), now);
        repository.reserveIdentifier("ORGANIZATION_ALIAS", signup.getOrganizationAlias(), signup.getId(), now);
        repository.reserveIdentifier("URL_SLUG", signup.getUrlSlug(), signup.getId(), now);
        return existing == null
                ? repository.submit(signup, idempotencyKey.trim(), now)
                : repository.resubmit(existing, idempotencyKey.trim(), now);
    }

    /**
     * The operation a replayed {@code _submit} returns unchanged. The controller asks
     * first so a retry after a timeout answers 202 with its operation instead of
     * failing the availability loop on identifiers the worker has already materialized.
     */
    public Optional<OnboardingOperation> replayOperation(OnboardingPrincipal principal, Map<String, Object> values) {
        OnboardingSignup signup = ownedSignup(requiredUuid(values.get("id"), "Signup.id"), principal);
        return repository.findOperationBySignup(signup.getId())
                .filter(operation -> !isReopened(signup, operation));
    }

    /** A draft handed back to the tenant admin to correct after a user-correctable failure. */
    private boolean isReopened(OnboardingSignup signup, OnboardingOperation operation) {
        return "DRAFT".equals(signup.getStatus()) && "TERMINAL_FAILED".equals(operation.getStatus());
    }

    public List<OnboardingOperation> searchOperations(OnboardingPrincipal principal, Map<String, Object> values) {
        UUID id = requiredUuid(values.get("id"), "Operation.id");
        return repository.findOwnedOperation(id, principal.getIssuer(), principal.getSubject())
                .map(Collections::singletonList).orElseGet(Collections::emptyList);
    }

    @Transactional
    public OnboardingOperation retry(OnboardingPrincipal principal, Map<String, Object> values) {
        UUID id = requiredUuid(values.get("id"), "Operation.id");
        OnboardingOperation operation = repository.findOwnedOperation(
                        id, principal.getIssuer(), principal.getSubject())
                .orElseThrow(() -> new CustomException("ONBOARDING_OPERATION_NOT_FOUND", "Operation was not found"));
        return repository.retry(operation, System.currentTimeMillis());
    }

    private OnboardingSignup ownedSignup(UUID id, OnboardingPrincipal principal) {
        return repository.findOwnedSignup(id, principal.getIssuer(), principal.getSubject())
                .orElseThrow(() -> new CustomException("ONBOARDING_SIGNUP_NOT_FOUND", "Signup was not found"));
    }

    @SuppressWarnings("unchecked")
    private void apply(OnboardingSignup signup, Map<String, Object> values) {
        if (values.containsKey("accountName")) signup.setAccountName(clean(values.get("accountName")));
        if (values.containsKey("accountCode")) {
            String code = requiredString(values.get("accountCode"), "Signup.accountCode").toUpperCase(Locale.ROOT);
            if (!ACCOUNT_CODE.matcher(code).matches()) invalid("Signup.accountCode");
            signup.setAccountCode(code);
        }
        if (values.containsKey("urlSlug")) {
            String slug = requiredString(values.get("urlSlug"), "Signup.urlSlug").toLowerCase(Locale.ROOT);
            if (!SLUG.matcher(slug).matches() || tenantSegment(slug).length() < 2) invalid("Signup.urlSlug");
            signup.setUrlSlug(slug);
            signup.setOrganizationAlias(slug);
        }
        if (values.containsKey("countryCode")) {
            String country = requiredString(values.get("countryCode"), "Signup.countryCode").toUpperCase(Locale.ROOT);
            if (!country.matches("^[A-Z]{2}$")) invalid("Signup.countryCode");
            signup.setCountryCode(country);
        }
        if (values.containsKey("languages")) {
            if (!(values.get("languages") instanceof List)) invalid("Signup.languages");
            List<String> languages = new ArrayList<>();
            for (Object language : (List<Object>) values.get("languages")) {
                String code = requiredString(language, "Signup.languages").toLowerCase(Locale.ROOT);
                if (!code.matches("^[a-z]{2,3}(-[a-z0-9]{2,8})?$")) invalid("Signup.languages");
                if (!languages.contains(code)) languages.add(code);
            }
            signup.setLanguages(languages);
        }
        if (values.containsKey("timeZone")) {
            String timeZone = requiredString(values.get("timeZone"), "Signup.timeZone");
            try { ZoneId.of(timeZone); } catch (Exception exception) { invalid("Signup.timeZone"); }
            signup.setTimeZone(timeZone);
        }
        if (values.containsKey("financialYearPolicy")) {
            signup.setFinancialYearPolicy(requiredString(values.get("financialYearPolicy"), "Signup.financialYearPolicy"));
        }
        if (values.containsKey("acceptedTermsVersion")) {
            signup.setAcceptedTermsVersion(requiredString(values.get("acceptedTermsVersion"), "Signup.acceptedTermsVersion"));
        }
        if (values.containsKey("tenantMetadata")) {
            if (!(values.get("tenantMetadata") instanceof Map)) invalid("Signup.tenantMetadata");
            signup.setTenantMetadata(normalizeTenantMetadata(
                    (Map<String, Object>) values.get("tenantMetadata"), signup.getCountryCode(), false));
        } else if (values.containsKey("countryCode") && signup.getTenantMetadata() != null
                && !signup.getTenantMetadata().isEmpty()) {
            // Country is the single source for phone validation and dial prefix.
            // Re-normalize an existing draft contact when it changes.
            signup.setTenantMetadata(normalizeTenantMetadata(
                    signup.getTenantMetadata(), signup.getCountryCode(), false));
        }

        // These identifiers are server-owned projections of the tenant admin's choices.
        // Never accept a client-supplied alias or tenant id that can drift from them.
        signup.setOrganizationAlias(signup.getUrlSlug());
        signup.setRequestedTenantId(signup.getUrlSlug() == null
                ? null
                : tenantSegment(signup.getUrlSlug()));
    }

    private void applyKeepingProvisionedIdentifiers(OnboardingSignup signup, Map<String, Object> values) {
        String accountName = signup.getAccountName();
        String accountCode = signup.getAccountCode();
        String urlSlug = signup.getUrlSlug();
        String countryCode = signup.getCountryCode();
        apply(signup, values);
        if (!Objects.equals(accountName, signup.getAccountName())
                || !Objects.equals(accountCode, signup.getAccountCode())
                || !Objects.equals(urlSlug, signup.getUrlSlug())
                || !Objects.equals(countryCode, signup.getCountryCode())) {
            throw new CustomException("ONBOARDING_PROVISIONED_FIELD_LOCKED",
                    "Provisioned identifiers cannot change after a failed submission");
        }
    }

    /** The slug's letters only: DIGIT tenant codes cannot carry digits or hyphens. */
    private static String tenantSegment(String slug) {
        return slug.replaceAll("[^a-z]", "");
    }

    private void validateComplete(OnboardingSignup signup) {
        requiredString(signup.getAccountName(), "Signup.accountName");
        requiredString(signup.getAccountCode(), "Signup.accountCode");
        requiredString(signup.getUrlSlug(), "Signup.urlSlug");
        requiredString(signup.getOrganizationAlias(), "Signup.organizationAlias");
        requiredString(signup.getRequestedTenantId(), "Signup.requestedTenantId");
        requiredString(signup.getCountryCode(), "Signup.countryCode");
        requiredString(signup.getTimeZone(), "Signup.timeZone");
        requiredString(signup.getFinancialYearPolicy(), "Signup.financialYearPolicy");
        requiredString(signup.getAcceptedTermsVersion(), "Signup.acceptedTermsVersion");
        if (signup.getLanguages() == null || signup.getLanguages().isEmpty()) {
            throw new CustomException("ONBOARDING_VALIDATION_ERROR", "Signup.languages is required");
        }
        signup.setTenantMetadata(normalizeTenantMetadata(
                signup.getTenantMetadata(), signup.getCountryCode(), true));
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> normalizeTenantMetadata(Map<String, Object> metadata, String countryCode,
                                                        boolean contactRequired) {
        if (metadata == null || metadata.isEmpty()) {
            if (contactRequired) required("Signup.tenantMetadata");
            return new LinkedHashMap<>();
        }
        if (!TENANT_METADATA_FIELDS.containsAll(metadata.keySet())) invalid("Signup.tenantMetadata");

        Object version = metadata.get("schemaVersion");
        if (!(version instanceof Number)
                || ((Number) version).doubleValue() != TENANT_METADATA_SCHEMA_VERSION) {
            invalid("Signup.tenantMetadata.schemaVersion");
        }

        Object tenantAdminValue = metadata.get("tenantAdmin");
        if (tenantAdminValue == null && !contactRequired) {
            return new LinkedHashMap<>(Map.of("schemaVersion", TENANT_METADATA_SCHEMA_VERSION));
        }
        if (!(tenantAdminValue instanceof Map)) invalid("Signup.tenantMetadata.tenantAdmin");
        Map<String, Object> tenantAdmin = (Map<String, Object>) tenantAdminValue;
        if (!TENANT_ADMIN_FIELDS.containsAll(tenantAdmin.keySet())) {
            invalid("Signup.tenantMetadata.tenantAdmin");
        }

        String mobile = clean(tenantAdmin.get("mobileNumber"));
        if (mobile == null) {
            if (contactRequired) required("Signup.tenantMetadata.tenantAdmin.mobileNumber");
            return new LinkedHashMap<>(Map.of(
                    "schemaVersion", TENANT_METADATA_SCHEMA_VERSION,
                    "tenantAdmin", new LinkedHashMap<>()));
        }
        String region = requiredString(countryCode, "Signup.countryCode").toUpperCase(Locale.ROOT);
        try {
            PhoneNumber number = PHONE_NUMBERS.parse(mobile, region);
            if (!PHONE_NUMBERS.isValidNumberForRegion(number, region)
                    || !MOBILE_TYPES.contains(PHONE_NUMBERS.getNumberType(number))) {
                invalid("Signup.tenantMetadata.tenantAdmin.mobileNumber");
            }
            String dialCode = "+" + number.getCountryCode();
            String suppliedDialCode = clean(tenantAdmin.get("countryCode"));
            if (suppliedDialCode != null && !dialCode.equals(suppliedDialCode)) {
                invalid("Signup.tenantMetadata.tenantAdmin.countryCode");
            }
            Map<String, Object> normalizedAdmin = new LinkedHashMap<>();
            normalizedAdmin.put("mobileNumber", PHONE_NUMBERS.getNationalSignificantNumber(number));
            normalizedAdmin.put("countryCode", dialCode);
            Map<String, Object> normalized = new LinkedHashMap<>();
            normalized.put("schemaVersion", TENANT_METADATA_SCHEMA_VERSION);
            normalized.put("tenantAdmin", normalizedAdmin);
            return normalized;
        } catch (NumberParseException exception) {
            invalid("Signup.tenantMetadata.tenantAdmin.mobileNumber");
            return Collections.emptyMap(); // unreachable: invalid always throws
        }
    }

    private String normalizeIdentifier(String type, String value) {
        switch (type) {
            case "ACCOUNT_CODE":
                value = value.toUpperCase(Locale.ROOT);
                if (!ACCOUNT_CODE.matcher(value).matches()) invalid("Identifier.value");
                return value;
            case "ORGANIZATION_NAME":
                return normalizeOrganizationName(value);
            case "TENANT_ID":
                value = value.toLowerCase(Locale.ROOT);
                if (!TENANT_ID.matcher(value).matches()) invalid("Identifier.value");
                return value;
            case "ORGANIZATION_ALIAS":
            case "URL_SLUG":
                value = value.toLowerCase(Locale.ROOT);
                // Same bar as apply(): a slug that cannot derive a tenant id is not a
                // free slug, it is an unusable one. Say so here rather than at submit.
                if (!SLUG.matcher(value).matches() || tenantSegment(value).length() < 2) {
                    invalid("Identifier.value");
                }
                return value;
            default:
                throw new CustomException("ONBOARDING_IDENTIFIER_TYPE_INVALID", "Unsupported identifier type");
        }
    }

    public static String normalizeOrganizationName(String value) {
        return value.trim().replaceAll("\\s+", " ").toLowerCase(Locale.ROOT);
    }

    private void requireIdempotencyKey(String value) {
        if (value == null || value.isBlank() || value.length() > 128) {
            throw new CustomException("ONBOARDING_IDEMPOTENCY_REQUIRED", "A valid Idempotency-Key is required");
        }
    }

    private UUID requiredUuid(Object value, String field) {
        try {
            return UUID.fromString(requiredString(value, field));
        } catch (IllegalArgumentException exception) {
            throw new CustomException("ONBOARDING_VALIDATION_ERROR", field + " is invalid");
        }
    }

    private String requiredString(Object value, String field) {
        String result = clean(value);
        if (result == null) throw new CustomException("ONBOARDING_VALIDATION_ERROR", field + " is required");
        return result;
    }

    private String clean(Object value) {
        if (value == null) return null;
        String result = value.toString().trim();
        return result.isEmpty() ? null : result;
    }

    private void invalid(String field) {
        throw new CustomException("ONBOARDING_VALIDATION_ERROR", field + " is invalid");
    }

    private void required(String field) {
        throw new CustomException("ONBOARDING_VALIDATION_ERROR", field + " is required");
    }
}
