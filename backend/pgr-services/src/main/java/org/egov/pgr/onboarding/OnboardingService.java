package org.egov.pgr.onboarding;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.egov.tracer.model.CustomException;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.io.IOException;
import java.io.UncheckedIOException;
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

    private static final int TENANT_METADATA_SCHEMA_VERSION = 1;
    private static final Set<String> TENANT_METADATA_FIELDS = Set.of("schemaVersion", "tenantAdmin");
    private static final Set<String> TENANT_ADMIN_FIELDS = Set.of("mobileNumber", "countryCode");

    private final OnboardingRepository repository;
    private final OnboardingIdentifierService identifiers;
    // Countries the platform baseline carries a mobile rule for. The worker cannot provision
    // any other country (COUNTRY_NOT_SUPPORTED), so an unsupported one is refused here,
    // before anything runs.
    private final Set<String> supportedCountries;
    // Each country's dial code and mobile rule, compiled once: a seed rule that doesn't compile stops
    // the service at start-up instead of failing a founder's signup.
    private final Map<String, MobileRule> mobileRules;

    private record MobileRule(String dialCode, Pattern pattern) {
    }

    @Autowired
    public OnboardingService(OnboardingRepository repository, OnboardingIdentifierService identifiers,
                             PlatformBaseline baseline) {
        this.repository = repository;
        this.identifiers = identifiers;
        this.supportedCountries = baseline.supportedCountries();
        this.mobileRules = compileMobileRules(baseline);
    }

    private static Map<String, MobileRule> compileMobileRules(PlatformBaseline baseline) {
        Map<String, MobileRule> rules = new LinkedHashMap<>();
        for (String country : baseline.supportedCountries()) {
            JsonNode rule = baseline.countryMobileRule(country);
            String dialCode = rule.path("countryCode").asText();
            String regex = rule.path("mobileNumberRegex").asText();
            if (!dialCode.matches("^\\+\\d+$") || regex.isEmpty()) {
                throw new IllegalStateException("Platform baseline countryMobileRules." + country
                        + " needs a countryCode like +254 and a mobileNumberRegex");
            }
            try {
                rules.put(country, new MobileRule(dialCode, Pattern.compile(regex)));
            } catch (java.util.regex.PatternSyntaxException exception) {
                throw new IllegalStateException("Platform baseline countryMobileRules." + country
                        + ".mobileNumberRegex does not compile: " + regex, exception);
            }
        }
        return Collections.unmodifiableMap(rules);
    }

    /** Uses the committed platform baseline. */
    OnboardingService(OnboardingRepository repository, OnboardingIdentifierService identifiers) {
        this(repository, identifiers, committedBaseline());
    }

    private static PlatformBaseline committedBaseline() {
        try {
            return new PlatformBaseline(new ObjectMapper());
        } catch (IOException exception) {
            throw new UncheckedIOException(exception);
        }
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
        Optional<OnboardingOperation> prior = repository.findOperationBySignup(id);
        if (prior.isPresent()) {
            if (prior.get().getLifecycleDecision() != null && prior.get().getLifecyclePublishedAt() == null)
                throw new CustomException("ONBOARDING_PUBLICATION_PENDING", "The previous attempt is still settling");
            // A reopened draft (see OnboardingWorkerService) already has a tenant and
            // organization materialized under these names. Only the field the worker
            // rejected may change; anything else would orphan that provisioned state.
            applyKeepingProvisionedIdentifiers(signup, values, prior.get());
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
        List<OnboardingIdentifierService.Identifier> candidates = identifiers.forInput(
                requiredString(values.get("type"), "Identifier.type"),
                requiredString(values.get("value"), "Identifier.value"));
        OnboardingIdentifierService.Identifier requested = candidates.get(0);
        UUID signupId = values.get("signupId") == null ? null : requiredUuid(values.get("signupId"), "Identifier.signupId");
        if (signupId != null) ownedSignup(signupId, principal);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("type", requested.type());
        result.put("value", requested.value());
        if (candidates.size() > 1) result.put("derivedTenantId", candidates.get(1).value());
        result.put("available", true);
        for (OnboardingIdentifierService.Identifier candidate : candidates) {
            if (reserved(candidate) || !repository.identifierAvailable(candidate.type(), candidate.value(), signupId)) {
                result.put("available", false);
                result.put("conflictingType", candidate.type());
                break;
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
        repository.snapshotFounder(signup.getId(), principal);
        long now = System.currentTimeMillis();
        for (OnboardingIdentifierService.Identifier identifier : identifiers.forSignup(signup)) {
            if (reserved(identifier)) {
                throw new CustomException("ONBOARDING_IDENTIFIER_TAKEN", identifier.type() + " is already in use");
            }
        }
        for (OnboardingIdentifierService.Identifier identifier : identifiers.forSignup(signup)) {
            repository.reserveIdentifier(identifier.type(), identifier.value(), signup.getId(), now);
        }
        return existing == null
                ? repository.submit(signup, idempotencyKey.trim(), now)
                : repository.resubmit(existing, idempotencyKey.trim(), now);
    }

    /** A platform tenant id (default, a state root): never available, though no workspace holds it. */
    private boolean reserved(OnboardingIdentifierService.Identifier identifier) {
        return "TENANT_ID".equals(identifier.type()) && identifiers.reservedTenantId(identifier.value());
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

    public boolean hasPriorAttempt(UUID signupId) {
        return repository.findOperationBySignup(signupId).isPresent();
    }

    public List<OnboardingOperation> searchOperations(OnboardingPrincipal principal, Map<String, Object> values) {
        // By signup: after a reload the page knows only its signup, and a reopened draft's
        // failed run is what explains why it is back in the founder's hands.
        if (values.get("id") == null && values.get("signupId") != null) {
            return repository.findOwnedSignup(requiredUuid(values.get("signupId"), "Operation.signupId"),
                            principal.getIssuer(), principal.getSubject())
                    .flatMap(signup -> repository.findOperationBySignup(signup.getId()))
                    .map(Collections::singletonList).orElseGet(Collections::emptyList);
        }
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
        // Same lock order as submit: signup, then operation. A worker claim that won
        // first makes retry fail without changing the snapshot used by that worker.
        repository.findOwnedSignupForUpdate(operation.getSignupId(), principal.getIssuer(), principal.getSubject())
                .orElseThrow(() -> new CustomException("ONBOARDING_SIGNUP_NOT_FOUND", "Signup was not found"));
        OnboardingOperation retried = repository.retry(operation, System.currentTimeMillis());
        repository.snapshotFounder(operation.getSignupId(), principal);
        return retried;
    }

    private OnboardingSignup ownedSignup(UUID id, OnboardingPrincipal principal) {
        return repository.findOwnedSignup(id, principal.getIssuer(), principal.getSubject())
                .orElseThrow(() -> new CustomException("ONBOARDING_SIGNUP_NOT_FOUND", "Signup was not found"));
    }

    @SuppressWarnings("unchecked")
    private void apply(OnboardingSignup signup, Map<String, Object> values) {
        if (values.containsKey("accountName")) signup.setAccountName(clean(values.get("accountName")));
        if (values.containsKey("accountCode")) {
            signup.setAccountCode(identifiers.accountCode(
                    requiredString(values.get("accountCode"), "Signup.accountCode"), "Signup.accountCode"));
        }
        if (values.containsKey("urlSlug")) {
            String slug = identifiers.urlSlug(
                    requiredString(values.get("urlSlug"), "Signup.urlSlug"), "Signup.urlSlug");
            signup.setUrlSlug(slug);
            signup.setOrganizationAlias(slug);
        }
        if (values.containsKey("countryCode")) {
            String country = requiredString(values.get("countryCode"), "Signup.countryCode").toUpperCase(Locale.ROOT);
            if (!country.matches("^[A-Z]{2}$")) invalid("Signup.countryCode");
            requireSupportedCountry(country);
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
            // Re-normalize an existing draft contact when it changes. The stored dial code
            // was derived from the old country, so it goes, and the new country's replaces it.
            signup.setTenantMetadata(normalizeTenantMetadata(
                    withoutDialCode(signup.getTenantMetadata()), signup.getCountryCode(), false));
        }

        // These identifiers are server-owned projections of the tenant admin's choices.
        // Never accept a client-supplied alias or tenant id that can drift from them.
        signup.setOrganizationAlias(signup.getUrlSlug());
        signup.setRequestedTenantId(signup.getUrlSlug() == null
                ? null
                : identifiers.tenantIdForSlug(signup.getUrlSlug()));
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> withoutDialCode(Map<String, Object> metadata) {
        Map<String, Object> copy = new LinkedHashMap<>(metadata);
        if (copy.get("tenantAdmin") instanceof Map) {
            Map<String, Object> tenantAdmin = new LinkedHashMap<>((Map<String, Object>) copy.get("tenantAdmin"));
            tenantAdmin.remove("countryCode");
            copy.put("tenantAdmin", tenantAdmin);
        }
        return copy;
    }

    private void applyKeepingProvisionedIdentifiers(OnboardingSignup signup, Map<String, Object> values,
                                                    OnboardingOperation failed) {
        String tenantId = signup.getRequestedTenantId();
        String accountCode = signup.getAccountCode();

        String countryCode = signup.getCountryCode();
        apply(signup, values);
        signup.setRequestedTenantId(tenantId);
        // A run refused for its country stopped at the mobile rule, before anything that depends on
        // the country was written, and the re-submitted run rewrites the tenant record's country.
        // So that is the one case where the country may change: it is what the founder must fix.
        boolean countryRefused = "COUNTRY_NOT_SUPPORTED".equalsIgnoreCase(failed.getErrorCode());
        if (!Objects.equals(accountCode, signup.getAccountCode())
                || !countryRefused && !Objects.equals(countryCode, signup.getCountryCode())) {
            throw new CustomException("ONBOARDING_PROVISIONED_FIELD_LOCKED",
                    "Provisioned identifiers cannot change after a failed submission");
        }
    }

    private void validateComplete(OnboardingSignup signup) {
        requiredString(signup.getAccountName(), "Signup.accountName");
        requiredString(signup.getAccountCode(), "Signup.accountCode");
        requiredString(signup.getUrlSlug(), "Signup.urlSlug");
        requiredString(signup.getOrganizationAlias(), "Signup.organizationAlias");
        requiredString(signup.getRequestedTenantId(), "Signup.requestedTenantId");
        requireSupportedCountry(requiredString(signup.getCountryCode(), "Signup.countryCode"));
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
        // The country's rule in the platform baseline is the only mobile check. PLATFORM_BASELINE
        // writes it as the workspace's common-masters.MobileNumberValidation and egov-user enforces
        // it at FOUNDER_HRMS, so a number saved here is never refused there, nor the other way round.
        MobileRule rule = mobileRules.get(region);
        if (rule == null) throw new CustomException("ONBOARDING_VALIDATION_ERROR", "Signup.countryCode is not supported");
        String dialCode = rule.dialCode();
        String national = nationalMobile(mobile, dialCode, rule.pattern());
        if (national == null) invalid("Signup.tenantMetadata.tenantAdmin.mobileNumber");
        String suppliedDialCode = clean(tenantAdmin.get("countryCode"));
        if (suppliedDialCode != null && !dialCode.equals(suppliedDialCode)) {
            invalid("Signup.tenantMetadata.tenantAdmin.countryCode");
        }
        Map<String, Object> normalizedAdmin = new LinkedHashMap<>();
        normalizedAdmin.put("mobileNumber", national);
        normalizedAdmin.put("countryCode", dialCode);
        Map<String, Object> normalized = new LinkedHashMap<>();
        normalized.put("schemaVersion", TENANT_METADATA_SCHEMA_VERSION);
        normalized.put("tenantAdmin", normalizedAdmin);
        return normalized;
    }

    /**
     * The national number in what was typed, or null when it fails the rule. Spaces, dashes and
     * brackets, the dial code with "+", "00" or neither, and a leading trunk 0 are accepted. The
     * configurator's nationalMobile (onboarding/signup/mobileRules.ts) reads a number the same way.
     */
    static String nationalMobile(String input, String dialCode, Pattern rule) {
        String dial = dialCode.replaceFirst("^\\+", "");
        String digits = input.replaceAll("[\\s().-]", "");
        if (digits.startsWith("00")) digits = "+" + digits.substring(2);
        if (digits.startsWith("+")) {
            if (!digits.startsWith("+" + dial)) return null;
            digits = digits.substring(dial.length() + 1);
        }
        if (!digits.matches("\\d+")) return null;
        List<String> candidates = new ArrayList<>(List.of(digits));
        if (digits.startsWith(dial)) candidates.add(digits.substring(dial.length()));
        if (digits.startsWith("0")) candidates.add(digits.substring(1));
        return candidates.stream().filter(candidate -> rule.matcher(candidate).matches()).findFirst().orElse(null);
    }

    private void requireSupportedCountry(String country) {
        if (!supportedCountries.contains(country.toUpperCase(Locale.ROOT))) {
            throw new CustomException("ONBOARDING_VALIDATION_ERROR", "Signup.countryCode is not supported");
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

    private void required(String field) {
        throw new CustomException("ONBOARDING_VALIDATION_ERROR", field + " is required");
    }
}
