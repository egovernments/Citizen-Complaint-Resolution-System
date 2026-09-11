import { Button, Card, SubmitBar, Loader } from "@egovernments/digit-ui-components";
import { CustomButton } from "@egovernments/digit-ui-react-components";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { useHistory, Redirect } from "react-router-dom";
import Background from "../../../components/Background";
import ImageComponent from "../../../components/ImageComponent";

const DEFAULT_LOCALE=Digit?.Utils?.getDefaultLanguage?.();

const defaultLanguage = { label: "English", value:  DEFAULT_LOCALE};

/**
 * MDMS StateInfo stores each language's label as a shouted endonym
 * ("ENGLISH", "FRANÇAIS", "PORTUGUÊS") and the UI runs it through t(). Only
 * ENGLISH happens to be seeded in localization, so it renders "English"
 * while every other language echoes its own key and shows up in caps. The
 * result is one language cased differently from the rest.
 *
 * Rather than depend on someone seeding a key per language per tenant, fall
 * back to the endonym in title case when the translation is missing. Casing
 * is locale-aware so İ/i and ß behave, and the separators cover names like
 * "KISWAHILI" and hyphenated or apostrophised forms.
 */
const titleCaseEndonym = (raw, locale) =>
  String(raw)
    .toLocaleLowerCase(locale)
    .replace(/(^|[\s\-'’])(\p{L})/gu, (_, sep, ch) => sep + ch.toLocaleUpperCase(locale));

const languageLabel = (t, language) => {
  const raw = language?.label;
  if (!raw) return "";
  const translated = t(raw);
  // i18next echoes the key when there is no entry for it.
  if (translated && translated !== raw) return translated;
  return titleCaseEndonym(raw, language?.value?.replace("_", "-"));
};
const LanguageSelection = () => {
  const { data: storeData, isLoading } = Digit.Hooks.useStore.getInitData();
  const { t } = useTranslation();
  const history = useHistory();
  const { languages, stateInfo } = storeData || {};
  let defaultLanguages = languages;
  if (!defaultLanguages || defaultLanguages?.length == 0) {
    defaultLanguages = [defaultLanguage];
  }
  const selectedLanguage = Digit.StoreData.getCurrentLanguage();
  const [selected, setselected] = useState(selectedLanguage);
  const handleChangeLanguage = (language) => {
    setselected(language.value);
    Digit.LocalizationService.changeLanguage(language.value, stateInfo.code);
  };

  function getContextPath(contextPath) {
    if (!contextPath || typeof contextPath !== "string") return "";
    return contextPath.split("/")[0];
  }
  const hasMultipleLanguages = languages?.length > 1;

  const handleSubmit = (event) => {
    // Push directly to the employee login route. The previous target
    // `/${contextPath}/user/login` only resolves when window.globalPath is
    // set (DigitAppWrapper's LoginV2 route is keyed off globalPath); on the
    // tenants we ship to, globalPath is undefined, so it fell through to a
    // catch-all <Redirect to /${contextPath}/${defaultLanding}> and looped
    // back to /employee → /language-selection.
    history.push(`/${getContextPath(window.contextPath)}/employee/user/login?ts=${Date.now()}`);
  };

  if (isLoading) return <Loader />;

  if (!hasMultipleLanguages) {
    return <Redirect to={`/${window?.contextPath}/employee/user/login`} />;
  }

  return (
    <Background>
      <Card className={"bannerCard removeBottomMargin languageSelection"}>
        <div className="bannerHeader">
          <ImageComponent className="bannerLogo" src={stateInfo?.logoUrl} alt="Digit Banner Image" />

          <p>{t(Digit.Utils.locale.getTransformedLocale(`TENANT_TENANTS_${stateInfo?.code}`))}</p>
        </div>
        <div
          className="language-selector"
          style={{
            justifyContent: "center",
            alignItems: "center",
            gap: "12px",
            marginBottom: "24px",
          }}
        >
          {defaultLanguages.map((language, index) => (
            <div className="language-button-container" key={index}>
              <CustomButton
                selected={language.value === selected}
                text={languageLabel(t, language)}
                onClick={() => handleChangeLanguage(language)}
              ></CustomButton>
            </div>
          ))}
        </div>
        <SubmitBar style={{ width: "100%" }} label={t(`CORE_COMMON_CONTINUE`)} onSubmit={handleSubmit} />
      </Card>
      <div className="EmployeeLoginFooter">
        <ImageComponent
          alt="Powered by DIGIT"
          src={window?.globalConfigs?.getConfig?.("DIGIT_FOOTER_BW")}
          style={{ cursor: "pointer" }}
          onClick={() => {
            window.open(window?.globalConfigs?.getConfig?.("DIGIT_HOME_URL"), "_blank").focus();
          }}
        />{" "}
      </div>
    </Background>
  );
};

export default LanguageSelection;
