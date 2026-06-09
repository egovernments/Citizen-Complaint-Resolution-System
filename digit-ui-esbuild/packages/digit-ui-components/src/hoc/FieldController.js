import React from "react";
// import FieldComposer from "./FieldComposer";
import FieldV1 from "./FieldV1";
import { Controller } from "react-hook-form";
import get from "lodash/get";

function FieldController(args) {
  const {
    type,
    populators,
    isMandatory,
    disable,
    component,
    config,
    sectionFormCategory,
    formData,
    selectedFormCategory,
    control,
    props,
    errors,
    defaultValues,
    controllerProps,
  } = args;
  let { apiDetails } = props;
  let disableFormValidation = false;
  if (sectionFormCategory && selectedFormCategory) {
    disableFormValidation = sectionFormCategory !== selectedFormCategory ? true : false;
  }
  const customValidation = config?.populators?.validation?.customValidation;
  let customValidations = config?.additionalValidation
    ? Digit?.Customizations?.[apiDetails?.masterName]?.[apiDetails?.moduleName]?.additionalValidations(
        config?.additionalValidation?.type,
        formData,
        config?.additionalValidation?.keys
      )
    : null;
  const customRules = customValidation ? { validate: customValidation } : customValidations ? { validate: customValidation } : {};
  let error = (populators?.name && errors && errors[populators?.name] && Object.keys(errors[populators?.name]).length) ? (populators?.error) : null;
  const errorObject = get(errors, populators?.name);
  error = errorObject ? populators?.error : null;
  const customProps = config?.customProps;

  return (
    <Controller
    defaultValue={formData?.[populators?.name] ?? ""}
    control={control}
    render={(contoprops) => {
      const onChange = contoprops?.onChange;
      const ref = contoprops?.ref;
      const value = contoprops?.value;
      const onBlur = contoprops?.onBlur;
      return <FieldV1
        error= {error}
        label={config.label}
        nonEditable = {config.nonEditable}
        placeholder={config.placeholder}
        inline={props.inline}
        description={config.description}
        charCount = {config.charCount}
        infoMessage={config.infoMessage}
        withoutLabel = {config.withoutLabel}
        variant={config.variant}
        type={type}
        populators={populators}
        required={isMandatory}
        control={control}
        disabled={disable}
        component={component}
        config={config}
        sectionFormCategory={sectionFormCategory}
        formData={formData}
        selectedFormCategory={selectedFormCategory}
        defaultValues={defaultValues}
        onChange={(val) => {
      onChange?.(val); // Ensure it updates form state
    }}
        ref={ref}
        value={value}
        props={props}
        errors={errors}
        onBlur={onBlur}
        controllerProps={controllerProps}
      />
    }}
    key={populators?.name}
    name={populators?.name}
    rules={!disableFormValidation ? { required: isMandatory, ...populators?.validation, ...customRules } : {}}
  />
  );
}

export default FieldController;
