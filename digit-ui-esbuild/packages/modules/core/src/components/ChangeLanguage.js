import { Button, Dropdown } from "@egovernments/digit-ui-components";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { languageLabel } from "./utils";



const TranslateGlyph = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <path d="m5 8 6 6" />
    <path d="m4 14 6-6 2-3" />
    <path d="M2 5h12" />
    <path d="M7 2h1" />
    <path d="m22 22-5-10-5 10" />
    <path d="M14 18h6" />
  </svg>
);

/** "en_IN" → "EN": the pill has room for a code, not a name. */
const shortCode = (value) => String(value || "").split(/[_-]/)[0].toUpperCase();

/**
 * The phone bar's language control: a pill with the current language's code
 * that opens the list, as in the design. The desktop bar keeps its dropdown;
 * this exists because the phone bar has no room for a label.
 */
const LanguagePill = ({ languages, selected, onPick, t }) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
    };
    const onKey = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const label = t("CORE_COMMON_LANGUAGE") !== "CORE_COMMON_LANGUAGE" ? t("CORE_COMMON_LANGUAGE") : "Language";
  return (
    <div className="digit-language-pill" ref={rootRef}>
      <button
        type="button"
        className="digit-language-pill-button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((value) => !value)}
      >
        <TranslateGlyph />
        {shortCode(selected)}
      </button>
      {open ? (
        <ul className="digit-language-pill-menu" role="list">
          {languages.map((language) => {
            const active = language.value === selected;
            return (
              <li key={language.value}>
                <button
                  type="button"
                  className={`digit-language-pill-option${active ? " active" : ""}`}
                  aria-pressed={active}
                  onClick={() => {
                    setOpen(false);
                    if (!active) onPick(language);
                  }}
                >
                  <span>{language.label}</span>
                  {active ? (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
};

const ChangeLanguage = (prop) => {
  const isDropdown = prop.dropdown || false;
  const { data: storeData, isLoading } = Digit.Hooks.useStore.getInitData();
  const { languages, stateInfo } = storeData || {};
  const { t } = useTranslation();
  const selectedLanguage = Digit.StoreData.getCurrentLanguage();
  const [selected, setselected] = useState(selectedLanguage);
  const handleChangeLanguage = (language) => {
    setselected(language.value);
    Digit.LocalizationService.changeLanguage(language.value, stateInfo.code);
  };

  // Dropdown renders each option as t(option[optionKey]), so an unseeded
  // language shows its own shouted MDMS key. Resolve the display label up
  // front and hand the Dropdown options that already read correctly, while
  // keeping `value` intact so selection still works.
  //
  // Declared above the isLoading guard: this is a hook, and returning early
  // before it would make the hook order differ between renders.
  const labelledLanguages = useMemo(
    () => (languages || []).map((language) => ({ ...language, label: languageLabel(t, language) })),
    [languages, t]
  );

  if (isLoading) return null;

  if (prop.compact) {
    return <LanguagePill languages={labelledLanguages} selected={selected} onPick={handleChangeLanguage} t={t} />;
  }

  if (isDropdown) {
    const current = labelledLanguages?.find((language) => language?.value === selected);
    return (
      <div>
        <Dropdown
          className={"language-dropdown"}
          option={labelledLanguages}
          selected={labelledLanguages?.find((language) => language?.value === selectedLanguage)}
          optionKey={"label"}
          select={handleChangeLanguage}
          freeze={true}
          customSelector={<label className="cp">{current?.label}</label>}
        />
      </div>
    );
  } else {
    return (
      <React.Fragment>
        <div style={{ marginBottom: "5px" }}>Language</div>
        <div className="language-selector">
          {languages.map((language, index) => (
            <div className="language-button-container" key={index}>
              <Button
                label={languageLabel(t, language)}
                onClick={() => handleChangeLanguage(language)}
                variation={language.value === selected ? "primary" : ""}
              />
            </div>
          ))}
        </div>
      </React.Fragment>
    );
  }
};

export default ChangeLanguage;
