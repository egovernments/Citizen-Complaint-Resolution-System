import React, { useEffect, useState } from "react";
import PopoverMenu, { PopoverMenuItem } from "./ui/PopoverMenu";
import { ownsLanguageSwitch, setLanguage } from "../i18n/localeRuntime";
import useDashboardT from "../i18n/useDashboardT";
import { fetchStateLanguages } from "../services/stateInfoService";

const GlobeIcon = () => (
  <svg
    width="13"
    height="13"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <circle cx="12" cy="12" r="10" />
    <path d="M2 12h20" />
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
  </svg>
);

/**
 * Language switcher for the standalone/public shell (#1797). Embedded mode
 * never mounts this — the DigitUI TopBar's ChangeLanguage owns the switch there.
 *
 * Options come from the tenant's `common-masters.StateInfo.languages` (the
 * same master the TopBar reads); selecting one calls the runtime's
 * setLanguage, which re-fetches the bundle and notifies every useDashboardT
 * subscriber. Renders nothing until the list resolves, and stays hidden for a
 * tenant that declares a single language — a one-item menu is just noise.
 */
const LanguageMenu = () => {
  const { t, language } = useDashboardT();
  const [languages, setLanguages] = useState(null);

  // Self-gate on the runtime that actually performs the switch: a shell that
  // happens to load the DigitUI libraries gets the host TopBar switcher, and
  // this menu must not render a control whose clicks would be swallowed.
  const owns = ownsLanguageSwitch();
  useEffect(() => {
    if (!owns) return undefined;
    let cancelled = false;
    fetchStateLanguages().then((list) => {
      if (!cancelled) setLanguages(list);
    });
    return () => {
      cancelled = true;
    };
  }, [owns]);

  if (!owns || !languages || languages.length < 2) return null;

  const current = languages.find((l) => l.value === language);
  return (
    <PopoverMenu
      ariaLabel={t("DASHBOARD_HEADER_LANGUAGE", "Language")}
      icon={<GlobeIcon />}
      chip={current?.label ?? language}
      chipTitle={t("DASHBOARD_HEADER_LANGUAGE", "Language")}
      align="end"
      panelWidth={200}
      chipClassName="dashboard-language-chip"
    >
      {({ close }) => (
        <div className="dashboard-popover-list">
          {languages.map((option) => (
            <PopoverMenuItem
              key={option.value}
              selected={option.value === language}
              title={option.label}
              onSelect={() => {
                setLanguage(option.value);
                close();
              }}
            >
              {option.label}
            </PopoverMenuItem>
          ))}
        </div>
      )}
    </PopoverMenu>
  );
};

export default LanguageMenu;
