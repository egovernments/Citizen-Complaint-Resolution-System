import React, { useState, useMemo, useEffect } from "react";
import { CardLabelError } from "@egovernments/digit-ui-components";

/**
 * MobileNumberWithPrefix — Custom FormComposerV2 component (type: "component")
 *
 * Follows the same pattern as PGRBoundaryComponent:
 * - Reads value from formData[config.key]
 * - Writes value via onSelect(config.key, value)
 * - Fetches MDMS validation config internally via useMobileValidation hook
 * - Handles all validation internally
 * - Shows inline errors via CardLabelError
 */
var MobileNumberWithPrefix = function(componentProps) {
  var t = componentProps.t;
  var config = componentProps.config || {};
  var onSelect = componentProps.onSelect;
  var setValue = componentProps.setValue;
  var formData = componentProps.formData || componentProps.data || {};
  var controllerProps = componentProps.props || {};

  var fieldKey = config.key || (config.populators && config.populators.name) || "";
  var isMandatory = config.isMandatory || false;
  var disable = config.disable || false;
  var errorMsgKey = (config.populators && config.populators.error) || "CORE_COMMON_MOBILE_ERROR";

  // Fetch MDMS validation config via the PGR hook
  var tenantId = Digit.ULBService.getCurrentTenantId();
  var hookResult = Digit.Hooks.pgr.useMobileValidation(tenantId);
  var validationRules = hookResult.validationRules || {};
  var allValidationConfigs = hookResult.allValidationConfigs || [];
  var getConfigByPrefix = hookResult.getConfigByPrefix;

  // All available country prefixes for dropdown
  var allPrefixes = useMemo(function() {
    if (allValidationConfigs && allValidationConfigs.length > 0) {
      return allValidationConfigs.map(function(c) { return c.prefix; });
    }
    return [validationRules.prefix || "+91"];
  }, [allValidationConfigs, validationRules]);

  // State
  var _prefix = useState(validationRules.prefix || "+91");
  var selectedPrefix = _prefix[0];
  var setSelectedPrefix = _prefix[1];

  var _local = useState(formData[fieldKey] || "");
  var localValue = _local[0];
  var setLocalValue = _local[1];

  var _error = useState("");
  var localError = _error[0];
  var setLocalError = _error[1];

  // Active config based on selected prefix
  var activeConfig = useMemo(function() {
    if (getConfigByPrefix) return getConfigByPrefix(selectedPrefix);
    var found = allValidationConfigs.find(function(c) { return c.prefix === selectedPrefix; });
    return found || validationRules;
  }, [selectedPrefix, allValidationConfigs, validationRules, getConfigByPrefix]);

  var maxLength = (activeConfig && activeConfig.maxLength) || 10;
  var minLength = (activeConfig && activeConfig.minLength) || 10;
  var pattern = (activeConfig && activeConfig.pattern) || validationRules.pattern;
  var allowedStartingChars = (activeConfig && activeConfig.allowedStartingCharacters) || validationRules.allowedStartingCharacters;
  var activeErrorMsg = (activeConfig && activeConfig.errorMessage) || errorMsgKey;

  // Validate mobile number against active config
  var validate = function(val) {
    if (!val || val.length === 0) return false;
    if (val.length < minLength || val.length > maxLength) return false;
    if (allowedStartingChars && allowedStartingChars.length > 0) {
      if (allowedStartingChars.indexOf(val[0]) === -1) return false;
    }
    if (pattern) {
      var regex = new RegExp(pattern);
      if (!regex.test(val)) return false;
    }
    return true;
  };

  // Sync prefix when MDMS data loads
  useEffect(function() {
    if (validationRules && validationRules.prefix) {
      setSelectedPrefix(validationRules.prefix);
    }
  }, [validationRules.prefix]);

  // Sync local value when formData changes externally (e.g. MYSELF auto-fill)
  useEffect(function() {
    var externalVal = formData[fieldKey];
    if (externalVal !== undefined && externalVal !== null && externalVal !== localValue) {
      setLocalValue(externalVal);
    }
  }, [formData[fieldKey]]);

  // Push value to form via all available channels
  var pushToForm = function(val) {
    if (onSelect) onSelect(fieldKey, val);
    if (setValue && fieldKey) setValue(fieldKey, val);
    if (controllerProps && controllerProps.onChange) controllerProps.onChange(val);
  };

  // Re-validate and push when prefix changes
  useEffect(function() {
    if (localValue && localValue.length > 0) {
      if (validate(localValue)) {
        setLocalError("");
        pushToForm(localValue);
      } else {
        setLocalError(t ? t(activeErrorMsg) : activeErrorMsg);
        pushToForm("");
      }
    }
  }, [selectedPrefix]);

  var handlePrefixChange = function(e) {
    setSelectedPrefix(e.target.value);
    setLocalValue("");
    setLocalError("");
    pushToForm("");
  };

  var handleMobileChange = function(e) {
    var raw = e.target.value.replace(/\D/g, "");
    if (raw.length > maxLength) return;

    setLocalValue(raw);

    if (raw.length === 0) {
      setLocalError("");
      pushToForm("");
    } else if (raw.length >= minLength) {
      if (validate(raw)) {
        setLocalError("");
        pushToForm(raw);
      } else {
        setLocalError(t ? t(activeErrorMsg) : activeErrorMsg);
        pushToForm("");
      }
    } else {
      setLocalError("");
      pushToForm("");
    }
  };

  return (
    <div style={{ maxWidth: "37.5rem", width: "100%" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          border: localError ? "2px solid #d4351c" : "1px solid #464646",
          overflow: "hidden",
          backgroundColor: "#FFFFFF",
          boxSizing: "border-box",
          height: "2.5rem",
        }}
      >
        <select
          value={selectedPrefix}
          onChange={handlePrefixChange}
          disabled={disable}
          style={{
            border: "none",
            borderRight: localError ? "2px solid #d4351c" : "1px solid #464646",
            padding: "0 8px",
            fontSize: "16px",
            backgroundColor: "#EEEEEE",
            cursor: disable ? "not-allowed" : "pointer",
            outline: "none",
            color: "#0B0C0C",
            fontWeight: "500",
            minWidth: "75px",
            height: "100%",
            appearance: "auto",
          }}
        >
          {allPrefixes.map(function(p) {
            return <option key={p} value={p}>{p}</option>;
          })}
        </select>
        <input
          type="text"
          value={localValue}
          onChange={handleMobileChange}
          placeholder={t ? t("CS_COMMON_MOBILE_PLACEHOLDER") : ""}
          maxLength={maxLength}
          readOnly={disable}
          style={{
            flex: 1,
            border: "none",
            padding: "0 12px",
            fontSize: "16px",
            outline: "none",
            color: "#0B0C0C",
            backgroundColor: "transparent",
            margin: "0",
            height: "100%",
            width: "100%",
            minWidth: "0",
          }}
        />
      </div>
      {localError && (
        <CardLabelError style={{ fontSize: "14px", marginTop: "4px" }}>
          {localError}
        </CardLabelError>
      )}
    </div>
  );
};

export default MobileNumberWithPrefix;
