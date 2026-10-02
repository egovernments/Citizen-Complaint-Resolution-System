import React, { useEffect, useState } from "react";
import { fetchStateLogo } from "../services/stateInfoService";
import LanguageMenu from "./LanguageMenu";

/**
 * The public page's top bar. The page has no DigitUI chrome, so it carries
 * its own on the theme's header colour: the tenant crest at the left, as the
 * app's top bar shows it, and the language switcher at the right, where the
 * header's buttons used to make room for it.
 */
const PublicTopBar = () => {
  const [logo, setLogo] = useState(null);
  const [logoFailed, setLogoFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchStateLogo().then((url) => {
      if (!cancelled) setLogo(url);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="dashboard-public-topbar">
      {logo && !logoFailed ? (
        // The crest is decoration here: no tenant name is reliably seeded to
        // describe it, and the page title below names the page.
        <img className="dashboard-public-topbar-crest" src={logo} alt="" onError={() => setLogoFailed(true)} />
      ) : (
        <span />
      )}
      <LanguageMenu />
    </div>
  );
};

export default PublicTopBar;
