import React, { useMemo } from "react";
import { PageBasedInput, Loader, RadioButtons, CardHeader } from "@egovernments/digit-ui-react-components";
import { useTranslation } from "react-i18next";
import { useHistory } from "react-router-dom";

const LanguageSelection = () => {
  const { t } = useTranslation();
  const history = useHistory();

  const { data: { languages, stateInfo } = {}, isLoading } = Digit.Hooks.useStore.getInitData();
  const selectedLanguage = Digit.StoreData.getCurrentLanguage();

  const texts = useMemo(
    () => ({
      header: t("CS_COMMON_CHOOSE_LANGUAGE"),
      submitBarLabel: t("CORE_COMMON_CONTINUE"),
    }),
    [t]
  );

  const RadioButtonProps = useMemo(
    () => ({
      options: languages,
      optionsKey: "label",
      additionalWrapperClass: "reverse-radio-selection-wrapper",
      onSelect: (language) => Digit.LocalizationService.changeLanguage(language.value, stateInfo.code),
      selectedOption: languages?.filter((i) => i.value === selectedLanguage)[0],
    }),
    [selectedLanguage, languages]
  );

  function onSubmit() {
    const isKC = window?.globalConfigs?.getConfig("AUTH_PROVIDER") === "keycloak";
    const user = Digit.UserService.getUser();
    if (isKC && user?.access_token) {
      // Already authenticated via Keycloak — skip login, go to location or home
      history.push(`/${window?.contextPath}/citizen`);
    } else if (isKC) {
      history.push(`/${window?.globalPath || window?.contextPath}/user/login`);
    } else {
      history.push(`/${window?.contextPath}/citizen/login`);
    }
  }

  return isLoading ? (
    <Loader />
  ) : (
    <div className="selection-card-wrapper">
      <PageBasedInput texts={texts} onSubmit={onSubmit}>
        <CardHeader>{t("CS_COMMON_CHOOSE_LANGUAGE")}</CardHeader>
        <RadioButtons {...RadioButtonProps} />
      </PageBasedInput>
    </div>
  );
};

export default LanguageSelection;
