import React, { useMemo, useRef, useState, useEffect } from "react";

/**
 * "What am I here to do, where and as what" for the logged-in employee
 * (CCRS#1833). Two surfaces over one payload:
 *
 *   <EmployeeWorkingContextSummary />  — the always-visible line in the header
 *   <EmployeeWorkingContextPanel />    — the full read-only set, on click
 *
 * The panel is a self-contained popover rather than an entry in the header's
 * user Dropdown: that Dropdown renders each option through
 * `t(option[optionKey])` and StringManipulator (digit-ui-components
 * Dropdown.js), so a rich node passed as an option label is fed to i18next as a
 * key and does not survive. Keeping this separate also leaves Edit Profile /
 * Logout untouched for every other DIGIT app that shares the component.
 *
 * Context switching is deliberately out of scope for this slice — everything
 * here is read-only.
 */

const ROLE_CONTEXT_KEY = "CS_ROLE_CONTEXT_";
const DEPARTMENT_KEY = "COMMON_MASTERS_DEPARTMENT_";
const ROLE_KEY = "ACCESSCONTROL_ROLES_ROLES_";

/** t() that falls back to the raw code instead of echoing a missing key. */
const label = (t, key, fallback) => {
  if (!key) return fallback;
  const translated = t(key);
  return translated && translated !== key ? translated : fallback;
};

const departmentLabel = (t, dept) => label(t, `${DEPARTMENT_KEY}${dept?.code}`, dept?.code);
const roleLabel = (t, role) => label(t, `${ROLE_KEY}${role?.code}`, role?.name || role?.code);
const roleContextLabel = (t, ctx) => label(t, `${ROLE_CONTEXT_KEY}${ctx}`, ctx);

/**
 * Boundaries are localized per hierarchy — `ADMIN_<BOUNDARY>` for the ADMIN
 * hierarchy, and the same shape for others. Falls back to the raw code, which
 * is also the safety net for the seeded records that carry a tenant code in
 * `boundary` instead of a real boundary.
 */
const jurisdictionLabel = (t, j) => {
  const hierarchy = String(j?.hierarchy || "").toUpperCase();
  const boundary = j?.boundary;
  if (!boundary) return null;
  return label(t, `${hierarchy}_${String(boundary).toUpperCase()}`, boundary);
};

/** City name from the resolved tenant, falling back to the raw tenant id. */
const cityLabel = (t, cityDetails, tenantId) => label(t, cityDetails?.i18nKey, tenantId);

/** First value plus a +N marker, so the header never wraps. */
function Truncated({ values }) {
  if (!values?.length) return null;
  return (
    <React.Fragment>
      <span>{values[0]}</span>
      {values.length > 1 && <span className="digit-working-context-more">{` +${values.length - 1}`}</span>}
    </React.Fragment>
  );
}

export function EmployeeWorkingContextSummary({ t, context, cityDetails, tenantId, isError }) {
  if (isError) {
    return (
      <div className="digit-working-context-summary digit-working-context-error">
        {t("CS_WORKING_CONTEXT_UNAVAILABLE")}
      </div>
    );
  }
  if (!context) return null;

  const city = cityLabel(t, cityDetails, context.tenantId || tenantId);
  const departments = (context.departments || []).map((d) => departmentLabel(t, d)).filter(Boolean);
  const roleContexts = (context.roleContexts || []).map((c) => roleContextLabel(t, c)).filter(Boolean);

  const parts = [];
  if (city) parts.push(<span key="city">{city}</span>);
  if (departments.length) parts.push(<Truncated key="dept" values={departments} />);
  if (roleContexts.length) parts.push(<Truncated key="ctx" values={roleContexts} />);
  if (!parts.length) return null;

  return (
    <div className="digit-working-context-summary">
      {parts.map((part, i) => (
        <React.Fragment key={i}>
          {i > 0 && <span className="digit-working-context-sep">·</span>}
          {part}
        </React.Fragment>
      ))}
    </div>
  );
}

function Group({ title, children }) {
  if (!children) return null;
  return (
    <div className="digit-working-context-group">
      <div className="digit-working-context-group-label">{title}</div>
      <div className="digit-working-context-group-value">{children}</div>
    </div>
  );
}

export function EmployeeWorkingContextPanel({ t, context, cityDetails, tenantId, onDismiss }) {
  const ref = useRef(null);

  useEffect(() => {
    const onDocClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onDismiss?.();
    };
    const onEsc = (e) => {
      if (e.key === "Escape") onDismiss?.();
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [onDismiss]);

  const rows = useMemo(() => {
    if (!context) return null;
    return {
      city: cityLabel(t, cityDetails, context.tenantId || tenantId),
      departments: (context.departments || []).map((d) => departmentLabel(t, d)).filter(Boolean),
      roleContexts: (context.roleContexts || []).map((c) => roleContextLabel(t, c)).filter(Boolean),
      roles: (context.roles || []).map((r) => roleLabel(t, r)).filter(Boolean),
      jurisdictions: (context.jurisdictions || [])
        .map((j) => ({ name: jurisdictionLabel(t, j), type: j?.boundaryType }))
        .filter((j) => j.name),
    };
  }, [t, context, cityDetails, tenantId]);

  if (!rows) return null;

  return (
    <div className="digit-working-context-panel" ref={ref} role="dialog" aria-label={t("CS_WORKING_CONTEXT")}>
      <Group title={t("CS_WORKING_CONTEXT_CITY")}>{rows.city}</Group>

      <Group title={t("CS_WORKING_CONTEXT_DEPARTMENT")}>
        {rows.departments.length
          ? rows.departments.map((d, i) => <div key={i}>{d}</div>)
          : null}
      </Group>

      <Group title={t("CS_WORKING_CONTEXT_ROLE")}>
        {rows.roleContexts.length || rows.roles.length ? (
          <React.Fragment>
            {rows.roleContexts.map((c, i) => (
              <div key={`c${i}`}>{c}</div>
            ))}
            {rows.roles.length ? <div className="digit-working-context-raw-roles">{rows.roles.join(", ")}</div> : null}
          </React.Fragment>
        ) : null}
      </Group>

      <Group title={t("CS_WORKING_CONTEXT_JURISDICTION")}>
        {rows.jurisdictions.length
          ? rows.jurisdictions.map((j, i) => (
              <div key={i}>
                {j.name}
                {j.type ? <span className="digit-working-context-qualifier">{` (${j.type})`}</span> : null}
              </div>
            ))
          : null}
      </Group>
    </div>
  );
}

/** Summary + click-to-expand panel, for the desktop header. */
export function EmployeeWorkingContext({ t, context, cityDetails, tenantId, isError }) {
  const [open, setOpen] = useState(false);

  if (isError) {
    return <EmployeeWorkingContextSummary t={t} isError context={null} />;
  }
  if (!context) return null;

  return (
    <div className="digit-working-context">
      <button
        type="button"
        className="digit-working-context-trigger"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <EmployeeWorkingContextSummary t={t} context={context} cityDetails={cityDetails} tenantId={tenantId} />
      </button>
      {open && (
        <EmployeeWorkingContextPanel
          t={t}
          context={context}
          cityDetails={cityDetails}
          tenantId={tenantId}
          onDismiss={() => setOpen(false)}
        />
      )}
    </div>
  );
}

export default EmployeeWorkingContext;
