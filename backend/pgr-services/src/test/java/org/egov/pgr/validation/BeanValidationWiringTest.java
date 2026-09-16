package org.egov.pgr.validation;

import jakarta.validation.ConstraintViolation;
import jakarta.validation.Validator;
import org.egov.pgr.web.models.Service;
import org.egov.pgr.web.models.RequestSearchCriteria;
import org.egov.pgr.web.models.ServiceRequest;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.validation.beanvalidation.LocalValidatorFactoryBean;

import java.util.Set;
import java.util.stream.Collectors;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Guards the wiring, not the rules.
 *
 * <p>This module previously pinned org.hibernate:hibernate-validator 6.0.16.Final, which
 * registers META-INF/services/javax.validation.spi.ValidationProvider. Boot 3 looks for
 * the jakarta SPI file, found none, and silently skipped ValidationAutoConfiguration - so
 * every @Valid/@NotNull/@Size in the module was dead and nothing failed loudly. These
 * tests fail if that regresses.
 */
class BeanValidationWiringTest {

    private static Validator validator;

    @BeforeAll
    static void setUp() {
        LocalValidatorFactoryBean factory = new LocalValidatorFactoryBean();
        factory.afterPropertiesSet();
        validator = factory.getValidator();
    }

    private static Set<String> paths(Set<? extends ConstraintViolation<?>> violations) {
        return violations.stream().map(v -> v.getPropertyPath().toString()).collect(Collectors.toSet());
    }

    @Test
    void jakartaProviderIsOnTheClasspath() {
        assertTrue(validator.getClass().getName().startsWith("org.hibernate.validator"),
                "expected a Hibernate Validator instance, got " + validator.getClass().getName());
    }

    @Test
    void notNullOnTheRequestEnvelopeIsEnforced() {
        Set<ConstraintViolation<ServiceRequest>> violations = validator.validate(new ServiceRequest());
        assertTrue(paths(violations).contains("requestInfo"),
                "expected a violation on requestInfo, got " + paths(violations));
    }

    @Test
    void validCascadesIntoTheNestedService() {
        ServiceRequest request = ServiceRequest.builder().service(new Service()).build();
        Set<String> violated = paths(validator.validate(request));
        // @Valid on ServiceRequest.service must descend into Service's own @NotNull fields.
        assertTrue(violated.contains("service.tenantId"), "expected service.tenantId, got " + violated);
        assertTrue(violated.contains("service.serviceCode"), "expected service.serviceCode, got " + violated);
    }

    @Test
    void safeHtmlAcceptsPlainTextAndRejectsScript() {
        Service clean = new Service();
        clean.setTenantId("ke.bomet");
        clean.setServiceCode("StreetLightNotWorking");
        clean.setSource("web");
        clean.setDescription("Street light near the market is out");
        assertTrue(paths(validator.validate(clean)).stream().noneMatch(p -> p.equals("description")),
                "plain text description must be accepted");

        Service hostile = new Service();
        hostile.setTenantId("ke.bomet");
        hostile.setServiceCode("StreetLightNotWorking");
        hostile.setSource("web");
        hostile.setDescription("<script>alert(1)</script>");
        assertTrue(paths(validator.validate(hostile)).contains("description"),
                "script payload in description must be rejected");
    }

    @Test
    void ratingBoundsAreEnforced() {
        Service tooHigh = new Service();
        tooHigh.setRating(9);
        assertTrue(paths(validator.validate(tooHigh)).contains("rating"), "rating 9 must violate @Max(5)");
        Service ok = new Service();
        ok.setRating(4);
        assertFalse(paths(validator.validate(ok)).contains("rating"), "rating 4 must be accepted");
    }

    @Test
    void safeHtmlToleratesBareAngleBracketsInOrdinaryText() {
        // Regression: Jsoup.isValid() rejects any string that cleaning would alter,
        // including a bare '<' that is only entity-escaped. Real complaint text
        // contains these, and a 400 on them would be a production bug.
        for (String text : new String[]{
                "Water pressure <2 bar since Monday",
                "Water & sewage overflow on Main St",
                "The children's park gate is broken",
                "Garbage -> not collected for 3 days",
                "Pothole #42 is 80% wider now",
                // whitespace must survive: jsoup's pretty-printer would otherwise
                // normalise these and the constraint would reject valid input
                "Broken pipe\nurgent",
                "Line one\n\nLine two",
                "  padded text  ",
                "col1\tcol2",
                "Broken pipe urgent \uD83D\uDEA8"}) {
            Service s = new Service();
            s.setDescription(text);
            assertFalse(paths(validator.validate(s)).contains("description"),
                    "must accept ordinary complaint text: " + text);
        }
    }

    @Test
    void safeHtmlStillRejectsMarkupThatWouldBeStripped() {
        for (String payload : new String[]{
                "<script>alert(1)</script>",
                "<img src=x onerror=alert(1)>",
                "<iframe src=//evil.com></iframe>",
                "<svg/onload=alert(1)>"}) {
            Service s = new Service();
            s.setDescription(payload);
            assertTrue(paths(validator.validate(s)).contains("description"),
                    "must reject: " + payload);
        }
    }

    @Test
    void safeHtmlAppliesToCollectionElementsNotJustScalars() {
        // Set<@SafeHtml String> is a container-element constraint. A plain field-level
        // @SafeHtml on a Set would make HV look for ConstraintValidator<SafeHtml, Set>
        // and blow up with UnexpectedTypeException, so this guards the TYPE_USE form.
        RequestSearchCriteria hostile = RequestSearchCriteria.builder()
                .serviceCode(Set.of("<script>alert(1)</script>"))
                .build();
        assertTrue(paths(validator.validate(hostile)).stream().anyMatch(p -> p.startsWith("serviceCode")),
                "script payload inside Set<String> must be rejected, got " + paths(validator.validate(hostile)));

        RequestSearchCriteria clean = RequestSearchCriteria.builder()
                .serviceCode(Set.of("StreetLightNotWorking"))
                .locality(Set.of("WARD_001"))
                .build();
        assertTrue(validator.validate(clean).isEmpty(),
                "ordinary search criteria must be accepted, got " + paths(validator.validate(clean)));
    }

    @Test
    void safeHtmlCoversThePgrV1MigrationModels() {
        // MigrationController is @ConditionalOnProperty("migration.enabled") and is not
        // registered in every deployment, so these models cannot always be exercised over
        // HTTP - but they still take an external @RequestBody where they are enabled.
        org.egov.pgr.web.models.pgrV1.Service v1 = new org.egov.pgr.web.models.pgrV1.Service();
        v1.setTenantId("egov");
        v1.setDescription("<script>alert(1)</script>");
        assertTrue(paths(validator.validate(v1)).contains("description"),
                "pgrV1 Service.description must reject script payloads");

        org.egov.pgr.web.models.pgrV1.Citizen citizen = new org.egov.pgr.web.models.pgrV1.Citizen();
        citizen.setName("<img src=x onerror=alert(1)>");
        assertTrue(paths(validator.validate(citizen)).contains("name"),
                "pgrV1 Citizen.name must reject markup");

        // password is deliberately NOT annotated: it may legitimately contain '<' and is
        // never rendered as HTML, so constraining it would only cause false rejections.
        org.egov.pgr.web.models.pgrV1.Citizen pw = new org.egov.pgr.web.models.pgrV1.Citizen();
        pw.setPassword("a<b>c&d");
        assertFalse(paths(validator.validate(pw)).contains("password"),
                "password must not be constrained by @SafeHtml");

        org.egov.pgr.web.models.pgrV1.ActionInfo action = org.egov.pgr.web.models.pgrV1.ActionInfo.builder()
                .comment("<iframe src=//evil.com></iframe>").build();
        assertTrue(paths(validator.validate(action)).contains("comment"),
                "pgrV1 ActionInfo.comment must reject markup");
    }

    @Test
    void validCascadesIntoTheComplainant() {
        // Service.citizen carried no @Valid, so the User model was never reached and its
        // fields were unconstrained. API fuzzing confirmed <script> in citizen.emailId and
        // citizen.userName was accepted with HTTP 200; some sibling fields only appeared
        // safe because the downstream egov-user service rejected them itself.
        org.egov.pgr.web.models.User citizen = new org.egov.pgr.web.models.User();
        citizen.setEmailId("<script>alert(1)</script>");
        Service s = new Service();
        s.setCitizen(citizen);
        Set<String> violated = paths(validator.validate(s));
        assertTrue(violated.contains("citizen.emailId"),
                "expected citizen.emailId to be validated, got " + violated);

        org.egov.pgr.web.models.User ok = new org.egov.pgr.web.models.User();
        ok.setName("O'Brien & Sons");
        ok.setEmailId("a.b+x@c.org");
        ok.setCorrespondenceAddress("12 Main St <2 km from park");
        Service clean = new Service();
        clean.setCitizen(ok);
        Set<String> cleanViolations = paths(validator.validate(clean));
        assertTrue(cleanViolations.stream().noneMatch(p -> p.startsWith("citizen.")),
                "ordinary complainant data must be accepted, got " + cleanViolations);
    }
}
