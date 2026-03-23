import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { useHistory } from "react-router-dom";
import { LOCALIZATION_KEY } from "../constants/Localization";
import TrackOnWhatsApp from "./TrackOnWhatsApp";

const WhatsAppIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="#FFFFFF" style={{ marginRight: "6px", flexShrink: 0 }}>
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
  </svg>
);

const Complaint = ({ data, path }) => {
  let { serviceCode, serviceRequestId, applicationStatus } = data;

  const history = useHistory();
  const { t } = useTranslation();
  const [showWhatsAppPopup, setShowWhatsAppPopup] = useState(false);

  const User = Digit.UserService.getUser();
  const userMobileNumber = User?.mobileNumber || User?.info?.mobileNumber || User?.info?.userInfo?.mobileNumber || "";

  const handleClick = () => {
    history.push(`${path}/${serviceRequestId}`);
  };

  const handleWhatsAppClick = (e) => {
    e.stopPropagation();
    setShowWhatsAppPopup(true);
  };

  const handleWhatsAppClose = () => {
    setShowWhatsAppPopup(false);
  };

  const handleWhatsAppConfirm = (data) => {
    setShowWhatsAppPopup(false);
  };

  const closedStatus = ["RESOLVED", "REJECTED", "CLOSEDAFTERREJECTION", "CLOSEDAFTERRESOLUTION"];
  const isClosed = closedStatus.includes(applicationStatus);
  const formattedDate = Digit.DateUtils.ConvertTimestampToDate(data.auditDetails.createdTime);

  return (
    <React.Fragment>
      <div
        onClick={handleClick}
        style={{
          backgroundColor: "#FFFFFF",
          borderRadius: "8px",
          boxShadow: "0 1px 4px rgba(0, 0, 0, 0.08)",
          padding: "16px",
          marginBottom: "16px",
          cursor: "pointer",
        }}
      >
        {/* Title + Track on WhatsApp - same line */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "14px" }}>
          <h2 style={{ fontSize: "20px", fontWeight: "600", color: "#0B0C0C", margin: 0 }}>
            {t(`SERVICEDEFS_${serviceCode.toUpperCase()}`)}
          </h2>
          <div onClick={(e) => e.stopPropagation()}>
            <button
              onClick={handleWhatsAppClick}
              style={{
                display: "inline-flex",
                alignItems: "center",
                padding: "10px 20px",
                backgroundColor: "#F47738",
                color: "#FFFFFF",
                border: "2px solid #F47738",
                borderRadius: "4px",
                fontSize: "14px",
                fontWeight: "600",
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              <WhatsAppIcon />
              {t("CS_PGR_TRACK_ON_WHATSAPP")}
            </button>
          </div>
        </div>

        {/* Date */}
        <div style={{ fontSize: "16px", color: "#505A5F", marginBottom: "14px", display: "flex", alignItems: "center", gap: "6px" }}>
          <span style={{ fontSize: "16px" }}>📅</span>
          <span>{formattedDate}</span>
        </div>

        {/* Complaint No */}
        <div style={{ fontSize: "16px", color: "#505A5F", marginBottom: "18px" }}>
          {t(`${LOCALIZATION_KEY.CS_COMMON}_COMPLAINT_NO`)}: {serviceRequestId}
        </div>

        {/* Status row - badge + substatus inline */}
        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "14px" }}>
          <span
            style={{
              display: "inline-block",
              padding: "4px 12px",
              fontSize: "13px",
              fontWeight: "600",
              borderRadius: "999px",
              backgroundColor: isClosed ? "#E8F5E9" : "#FFF3E0",
              color: isClosed ? "#2E7D32" : "#E65100",
              whiteSpace: "nowrap",
            }}
          >
            {(isClosed ? t("CS_COMMON_CLOSED") : t("CS_COMMON_OPEN")).toUpperCase()}
          </span>
          <span style={{ fontSize: "15px", color: "#505A5F" }}>
            {t(`${LOCALIZATION_KEY.CS_COMMON}_${applicationStatus}`)}
          </span>
        </div>
      </div>

      {showWhatsAppPopup && (
        <TrackOnWhatsApp
          showPopup={showWhatsAppPopup}
          onClose={handleWhatsAppClose}
          onConfirm={handleWhatsAppConfirm}
          defaultMobileNumber={userMobileNumber}
        />
      )}
    </React.Fragment>
  );
};

export default Complaint;
