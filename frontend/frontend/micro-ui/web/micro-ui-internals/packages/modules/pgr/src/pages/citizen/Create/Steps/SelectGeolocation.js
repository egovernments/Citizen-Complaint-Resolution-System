import React, { useState, useEffect } from "react";
import { FormStep } from "@egovernments/digit-ui-react-components";
import GeoLocations from "../../../../components/GeoLocations";

const SelectGeolocation = ({ onSelect, onSkip, value, t, config, formData }) => {
  const stepKey = config?.key || "geolocation";
  const [params, setParams, clearParams] = Digit.Hooks.useSessionStorage("PGR_LOCATION", {});
  const [location, setLocation] = useState(value || formData?.[stepKey] || params?.[stepKey]);
  const locationFormData = { [stepKey]: value || location };

  useEffect(() => {
    if (location) {
      setParams({ ...params, [stepKey]: location });
    }
  }, [location, stepKey]);

  useEffect(() => {
    if (!location && params?.[stepKey]) {
      setLocation(params[stepKey]);
    }
  }, [params, stepKey]);

  const finalConfig = {
    ...config,
    texts: {
      header: config?.texts?.header || "CS_ADDCOMPLAINT_SELECT_GEOLOCATION_HEADER",
      submitBarLabel: config?.texts?.submitBarLabel || "CS_COMMON_NEXT",
      skipText: config?.texts?.skipText || "CS_COMMON_SKIP",
      ...config?.texts,
    },
  };

  const onSubmit = () => {
    onSelect(location);
  };

  const handleLocationSelect = (key, data) => {
    setLocation(data);
  };

  return (
    <FormStep config={finalConfig} onSelect={onSubmit} onSkip={onSkip} t={t} isDisabled={!location}>
      <GeoLocations
        t={t}
        config={{ ...config, key: stepKey }}
        onSelect={handleLocationSelect}
        formData={locationFormData}
      />
    </FormStep>
  );
};

export default SelectGeolocation;
