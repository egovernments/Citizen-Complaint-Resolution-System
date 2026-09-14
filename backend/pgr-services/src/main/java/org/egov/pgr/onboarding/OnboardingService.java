package org.egov.pgr.onboarding;

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
import java.util.UUID;
import java.util.regex.Pattern;

@Service
public class OnboardingService {

    private static final Pattern ACCOUNT_CODE = Pattern.compile("^[A-Z0-9][A-Z0-9-]{1,31}$");
    private static final Pattern SLUG = Pattern.compile("^[a-z0-9][a-z0-9-]{1,62}$");
    private static final Pattern TENANT_ID = Pattern.compile("^[a-z0-9][a-z0-9.-]{1,255}$");

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
        return repository.insertSignup(signup, idempotencyKey.trim());
    }

    @Transactional
    public OnboardingSignup update(OnboardingPrincipal principal, Map<String, Object> values) {
        UUID id = requiredUuid(values.get("id"), "Signup.id");
        OnboardingSignup signup = ownedSignup(id, principal);
        if (!"DRAFT".equals(signup.getStatus())) {
            throw new CustomException("ONBOARDING_DRAFT_LOCKED", "Only a draft signup can be edited");
        }
        apply(signup, values);
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
        result.put("available", repository.identifierAvailable(type, value, signupId));
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
        if (existing != null) return existing;
        if (!"DRAFT".equals(signup.getStatus())) {
            throw new CustomException("ONBOARDING_DRAFT_LOCKED", "Signup cannot be submitted in its current state");
        }
        validateComplete(signup);
        long now = System.currentTimeMillis();
        repository.reserveIdentifier("ACCOUNT_CODE", signup.getAccountCode(), signup.getId(), now);
        repository.reserveIdentifier("TENANT_ID", signup.getRequestedTenantId(), signup.getId(), now);
        repository.reserveIdentifier("ORGANIZATION_ALIAS", signup.getOrganizationAlias(), signup.getId(), now);
        repository.reserveIdentifier("URL_SLUG", signup.getUrlSlug(), signup.getId(), now);
        return repository.submit(signup, idempotencyKey.trim(), now);
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
            if (!SLUG.matcher(slug).matches()) invalid("Signup.urlSlug");
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
            // Stored as a versioned draft snapshot. Projection adapters decide which
            // values become tenant/MDMS records after the signup is submitted.
            signup.setTenantMetadata(new LinkedHashMap<>((Map<String, Object>) values.get("tenantMetadata")));
        }

        // These identifiers are server-owned projections of the founder's choices.
        // Never accept a client-supplied alias or tenant id that can drift from them.
        signup.setOrganizationAlias(signup.getUrlSlug());
        signup.setRequestedTenantId(signup.getCountryCode() == null || signup.getUrlSlug() == null
                ? null
                : signup.getCountryCode().toLowerCase(Locale.ROOT) + "." + signup.getUrlSlug());
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
    }

    private String normalizeIdentifier(String type, String value) {
        switch (type) {
            case "ACCOUNT_CODE":
                value = value.toUpperCase(Locale.ROOT);
                if (!ACCOUNT_CODE.matcher(value).matches()) invalid("Identifier.value");
                return value;
            case "TENANT_ID":
                value = value.toLowerCase(Locale.ROOT);
                if (!TENANT_ID.matcher(value).matches()) invalid("Identifier.value");
                return value;
            case "ORGANIZATION_ALIAS":
            case "URL_SLUG":
                value = value.toLowerCase(Locale.ROOT);
                if (!SLUG.matcher(value).matches()) invalid("Identifier.value");
                return value;
            default:
                throw new CustomException("ONBOARDING_IDENTIFIER_TYPE_INVALID", "Unsupported identifier type");
        }
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
}
