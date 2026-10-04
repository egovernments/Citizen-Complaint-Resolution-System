import React from "react";
import { Loader } from "@egovernments/digit-ui-components";

import { SignInFailureCard, useIdentityBffSignIn } from "../../../components/IdentityBffSignIn";
import { setCitizenDetail } from "./index";
import { V2LoginShell } from "./SelectMobileNumber";

/**
 * Citizen sign-in on canonical tenant routes. Signed-out visitors are sent
 * to the `digit-ui-citizen` Keycloak client; the resulting BFF session is
 * exchanged for a DIGIT CITIZEN token issued at the route tenant's root and
 * bound to the route tenant. The card only renders for failures.
 */
const IdentityBffCitizenLogin = ({ t }) => {
  const signIn = useIdentityBffSignIn({
    surface: "citizen",
    t,
    // `user.info.tenantId` is the root the DIGIT citizen account lives at
    // (as with the legacy OTP login); the stored citizen tenant is the route
    // tenant, so complaints and other business requests stay on this URL's
    // tenant.
    onAuthenticated: (user, tenant) => {
      Digit.SessionStorage.set("citizen.userRequestObject", user);
      Digit.UserService.setType("citizen");
      Digit.UserService.setUser(user);
      setCitizenDetail(user.info, user.access_token, tenant.tenantId);
    },
  });

  if (signIn.status === "checking") return <Loader page={true} variant="PageLoader" />;
  return <SignInFailureCard signIn={signIn} Shell={V2LoginShell} />;
};

export default IdentityBffCitizenLogin;
