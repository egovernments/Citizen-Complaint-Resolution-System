import { Button, Dropdown } from "@egovernments/digit-ui-components";
import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { languageLabel } from "./utils";



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
