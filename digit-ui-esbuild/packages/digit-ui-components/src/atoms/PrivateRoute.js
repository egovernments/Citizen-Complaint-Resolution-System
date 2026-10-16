import React from "react";
import PropTypes from "prop-types";
import { Route, Redirect } from "react-router-dom";

// Surface + login target come from the libraries' tenant-route aware resolver
// (Digit.AuthSurface, set up by initLibraries) so `/{tenantSlug}/digit-ui/employee/...`
// is treated as employee. A runtime lookup, not an import: this package is
// built and published without the libraries package.

export const PrivateRoute = ({ component: Component, roles, ...rest }) => {
  return (
    <Route
      {...rest}
      render={(props) => {
        const user = window?.Digit?.UserService.getUser();
        // Derive expected surface from the URL the user is trying to
        // reach (NOT from the last-stored userType — that's whoever
        // logged in last and may not match the path being visited).
        // `/{slug}/digit-ui/employee/...` or `/<contextPath>/employee/...`
        // → employee, anything else → citizen.
        const { surface: pathUserType, loginPath } = window.Digit.AuthSurface.privateRouteLogin(
          props.location.pathname,
          window?.contextPath,
        );

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
