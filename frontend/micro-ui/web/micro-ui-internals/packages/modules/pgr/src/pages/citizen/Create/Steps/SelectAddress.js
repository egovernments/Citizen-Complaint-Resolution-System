import React, { useEffect, useState, useRef } from "react";
import { CardLabel, Dropdown, FormStep, RadioButtons } from "@egovernments/digit-ui-react-components";

const SelectAddress = ({ t, config, onSelect, userType, formData, value = {} }) => {

  const [selectedCity, setSelectedCity] = useState(null);
const [selectedLocality, setSelectedLocality] = useState(null);

  const allCities = Digit.Hooks.pgr.useTenants();
  const cities = value?.pincode
    ? allCities.filter((city) => city?.pincode?.some((pin) => pin == value["pincode"])).sort((a, b) => (a.name || '').localeCompare(b.name || ''))
    : [...allCities].sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  
  const [localities, setLocalities] = useState(null);
  const [fetchedLocalities, setFetchedLocalities] = useState(null);



useEffect(() => {
  const fetch = async () => {
    const hierarchyType = window?.globalConfigs?.getConfig("HIERARCHY_TYPE") || "ADMIN";
    const boundaryType = window?.globalConfigs?.getConfig("BOUNDARY_TYPE") || "Locality";

    if (!selectedCity?.code) {
      console.log("⚠️ No city selected, skipping boundary fetch");
      return;
    }

    // Check sessionStorage cache first
    const cacheKey = `PGR_BOUNDARY_${selectedCity.code}`;
    const cachedData = sessionStorage.getItem(cacheKey);

    if (cachedData) {
      try {
        console.log("📦 Using cached boundaries for city:", selectedCity.code);
        setFetchedLocalities(JSON.parse(cachedData));
        return;
      } catch (e) {
        console.error("Failed to parse cached data:", e);
      }
    }

    console.log("🌍 Fetching boundaries for city:", selectedCity.code);

    try {
      const res = await Digit.CustomService.getResponse({
        url: `/boundary-service/boundary-relationships/_search?tenantId=${selectedCity.code}&hierarchyType=${hierarchyType}&boundaryType=${boundaryType}&includeChildren=true`,
        useCache: false,
        method: "POST",
        userService: false,
      });
      const boundaries = res?.TenantBoundary[0]?.boundary || [];

      // Cache in sessionStorage
      try {
        sessionStorage.setItem(cacheKey, JSON.stringify(boundaries));
      } catch (e) {
        console.error("Failed to cache boundary data:", e);
      }

      console.log("✅ Boundaries fetched successfully:", boundaries.length, "localities");
      setFetchedLocalities(boundaries);
    } catch (err) {
      console.error("❌ Boundary fetch error:", err);
      setFetchedLocalities([]);
    }
  };

  fetch();
}, [selectedCity?.code]); 

  useEffect(() => {
    if (selectedCity && fetchedLocalities) {
      const { pincode } = value;
      let __localityList = pincode
        ? fetchedLocalities.filter((city) => city["pincode"] == pincode).sort((a, b) => (a.code || '').localeCompare(b.code || ''))
        : [...fetchedLocalities].sort((a, b) => (a.code || '').localeCompare(b.code || ''));
      setLocalities(__localityList);

      // If we have a saved locality, restore it after localities are loaded
      const savedLocality = formData?.SelectAddress?.locality;
      if (savedLocality && !selectedLocality) {
        console.log("🔄 Restoring locality after boundaries loaded:", savedLocality);
        setSelectedLocality(savedLocality);
      }
    }
  }, [selectedCity, fetchedLocalities]);


  // Restore selected values from formData on mount and when formData changes
  useEffect(() => {
    const city = formData?.SelectAddress?.city;
    const locality = formData?.SelectAddress?.locality;

    if (city) {
      console.log("🔄 Restoring city and locality from session:", city, locality);
      setSelectedCity(city);

      if (locality) {
        setSelectedLocality(locality);
      }
    }
  }, [formData?.SelectAddress?.city, formData?.SelectAddress?.locality]);
  
  

  function selectCity(city) {
    setSelectedLocality(null);
    setLocalities(null);
    setSelectedCity(city);
    onSelect(config.key, {
      "city": city,
      "locality": {}
    })
    // Digit.SessionStorage.set("city_complaint", city);
  }

  function selectLocality(locality) {
    setSelectedLocality(locality);
    onSelect(config.key, {
      "city": selectedCity,
      "locality": locality
    })

    // Digit.SessionStorage.set("locality_complaint", locality);
  }

  function onSubmit() {
    // onSelect({ city_complaint: selectedCity, locality_complaint: selectedLocality });
  }
  return (
    <FormStep config={config} onSelect={onSubmit} t={t} isDisabled={selectedLocality ? false : true}>
      <div>
        <CardLabel>{t("MYCITY_CODE_LABEL")}</CardLabel>
        {cities?.length < 5 ? (
          <RadioButtons selectedOption={selectedCity} options={cities} optionsKey="i18nKey" onSelect={selectCity} />
        ) : (
          <Dropdown isMandatory selected={selectedCity} option={cities} select={selectCity} optionKey="i18nKey" t={t} />
        )}
        {selectedCity && localities && <CardLabel>{t("CS_CREATECOMPLAINT_MOHALLA")}</CardLabel>}
        {selectedCity && localities && (
          <React.Fragment>
            {localities?.length < 5 ? (
              <RadioButtons selectedOption={selectedLocality} options={localities} optionsKey="code" onSelect={selectLocality} />
            ) : (
              <Dropdown isMandatory selected={selectedLocality} optionKey="code" option={localities} select={selectLocality} t={t} />
            )}
          </React.Fragment>
        )}
      </div>
    </FormStep>
  );
};

export default SelectAddress;
