package org.egov.pgr.onboarding;

import org.egov.tracer.model.CustomException;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.mockito.Mock;
import org.mockito.junit.MockitoJUnitRunner;

import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@RunWith(MockitoJUnitRunner.class)
public class OnboardingServiceTest {

    @Mock private OnboardingRepository repository;
    private OnboardingService service;
    private OnboardingPrincipal principal;

    @Before
    public void setUp() {
        service = new OnboardingService(repository);
        principal = new OnboardingPrincipal("https://issuer", "subject-1", "person@example.com", "Person");
    }

    @Test
    public void createDerivesServerOwnedIdentifiersAndKeepsMetadataInDraft() {
        when(repository.findSignupByOwner("https://issuer", "subject-1")).thenReturn(Optional.empty());
        when(repository.insertSignup(any(OnboardingSignup.class), eq("create-1")))
                .thenAnswer(invocation -> invocation.getArgument(0));
        Map<String, Object> metadata = new LinkedHashMap<>();
        metadata.put("serviceCategories", Arrays.asList("roads", "water"));
        Map<String, Object> request = completeRequest(metadata);
        request.put("organizationAlias", "client-must-not-own-this");
        request.put("requestedTenantId", "client.must-not-own-this");

        OnboardingSignup signup = service.create(principal, request, "create-1");

        assertEquals("bomet-county", signup.getOrganizationAlias());
        assertEquals("bometcounty", signup.getRequestedTenantId());
        assertEquals(metadata, signup.getTenantMetadata());
        assertEquals("DRAFT", signup.getStatus());
        assertNotNull(signup.getId());
    }

    @Test
    public void submitAtomicallyReservesEveryDerivedIdentifier() {
        UUID signupId = UUID.randomUUID();
        OnboardingSignup signup = signup(signupId);
        OnboardingOperation operation = OnboardingOperation.builder()
                .id(UUID.randomUUID()).signupId(signupId).status("PENDING").attempt(1).build();
        when(repository.findOwnedSignupForUpdate(signupId, "https://issuer", "subject-1"))
                .thenReturn(Optional.of(signup));
        when(repository.findOperationBySignup(signupId)).thenReturn(Optional.empty());
        when(repository.submit(eq(signup), eq("submit-1"), anyLong())).thenReturn(operation);

        assertEquals(operation, service.submit(
                principal, Collections.singletonMap("id", signupId.toString()), "submit-1"));

        verify(repository).reserveIdentifier(eq("ACCOUNT_CODE"), eq("BOMET"), eq(signupId), anyLong());
        verify(repository).reserveIdentifier(eq("ORGANIZATION_NAME"), eq("bomet county"), eq(signupId), anyLong());
        verify(repository).reserveIdentifier(eq("TENANT_ID"), eq("bometcounty"), eq(signupId), anyLong());
        verify(repository).reserveIdentifier(eq("ORGANIZATION_ALIAS"), eq("bomet-county"), eq(signupId), anyLong());
        verify(repository).reserveIdentifier(eq("URL_SLUG"), eq("bomet-county"), eq(signupId), anyLong());
    }

    @Test
    public void updateCannotCrossTheAuthenticatedFounderBoundary() {
        UUID signupId = UUID.randomUUID();
        when(repository.findOwnedSignup(signupId, "https://issuer", "subject-1"))
                .thenReturn(Optional.empty());

        assertThrows(CustomException.class, () -> service.update(
                principal, Collections.singletonMap("id", signupId.toString())));
    }

    @Test
    public void slugWithoutTwoLettersCannotBecomeADigitTenant() {
        when(repository.findSignupByOwner("https://issuer", "subject-1")).thenReturn(Optional.empty());
        Map<String, Object> request = completeRequest(new LinkedHashMap<>());
        request.put("urlSlug", "a-123");

        assertThrows(CustomException.class, () -> service.create(principal, request, "create-3"));
    }

    private Map<String, Object> completeRequest(Map<String, Object> metadata) {
        Map<String, Object> request = new LinkedHashMap<>();
        request.put("accountName", "Bomet County");
        request.put("accountCode", "BOMET");
        request.put("urlSlug", "bomet-county");
        request.put("countryCode", "KE");
        request.put("languages", Arrays.asList("en", "sw"));
        request.put("timeZone", "Africa/Nairobi");
        request.put("financialYearPolicy", "JULY_JUNE");
        request.put("acceptedTermsVersion", "2026-09");
        request.put("tenantMetadata", metadata);
        return request;
    }

    private OnboardingSignup signup(UUID id) {
        OnboardingSignup signup = OnboardingSignup.builder().id(id)
                .ownerIssuer("https://issuer").ownerSubject("subject-1")
                .status("DRAFT").version(1).build();
        signup.setAccountName("Bomet County");
        signup.setAccountCode("BOMET");
        signup.setUrlSlug("bomet-county");
        signup.setOrganizationAlias("bomet-county");
        signup.setRequestedTenantId("bometcounty");
        signup.setCountryCode("KE");
        signup.setLanguages(Arrays.asList("en", "sw"));
        signup.setTimeZone("Africa/Nairobi");
        signup.setFinancialYearPolicy("JULY_JUNE");
        signup.setAcceptedTermsVersion("2026-09");
        return signup;
    }
}
