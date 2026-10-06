import React from "react";
import { Loader } from "@egovernments/digit-ui-components";

import { SignInFailureCard, useIdentityBffSignIn } from "../../components/IdentityBffSignIn";
import { setEmployeeDetail, V2LoginShell } from "../../components/IdentityLogin/EmployeeLoginShell";

/**
 * Employee sign-in on canonical tenant routes. The Identity BFF sends the
 * browser to the `digit-ui-employee` Keycloak client, whose theme looks like
 * the legacy DIGIT login, so a signed-out visitor is redirected straight
 * there; the card only renders for failures.
 */
const IdentityBffEmployeeLogin = ({ t }) => {
  const signIn = useIdentityBffSignIn({
    surface: "employee",
    t,
    onAuthenticated: (user, tenant) => {
      const { info, ...tokens } = user;
      Digit.SessionStorage.set("Employee.tenantId", tenant.tenantId);
      Digit.SessionStorage.set("citizen.userRequestObject", user);
      Digit.UserService.setType("employee");
      Digit.UserService.setUser(user);
      setEmployeeDetail(info, tokens.access_token);
    },
  });

  if (signIn.status === "checking") return <Loader page={true} variant="PageLoader" />;
  return <SignInFailureCard signIn={signIn} Shell={V2LoginShell} />;
};

export default IdentityBffEmployeeLogin;
