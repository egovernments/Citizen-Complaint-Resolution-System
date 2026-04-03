import React from "react";
import { Route, Redirect } from "react-router-dom";

function isKeycloakAuth() {
  return window?.globalConfigs?.getConfig("AUTH_PROVIDER") === "keycloak";
}

export const PrivateRoute = ({ component: Component, roles, ...rest }) => {
  return (
    <Route
      {...rest}
      render={(props) => {
        const user = Digit.UserService.getUser();
        const userType = Digit.UserService.getType();

        function getLoginRedirectionLink() {
          if (isKeycloakAuth()) {
            return `/${window?.contextPath}/user/login`;
          }
          if (userType === "employee") {
            return `/${window?.contextPath}/employee/user/language-selection`;
          }
          return `/${window?.contextPath}/citizen/login`;
        }

        if (!user || !user.access_token) {
          return (
            <Redirect
              to={{
                pathname: getLoginRedirectionLink(),
                state: { from: props.location.pathname + props.location.search },
              }}
            />
          );
        }

        return <Component {...props} />;
      }}
    />
  );
};
