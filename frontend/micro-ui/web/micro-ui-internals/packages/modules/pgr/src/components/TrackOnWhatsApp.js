import React, { useState, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { PopUp, Button, CardLabel, CardLabelError } from "@egovernments/digit-ui-components";

const TrackOnWhatsApp = ({ showPopup, onClose, onConfirm, defaultMobileNumber }) => {
  const { t } = useTranslation();
  const tenantId = Digit.ULBService.getCurrentTenantId();
  const { validationRules, allValidationConfigs, getConfigByPrefix, isLoading: isMobileValidationLoading } = Digit.Hooks.pgr.useMobileValidation(tenantId);

  const [selectedPrefix, setSelectedPrefix] = useState(validationRules?.prefix || "+91");
  const [mobileNumber, setMobileNumber] = useState(defaultMobileNumber || "");
  const [error, setError] = useState("");

  // Get active config based on selected prefix
  const activeConfig = useMemo(() => {
    return getConfigByPrefix(selectedPrefix);
  }, [selectedPrefix, getConfigByPrefix]);

  const maxLength = activeConfig?.maxLength || 10;
  const minLength = activeConfig?.minLength || 10;

  const allPrefixes = useMemo(() => {
    if (allValidationConfigs?.length > 0) {
      return allValidationConfigs.map((c) => c.prefix);
    }
    return [validationRules?.prefix || "+91"];
  }, [allValidationConfigs, validationRules]);

  useEffect(() => {
    if (validationRules?.prefix) {
      setSelectedPrefix(validationRules.prefix);
    }
  }, [validationRules?.prefix]);

  useEffect(() => {
    if (defaultMobileNumber) {
      setMobileNumber(defaultMobileNumber);
    }
  }, [defaultMobileNumber]);

  const handleMobileChange = (value) => {
    setMobileNumber(value);
    setError("");
  };

  const handlePrefixChange = (e) => {
    setSelectedPrefix(e.target.value);
    setMobileNumber("");
    setError("");
  };

  const handleConfirm = () => {
    const errorMessage = activeConfig?.errorMessage || validationRules?.errorMessage || "CS_COMMON_MOBILE_ERROR";
    console.log("TrackOnWhatsApp handleConfirm called", {
      mobileNumber,
      selectedPrefix,
      minLength,
      maxLength,
      activeConfig,
      validationRules,
      errorMessage,
    });
    if (!mobileNumber) {
      console.log("Validation failed: mobile number is empty");
      setError(t("CS_COMMON_MOBILE_REQUIRED"));
      return;
    }
    if (mobileNumber.length < minLength || mobileNumber.length > maxLength) {
      console.log("Validation failed: length", { length: mobileNumber.length, minLength, maxLength });
      setError(t(errorMessage));
      return;
    }
    // Validate against allowed starting characters
    const allowedChars = activeConfig?.allowedStartingCharacters || validationRules?.allowedStartingCharacters;
    if (allowedChars?.length > 0 && !allowedChars.includes(mobileNumber[0])) {
      console.log("Validation failed: starting character", { firstChar: mobileNumber[0], allowedChars });
      setError(t(errorMessage));
      return;
    }
    // Validate against regex pattern (use fallback pattern if activeConfig has none)
    const pattern = activeConfig?.pattern || validationRules?.pattern || `^[6-9][0-9]{${minLength - 1}}$`;
    const regex = new RegExp(pattern);
    if (!regex.test(mobileNumber)) {
      console.log("Validation failed: pattern mismatch", { mobileNumber, pattern });
      setError(t(errorMessage));
      return;
    }
    console.log("Validation passed, calling API");
    trackOnWhatsAppAPI(selectedPrefix, mobileNumber)
      .then(() => {
        onConfirm && onConfirm({ prefix: selectedPrefix, mobileNumber });
      })
      .catch((err) => {
        console.error("WhatsApp tracking API error:", err);
        onConfirm && onConfirm({ prefix: selectedPrefix, mobileNumber });
      });
  };

  if (!showPopup) return null;

  const showDropdown = allPrefixes.length >= 1;

  return (
    <PopUp
      type={"default"}
      heading={t("CS_PGR_TRACK_ON_WHATSAPP")}
      onClose={onClose}
      onOverlayClick={onClose}
      style={{ width: "45rem", maxWidth: "90vw" }}
      footerChildren={[
        <div key="footer" style={{ display: "flex", justifyContent: "flex-end", gap: "16px", width: "100%" }}>
          <Button
            type={"button"}
            size={"large"}
            variation={"secondary"}
            label={t("CS_COMMON_CANCEL")}
            onClick={onClose}
          />
          <Button
            type={"button"}
            size={"large"}
            variation={"primary"}
            label={t("CS_COMMON_SUBMIT")}
            onClick={handleConfirm}
            isDisabled={isMobileValidationLoading}
          />
        </div>,
      ]}
    >
      <div style={{ padding: "8px 16px 16px" }}>
        <p style={{ fontSize: "16px", color: "#505A5F", marginBottom: "28px", lineHeight: "1.5" }}>
          {t("CS_PGR_WHATSAPP_DESCRIPTION")}
        </p>

        <div style={{ marginBottom: "16px" }}>
          <CardLabel style={{ marginBottom: "12px" }}>{t("CS_COMMON_MOBILE_NUMBER")}</CardLabel>
          <div
            style={{
              width: "65%",
              display: "flex",
              alignItems: "center",
              border: "1px solid #D6D5D4",
              borderRadius: "4px",
              overflow: "hidden",
              backgroundColor: "#FFFFFF",
            }}
          >
            <select
              value={selectedPrefix}
              onChange={handlePrefixChange}
              style={{
                border: "none",
                borderRight: "1px solid #D6D5D4",
                padding: "10px 8px",
                fontSize: "16px",
                backgroundColor: "#FAFAFA",
                cursor: "pointer",
                outline: "none",
                color: "#0B0C0C",
                fontWeight: "500",
                minWidth: "75px",
                appearance: "auto",
              }}
            >
              {allPrefixes.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
            <input
              type="text"
              value={mobileNumber}
              onChange={(e) => {
                const val = e.target.value.replace(/\D/g, "");
                if (val.length <= maxLength) handleMobileChange(val);
              }}
              placeholder={t("CS_COMMON_MOBILE_PLACEHOLDER")}
              maxLength={maxLength}
              style={{
                flex: 1,
                border: "none",
                padding: "10px 12px",
                fontSize: "16px",
                outline: "none",
                color: "#0B0C0C",
                backgroundColor: "transparent",
              }}
            />
          </div>
          {error && <CardLabelError style={{ fontSize: "14px", marginTop: "8px" }}>{error}</CardLabelError>}
        </div>
      </div>
    </PopUp>
  );
};

/**
 * Dummy API function for WhatsApp tracking opt-in
 * Replace this with actual API integration later
 */
const trackOnWhatsAppAPI = async (prefix, mobileNumber) => {
  const fullNumber = `${prefix}${mobileNumber}`;
  console.log("WhatsApp Track API called with number:", fullNumber);
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve({ status: "SUCCESS", message: "WhatsApp tracking enabled", mobileNumber: fullNumber });
    }, 500);
  });
};

export default TrackOnWhatsApp;
