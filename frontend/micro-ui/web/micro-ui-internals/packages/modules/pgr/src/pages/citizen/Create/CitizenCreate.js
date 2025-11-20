import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Redirect, Route, Switch, useHistory, useRouteMatch, useLocation } from "react-router-dom";
import { FormComposerCitizen} from "@egovernments/digit-ui-components";
import { newConfig as baseConfig } from "./CreateCommonConfig";
import { Loader } from "@egovernments/digit-ui-components";

// import { newConfig } from "../../configs/IndividualCreateConfig";
// import { transformIndividualCreateData } from "../../utils/createUtils";

const IndividualCreateCitizen = () => {
  
  const tenantId = Digit.ULBService.getCurrentTenantId();
  const { t } = useTranslation();

  // Fetch mobile validation config from MDMS
  const { validationRules, isLoading: isValidationLoading, getMinMaxValues } = Digit.Hooks.pgr.useMobileValidation(tenantId);

   const reqCreate = {
    url: `/individual/v1/_create`,
    params: {},
    body: {},
    config: {
      enable: false,
    },
  };

  const mutation = Digit.Hooks.useCustomAPIMutationHook(reqCreate);

  // Inject mobile validation rules from MDMS into the config
  const config = useMemo(() => {
    if (!validationRules) return baseConfig;

    const { min, max } = getMinMaxValues();

    return baseConfig.map((section) => {
      if (section.head === "Create Individual") {
        return {
          ...section,
          body: section.body.map((field) => {
            if (field.key === "phno" && field.type === "number") {
              return {
                ...field,
                populators: {
                  ...field.populators,
                  validation: {
                    min: min,
                    max: max,
                    minlength: validationRules.minLength,
                    maxlength: validationRules.maxLength,
                    pattern: validationRules.pattern,
                  },
                  error: validationRules.errorMessage || field.populators.error,
                },
              };
            }
            return field;
          }),
        };
      }
      return section;
    });
  }, [validationRules]);


  const onFormSubmit = async (data) => {
    console.log(data, "data");
    await mutation.mutate({
      url: `/individual/v1/_create`,
      params: { tenantId },
      body: data,
      config: {
        enable: true,
      },
    });
  };

  if (isValidationLoading) {
    return <Loader />;
  }

  return (
    <div>
     <FormComposerCitizen config={config} onSubmit={onFormSubmit}
     onFormValueChange={(setValue, formData, formState, reset, setError, clearErrors, trigger, getValues) => {
          console.log(formData, "formData");
        }}
    nextStepLabel={"CMN_NEXT_BTN"} submitLabel={"CMN_SUBMIT"} baseRoute="name"  sessionKey="PGR_CITIZEN_CREATE"
     ></FormComposerCitizen>
    </div>
  );
};

export default IndividualCreateCitizen;