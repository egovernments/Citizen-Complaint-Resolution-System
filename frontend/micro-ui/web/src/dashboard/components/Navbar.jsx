import React, { useMemo } from "react";

function getUserInfo() {
  try {
    const fromSession = window.Digit?.SessionStorage?.get("User")?.info;
    if (fromSession?.name) return fromSession;

    const raw = localStorage.getItem("Employee.user-info");
    if (raw) {
      const parsed = JSON.parse(raw);
      return parsed?.name ? parsed : parsed?.userInfo || parsed;
    }
  } catch {
    /* ignore */
  }
  return null;
}

const Navbar = ({ onResetLayout }) => {
  const user = useMemo(() => getUserInfo(), []);

  const displayName = user?.name || "Admin User";
  const displayRole =
    user?.roles?.[0]?.name || user?.type || "Administrator";

  return (
    <header className="tw-flex tw-h-16 tw-flex-shrink-0 tw-items-center tw-justify-between tw-border-b tw-border-slate-200 tw-bg-white tw-px-6 tw-shadow-sm">
      <div>
        <h2 className="tw-text-lg tw-font-semibold tw-text-slate-800">
          Bomet County — Complaint Resolution System
        </h2>
        <p className="tw-text-xs tw-text-slate-500">Admin Dashboard</p>
      </div>
      <div className="tw-flex tw-items-center tw-gap-4">
        <button
          type="button"
          onClick={onResetLayout}
          className="tw-rounded-md tw-border tw-border-slate-300 tw-bg-white tw-px-3 tw-py-1.5 tw-text-xs tw-font-medium tw-text-slate-600 hover:tw-bg-slate-50"
        >
          Reset layout
        </button>
        <div className="tw-text-right">
          <p className="tw-text-sm tw-font-medium tw-text-slate-800">{displayName}</p>
          <p className="tw-text-xs tw-text-slate-500">{displayRole}</p>
        </div>
        <div className="tw-flex tw-h-10 tw-w-10 tw-items-center tw-justify-center tw-rounded-full tw-bg-bomet-teal tw-text-sm tw-font-bold tw-text-white">
          {displayName.charAt(0).toUpperCase()}
        </div>
      </div>
    </header>
  );
};

export default Navbar;
