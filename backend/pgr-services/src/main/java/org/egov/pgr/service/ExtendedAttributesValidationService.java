package org.egov.pgr.service;

import org.egov.common.contract.request.RequestInfo;
import org.egov.pgr.util.MDMSUtils;
import org.egov.pgr.web.models.ComplaintTemplateTypeConfig;
import org.egov.pgr.web.models.ExtendedAttributes;
import org.egov.pgr.web.models.Service;
import org.egov.tracer.model.CustomException;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.*;

@Component
public class ExtendedAttributesValidationService {

    private final MDMSUtils mdmsUtils;

    @Autowired
    public ExtendedAttributesValidationService(MDMSUtils mdmsUtils) {
        this.mdmsUtils = mdmsUtils;
    }

    public void validate(ExtendedAttributes ext, ComplaintTemplateTypeConfig config,
                         Service service, RequestInfo requestInfo, String tenantId) {
        if (ext == null) return;

        if (!mdmsUtils.isValidCaseRelatedTo(requestInfo, tenantId, ext.getCaseRelatedTo()))
            throw new CustomException("INVALID_CASE_RELATED_TO",
                    "caseRelatedTo must be an active code in ComplaintRelatedToMap: " + ext.getCaseRelatedTo());

        if (service.getDescription() == null || service.getDescription().isBlank())
            throw new CustomException("DESCRIPTION_REQUIRED", "description is mandatory");

        if (config == null || config.getFields() == null) return;

        List<String> errors = new ArrayList<>();
        for (ComplaintTemplateTypeConfig.FieldDefinition fd : config.getFields()) {
            Object val = ext.getField(fd.getFieldKey());

            if (Boolean.TRUE.equals(fd.getMandatory())
                    && (val == null || val.toString().isBlank())) {
                errors.add("'" + fd.getLabel() + "' is mandatory for " + ext.getCaseRelatedTo());
                continue;
            }
            if (val == null) continue;

            String s = val.toString();

            if (fd.getMaxLength() != null && s.length() > fd.getMaxLength())
                errors.add("'" + fd.getLabel() + "' exceeds max length " + fd.getMaxLength());

            String dataType = fd.getDataType() == null ? "string" : fd.getDataType();
            switch (dataType) {
                case "date":
                    try { LocalDate.parse(s); }
                    catch (DateTimeParseException e) {
                        errors.add("'" + fd.getLabel() + "' must be YYYY-MM-DD");
                    }
                    break;
                case "number":
                    try { Double.parseDouble(s); }
                    catch (NumberFormatException e) {
                        errors.add("'" + fd.getLabel() + "' must be a number");
                    }
                    break;
                case "email":
                    if (!s.matches("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$"))
                        errors.add("'" + fd.getLabel() + "' must be a valid email");
                    break;
                case "phone":
                    if (!s.matches("^\\+?[0-9]{7,15}$"))
                        errors.add("'" + fd.getLabel() + "' must be a valid phone number");
                    break;
                default:
                    break;
            }

            if (fd.getRegex() != null && !s.matches(fd.getRegex()))
                errors.add("'" + fd.getLabel() + "' does not match the required format");
        }

        if (!errors.isEmpty())
            throw new CustomException("EXTENDED_ATTRIBUTES_VALIDATION_ERROR",
                    String.join("; ", errors));
    }
}
