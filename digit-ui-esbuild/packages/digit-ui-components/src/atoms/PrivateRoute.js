import React from "react";
import PropTypes from "prop-types";
import { Route, Redirect } from "react-router-dom";

// Keycloak/SSO is resolved per surface: citizen may use Keycloak while the
// employee surface always stays on DIGIT password auth. Keep in sync with
// libraries/src/services/auth/authSurface.js (inlined here to avoid a
// cross-package import).
function isKeycloakAuth(pathname) {
  const parts = (pathname || "").split("/").filter(Boolean);
  const surface = parts[1] === "employee" ? "employee" : "citizen";
  const cfg = (key) => window?.globalConfigs?.getConfig(key);
  const provider =
    surface === "employee"
      ? cfg("EMPLOYEE_AUTH_PROVIDER") || "digit"
      : cfg("CITIZEN_AUTH_PROVIDER") || cfg("AUTH_PROVIDER") || "digit";
  return provider === "keycloak";
}

export const PrivateRoute = ({ component: Component, roles, ...rest }) => {
  return (
    <Route
      {...rest}
      render={(props) => {
        const user = window?.Digit?.UserService.getUser();
        // Derive expected surface from the URL the user is trying to
        // reach (NOT from the last-stored userType — that's whoever
        // logged in last and may not match the path being visited).
        // `/<contextPath>/employee/...` → employee, anything else → citizen.
        const pathParts = (props.location.pathname || "").split("/").filter(Boolean);
        const pathUserType = pathParts[1] === "employee" ? "employee" : "citizen";
        const loginPath = isKeycloakAuth(props.location.pathname)
          ? `/${window?.contextPath}/user/login`
          : (pathUserType === "employee"
            ? `/${window?.contextPath}/employee/user/language-selection`
            : `/${window?.contextPath}/citizen/login`);

        // No token at all → bounce to the login page that matches the
        // URL the user was trying to reach.
        if (!user || !user.access_token) {
          return (
            <Redirect
              to={{ pathname: loginPath, state: { from: props.location.pathname + props.location.search } }}
            />
          );
        }

        // Token exists but the logged-in user is the wrong type for
        // this surface (citizen token visiting /employee/... or vice
        // versa). Send them to the surface's own login. This closes the
        // hole where a citizen could open an employee-only screen via a
        // pasted URL or a stale topbar/sidebar link.
        const tokenUserType = (user?.info?.type || "").toLowerCase();
        const expected = pathUserType === "employee" ? "employee" : "citizen";
        if (tokenUserType && tokenUserType !== expected) {
          return (
            <Redirect
              to={{ pathname: loginPath, state: { from: props.location.pathname + props.location.search } }}
            />
          );
        }

        // logged in so return component
        return <Component {...props} />;
      }}
    />
  );
};

PrivateRoute.propTypes = {
  component: PropTypes.elementType.isRequired,
  roles: PropTypes.arrayOf(PropTypes.string),
};
