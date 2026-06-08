package org.egov.pgr.annotation;

import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;

public class AdditionalDetailValidator implements ConstraintValidator<CharacterConstraint, Object> {

    private Integer size;

    @Override
    public void initialize(CharacterConstraint constraint) {
        this.size = constraint.size();
    }

    @Override
    public boolean isValid(Object value, ConstraintValidatorContext ctx) {
        if (value == null) return true;
        return value.toString().length() <= size;
    }
}
