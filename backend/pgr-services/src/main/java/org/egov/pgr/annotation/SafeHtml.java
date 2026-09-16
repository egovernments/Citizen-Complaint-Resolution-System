package org.egov.pgr.annotation;

import jakarta.validation.Constraint;
import jakarta.validation.Payload;

import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * Rejects a string that carries HTML outside the configured safelist.
 *
 * <p>Replaces {@code org.hibernate.validator.constraints.SafeHtml}, which Hibernate
 * Validator deprecated in 6.0 and removed in 6.1 (it delegated to jsoup, and HV did not
 * want that dependency). This module is on Boot-managed HV 8.0.1.Final, where the
 * original annotation no longer exists, so the constraint is declared locally and kept
 * behaviourally equivalent: same default {@link WhiteListType#RELAXED} safelist, and
 * {@code null} is valid so that presence stays the job of {@code @NotNull}.
 */
@Documented
@Constraint(validatedBy = SafeHtmlValidator.class)
// TYPE_USE is required for container-element constraints such as
// Set<@SafeHtml String>: a field-level constraint on a Set would make Hibernate
// Validator look for a ConstraintValidator<SafeHtml, Set> and fail with
// UnexpectedTypeException, since this validator handles CharSequence.
@Target({ElementType.METHOD, ElementType.FIELD, ElementType.PARAMETER, ElementType.TYPE_USE})
@Retention(RetentionPolicy.RUNTIME)
public @interface SafeHtml {

    String message() default "Value contains unsafe HTML content";

    Class<?>[] groups() default {};

    Class<? extends Payload>[] payload() default {};

    WhiteListType whitelistType() default WhiteListType.RELAXED;

    /** Mirrors the safelists Hibernate Validator's {@code @SafeHtml} exposed. */
    enum WhiteListType {
        /** No HTML permitted at all. */
        NONE,
        /** Text nodes plus b, em, i, strong, u. */
        SIMPLE_TEXT,
        /** SIMPLE_TEXT plus common block/inline tags and links. */
        BASIC,
        /** BASIC plus img. */
        BASIC_WITH_IMAGES,
        /** Full set of body tags, minus anything that can execute script. */
        RELAXED
    }
}
