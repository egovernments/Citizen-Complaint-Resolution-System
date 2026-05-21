import React from "react";
import { useLocation } from "react-router-dom";

const Card = ({ onClick, style, children, className, ReactRef, noCardStyle, ...props }) => {
  const { pathname } = useLocation();
  const classname = Digit.Hooks.useRouteSubscription(pathname);
  const info = Digit.UserService.getUser()?.info;
  const userType = info?.type;
  const isEmployee = classname === "employee" || userType === "EMPLOYEE";

  return (
    <div
      className={`${noCardStyle ? "" : isEmployee ? "employeeCard" : "card"} ${className ? className : ""}`}
      onClick={onClick}
      style={style}
      {...props}
      ref={ReactRef}
    >
      {children}
    </div>
  );
};

export default Card;
