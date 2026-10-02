package org.egov.pgr.onboarding;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.ArrayList;
import java.util.List;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

@Data
@Builder(toBuilder = true)
@NoArgsConstructor
@AllArgsConstructor
public class OnboardingSignup {
    private UUID id;
    private String ownerIssuer;
    private String ownerSubject;
    private String status;
    private String accountName;
    private String accountCode;
    private String organizationAlias;
    private String requestedTenantId;
    private String urlSlug;
    private String countryCode;
    @Builder.Default
    private List<String> languages = new ArrayList<>();
    private String timeZone;
    private String financialYearPolicy;
    private String acceptedTermsVersion;
    @Builder.Default
    private Map<String, Object> tenantMetadata = new LinkedHashMap<>();
    private long version;
    private long createdAt;
    private long updatedAt;
}
