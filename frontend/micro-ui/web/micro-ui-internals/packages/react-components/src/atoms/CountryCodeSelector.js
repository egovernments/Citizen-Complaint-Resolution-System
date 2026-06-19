import React, { useState, useEffect } from "react";
import PropTypes from "prop-types";
import Dropdown from "./Dropdown";

const CACHE_KEY = "countryCodesMDMS";
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
const DEFAULT_COUNTRY_CODE = "+91";

/**
 * CountryCodeSelector - A component that fetches country codes from MDMS and displays them in a dropdown
 *
 * @param {Object} props - Component props
 * @param {string} props.value - Selected country code value
 * @param {Function} props.onChange - Callback function when selection changes
 * @param {string} props.tenantId - Tenant ID for MDMS query
 * @param {boolean} props.disabled - Whether the dropdown is disabled
 * @param {string} props.className - Optional CSS class name
 * @param {Function} props.t - Optional translation function
 */
const CountryCodeSelector = (props) => {
  const { value, onChange, tenantId, disabled, className, t } = props;
  const [countryCodeOptions, setCountryCodeOptions] = useState([]);
  const [selectedCountryCode, setSelectedCountryCode] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  /**
   * Get cached country codes from localStorage
   */
  const getCachedCountryCodes = () => {
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached) {
        const { data, timestamp } = JSON.parse(cached);
        const now = Date.now();

        // Check if cache is still valid (within 24 hours)
        if (now - timestamp < CACHE_DURATION) {
          return data;
        } else {
          // Clear expired cache
          localStorage.removeItem(CACHE_KEY);
        }
      }
    } catch (err) {
      console.error("Error reading country codes from cache:", err);
    }
    return null;
  };

  /**
   * Save country codes to localStorage cache
   */
  const setCachedCountryCodes = (data) => {
    try {
      const cacheData = {
        data,
        timestamp: Date.now()
      };
      localStorage.setItem(CACHE_KEY, JSON.stringify(cacheData));
    } catch (err) {
      console.error("Error saving country codes to cache:", err);
    }
  };

  /**
   * Fetch country codes from MDMS API
   */
  const fetchCountryCodesFromMDMS = async () => {
    try {
      const mdmsCriteria = {
        moduleDetails: [
          {
            moduleName: "common-masters",
            masterDetails: [
              {
                name: "CountryCode"
              }
            ]
          }
        ]
      };

      // Use the MdmsService from Digit library
      const response = await Digit.MDMSService.call(tenantId, mdmsCriteria);

      if (response && response.MdmsRes && response.MdmsRes["common-masters"] && response.MdmsRes["common-masters"].CountryCode) {
        const countryCodes = response.MdmsRes["common-masters"].CountryCode
          .filter(code => code.active)
          .map(code => ({
            code: code.code,
            name: code.name,
            countryCode: code.countryCode,
            isDefault: code.isDefault || false,
            i18nKey: `COUNTRY_CODE_${code.code}`
          }));

        return countryCodes;
      }

      return null;
    } catch (err) {
      console.error("Error fetching country codes from MDMS:", err);
      throw err;
    }
  };

  /**
   * Get default country code from the list
   */
  const getDefaultCountryCode = (codes) => {
    const defaultCode = codes.find(code => code.isDefault);
    return defaultCode || codes.find(code => code.countryCode === DEFAULT_COUNTRY_CODE) || codes[0];
  };

  /**
   * Load country codes - from cache or MDMS
   */
  const loadCountryCodes = async () => {
    setIsLoading(true);
    setError(null);

    try {
      // Try to get from cache first
      let codes = getCachedCountryCodes();

      // If not in cache, fetch from MDMS
      if (!codes) {
        codes = await fetchCountryCodesFromMDMS();

        if (codes && codes.length > 0) {
          // Save to cache
          setCachedCountryCodes(codes);
        }
      }

      // If we have codes, set them
      if (codes && codes.length > 0) {
        setCountryCodeOptions(codes);

        // If no value is provided, set the default
        if (!value) {
          const defaultCode = getDefaultCountryCode(codes);
          setSelectedCountryCode(defaultCode);
          if (onChange) {
            onChange(defaultCode.countryCode);
          }
        } else {
          // Find the selected code from the list
          const selected = codes.find(code => code.countryCode === value);
          setSelectedCountryCode(selected || null);
        }
      } else {
        // Fallback to default +91 if MDMS fetch fails
        const fallbackCode = {
          code: "IN",
          name: "India",
          countryCode: DEFAULT_COUNTRY_CODE,
          isDefault: true,
          i18nKey: "COUNTRY_CODE_IN"
        };
        setCountryCodeOptions([fallbackCode]);
        setSelectedCountryCode(fallbackCode);

        if (!value && onChange) {
          onChange(DEFAULT_COUNTRY_CODE);
        }
      }
    } catch (err) {
      console.error("Error loading country codes:", err);
      setError(err);

      // Fallback to default +91 on error
      const fallbackCode = {
        code: "IN",
        name: "India",
        countryCode: DEFAULT_COUNTRY_CODE,
        isDefault: true,
        i18nKey: "COUNTRY_CODE_IN"
      };
      setCountryCodeOptions([fallbackCode]);
      setSelectedCountryCode(fallbackCode);

      if (!value && onChange) {
        onChange(DEFAULT_COUNTRY_CODE);
      }
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Initialize - load country codes on mount
   */
  useEffect(() => {
    if (tenantId) {
      loadCountryCodes();
    }
  }, [tenantId]);

  /**
   * Update selected country code when value prop changes
   */
  useEffect(() => {
    if (value && countryCodeOptions.length > 0) {
      const selected = countryCodeOptions.find(code => code.countryCode === value);
      setSelectedCountryCode(selected || null);
    }
  }, [value, countryCodeOptions]);

  /**
   * Handle selection change
   */
  const handleSelect = (selectedOption) => {
    setSelectedCountryCode(selectedOption);
    if (onChange) {
      onChange(selectedOption.countryCode);
    }
  };

  /**
   * Format option for display - shows "countryCode - name"
   */
  const formatOption = (option) => {
    return `${option.countryCode} - ${option.name}`;
  };

  // Show loading state
  if (isLoading) {
    return (
      <div className={`country-code-selector ${className || ""}`}>
        <div className="country-code-loading">Loading...</div>
      </div>
    );
  }

  // Transform options for Dropdown component
  const dropdownOptions = countryCodeOptions.map(code => ({
    ...code,
    displayName: formatOption(code)
  }));

  return (
    <div className={`country-code-selector ${className || ""}`}>
      <Dropdown
        option={dropdownOptions}
        optionKey="displayName"
        selected={selectedCountryCode ? { ...selectedCountryCode, displayName: formatOption(selectedCountryCode) } : null}
        select={handleSelect}
        disable={disabled}
        t={t}
        placeholder="Select Country Code"
        style={{ maxWidth: "200px" }}
      />
    </div>
  );
};

CountryCodeSelector.propTypes = {
  value: PropTypes.string,
  onChange: PropTypes.func,
  tenantId: PropTypes.string.isRequired,
  disabled: PropTypes.bool,
  className: PropTypes.string,
  t: PropTypes.func
};

CountryCodeSelector.defaultProps = {
  disabled: false,
  className: "",
  t: (key) => key
};

export default CountryCodeSelector;
