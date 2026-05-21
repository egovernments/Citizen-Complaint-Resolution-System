import React, { useState } from "react";
import { LabelFieldPair, CardLabel, TextInput, CardLabelError } from "@egovernments/digit-ui-react-components";
import {
  DEFAULT_MOBILE_MAX_LENGTH,
  DEFAULT_MOBILE_MIN_LENGTH,
  DEFAULT_MOBILE_PATTERN,
  DEFAULT_MOBILE_PREFIX,
} from "@egovernments/digit-ui-libraries";
import { useLocation } from "react-router-dom";

const SelectEmployeePhoneNumber = ({ t, config, onSelect, formData = {}, userType, register, errors }) => {
  const { pathname: url } = useLocation();
  const [iserror, setError] = useState(false);
  let isMobile = window.Digit.Utils.browser.isMobile();

  // Get validation config from props or use defaults
  const validationConfig = config?.validationConfig || {};
  const prefix = validationConfig.prefix || DEFAULT_MOBILE_PREFIX;
  const pattern = validationConfig.pattern || DEFAULT_MOBILE_PATTERN;
  const maxLength = validationConfig.maxLength || DEFAULT_MOBILE_MAX_LENGTH;
  const minLength = validationConfig.minLength || DEFAULT_MOBILE_MIN_LENGTH;
  const errorMessage = validationConfig.errorMessage || "CORE_COMMON_MOBILE_ERROR";

  const inputs = [
    {
      label: t("HR_MOB_NO_LABEL"),
      isMandatory: true,
      type: "text",
      name: "mobileNumber",
      populators: {
        validation: {
          required: true,
          pattern: new RegExp(pattern),
          maxLength: maxLength,
          minLength: minLength,
        },
        componentInFront: <div className="employee-card-input employee-card-input--front">{prefix}</div>,
        error: t(errorMessage),
      },
    },
  ];

  function setValue(value, input) {
    onSelect(config.key, { ...formData[config.key], [input]: value });
  }
  function validate(value, input) {
    setError(!input.populators.validation.pattern.test(value));
  }

  return (
    <div>
      {inputs?.map((input, index) => (
        <React.Fragment key={index}>
          <LabelFieldPair>
            <CardLabel className="card-label-smaller">
              {t(input.label)}
              {input.isMandatory ? " * " : null}
            </CardLabel>
            <div className="field-container" style={{ width: isMobile ? "100%" : "50%", display: "block" }}>
              <div>
                <div style={{ display: "flex" }}>
                  <div className="employee-card-input employee-card-input--front">{prefix}</div>
                  <TextInput
                    className="field desktop-w-full"
                    key={input.name}
                    value={formData && formData[config.key] ? formData[config.key][input.name] : undefined}
                    onChange={(e) => { setValue(e.target.value, input.name, validate(e.target.value, input)) }}
                    disable={false}
                    defaultValue={undefined}
                    onBlur={(e) => validate(e.target.value, input)}
                    maxLength={maxLength}
                    minLength={minLength}
                    {...input.validation}
                  />
                </div>
                <div>{iserror ? <CardLabelError style={{ width: "100%" }}>{t(input.populators.error)}</CardLabelError> : null}</div>
              </div>
            </div>
          </LabelFieldPair>
        </React.Fragment>
      ))}
    </div>
  );
};

export default SelectEmployeePhoneNumber;
