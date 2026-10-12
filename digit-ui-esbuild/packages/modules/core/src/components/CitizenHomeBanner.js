import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

/** globalConfigs CITIZEN_BANNER_ENABLED, off unless set to true. */
export const citizenBannerEnabled = () => {
  const value = window?.globalConfigs?.getConfig?.("CITIZEN_BANNER_ENABLED");
  return value === true || value === "true";
};

// Material Icons "edit" and "list_alt", the marks the citizen rail uses for the same two links.
const FileIcon = () => (
  <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
    <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" />
  </svg>
);
const ListIcon = () => (
  <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
    <path d="M19 5v14H5V5h14m1.1-2H3.9c-.5 0-.9.4-.9.9v16.2c0 .4.4.9.9.9h16.2c.4 0 .9-.5.9-.9V3.9c0-.5-.5-.9-.9-.9zM11 7h6v2h-6V7zm0 4h6v2h-6v-2zm0 4h6v2h-6v-2zM7 7h2v2H7V7zm0 4h2v2H7v-2zm0 4h2v2H7v-2z" />
  </svg>
);

/**
 * The citizen home's banner (#2358): the photo an admin sets in the
 * Configurator's Branding step (common-masters.StateInfo.bannerUrl), darkened
 * behind a welcome and the two things a citizen comes here to do, above the
 * page it wraps (All Services).
 *
 * Off unless globalConfigs CITIZEN_BANNER_ENABLED is true. With it off, no
 * banner set, or one that fails to load, it returns the page untouched, so the
 * page is exactly as it was.
 */
const CitizenHomeBanner = ({ children }) => {
  const { t } = useTranslation();
  const { data: { stateInfo } = {} } = Digit.Hooks.useStore.getInitData();
  const [failed, setFailed] = useState(null);
  const src = stateInfo?.bannerUrl;

  if (!citizenBannerEnabled() || !src || failed === src) return children;

  const base = `/${window?.contextPath}/citizen/pgr`;
  return (
    <div className="cms-citizen-home">
      <section className="cms-home-banner" aria-labelledby="cms-home-banner-title">
        <img className="cms-home-banner__image" src={src} alt="" onError={() => setFailed(src)} />
        <div className="cms-home-banner__content">
          <p className="cms-home-banner__eyebrow">{t("CS_HOME_BANNER_WELCOME", "Welcome to")}</p>
          <h2 id="cms-home-banner-title" className="cms-home-banner__title">
            {stateInfo?.name ? <span className="cms-home-banner__name">{stateInfo.name}</span> : null}
            <span className="cms-home-banner__product">{t("CS_HOME_BANNER_PRODUCT", "Complaint Management System")}</span>
          </h2>
          <p className="cms-home-banner__tagline">
            {t("CS_HOME_BANNER_TAGLINE", "Report issues, track progress and see what is happening in your area.")}
          </p>
          <div className="cms-home-banner__actions">
            <Link className="cms-home-banner__button cms-home-banner__button--primary" to={`${base}/create-complaint`}>
              <FileIcon />
              {t("CS_COMMON_FILE_A_COMPLAINT")}
            </Link>
            <Link className="cms-home-banner__button" to={`${base}/complaints`}>
              <ListIcon />
              {t("CS_HOME_MY_COMPLAINTS")}
            </Link>
          </div>
        </div>
      </section>
      {children}
    </div>
  );
};

export default CitizenHomeBanner;
