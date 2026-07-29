import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Route, Switch, useRouteMatch } from "react-router-dom";
import { loginConfig } from "./config";
import ForgotPasswordComponent from "./forgotPassword";

const EmployeeForgotPassword = ({stateCode}) => {
  const { t } = useTranslation();
  const { path } = useRouteMatch();


  const params = useMemo(() =>
    loginConfig.map(
      (step) => {
        // Pass the raw loc KEYS through — forgotPassword.js resolves them via
        // its own tr(key, fallback) at render. Pre-resolving with t() here and
        // letting tr() run again double-resolves: tr sees an already-translated
        // message, trans(message) === message, and returns the English fallback
        // — so the header/description/submit texts ignored the locale. Keeping
        // raw keys makes tr() resolve them once.
        const texts = {};
        for (const key in step.texts) {
          texts[key] = step.texts[key];
        }
        return { ...step, texts };
      },
      [loginConfig]
    )
  );

  return (
    <Switch>
      <Route path={`${path}`} exact>
        <ForgotPasswordComponent config={params[0]}  t={t} stateCode={stateCode}/>
      </Route>
    </Switch>
  );
};

export default EmployeeForgotPassword;
