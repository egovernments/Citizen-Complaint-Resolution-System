import React from "react";

import Background from "../Background";
import ImageComponent from "../ImageComponent";
import Carousel from "./EmployeeLoginCarousel";

export const setEmployeeDetail = (userObject, token) => {
  if (Digit.Utils.getMultiRootTenant() && process.env.NODE_ENV !== "development") return;
  const locale = JSON.parse(sessionStorage.getItem("Digit.locale"))?.value || Digit.Utils.getDefaultLanguage();
  localStorage.setItem("Employee.tenant-id", userObject?.tenantId);
  localStorage.setItem("tenant-id", userObject?.tenantId);
  localStorage.setItem("citizen.userRequestObject", JSON.stringify(userObject));
  localStorage.setItem("locale", locale);
  localStorage.setItem("Employee.locale", locale);
  localStorage.setItem("token", token);
  localStorage.setItem("Employee.token", token);
  localStorage.setItem("user-info", JSON.stringify(userObject));
  localStorage.setItem("Employee.user-info", JSON.stringify(userObject));
};

function PoweredByDigit({ onDarkSurface = true }) {
  const cfg = (key) => window?.globalConfigs?.getConfig?.(key);
  const preferred = onDarkSurface ? "DIGIT_FOOTER_BW" : "DIGIT_FOOTER";
  const other = onDarkSurface ? "DIGIT_FOOTER" : "DIGIT_FOOTER_BW";
  const src = cfg(preferred) || cfg(other);
  if (!src) return null;
  return (
    <div className="EmployeeLoginFooter">
      <ImageComponent
        alt="Powered by DIGIT"
        src={src}
        style={{ cursor: "pointer" }}
        onClick={() => window.open(cfg("DIGIT_HOME_URL"), "_blank")?.focus()}
      />
    </div>
  );
}

export function V2LoginShell({ children, withCarousel, bannerImages }) {
  if (withCarousel) {
    return (
      <div
        className="v2-scope"
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1.05fr) minmax(360px, 480px)",
          minHeight: "100vh",
          backgroundColor: "var(--color-page-bg, #f5f5f5)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "var(--color-primary-1, var(--color-primary-main, #c84c0e))",
            color: "#ffffff",
            padding: "32px",
            overflow: "hidden",
          }}
        >
          <Carousel bannerImages={bannerImages} />
        </div>
        <div
          style={{
            position: "relative",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "24px 24px 64px",
          }}
        >
          {children}
          <PoweredByDigit onDarkSurface={false} />
        </div>
      </div>
    );
  }
  return (
    <Background>
      <div
        className="v2-scope"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "100vh",
          padding: "24px",
          boxSizing: "border-box",
          width: "100%",
          backgroundColor: "transparent",
        }}
      >
        {children}
      </div>
      <PoweredByDigit />
    </Background>
  );
}
