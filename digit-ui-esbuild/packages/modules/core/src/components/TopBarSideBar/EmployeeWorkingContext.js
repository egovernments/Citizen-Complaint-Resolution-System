import React, { useMemo, useRef, useState, useEffect, useLayoutEffect } from "react";

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
/**
 * Role contexts arrive as shouted codes ("RESOLVER") and are usually unseeded,
 * so t() echoes the key. Title-case the fallback for the same reason the
 * language endonyms needed it, and leave an already mixed-case label alone.
 */
const roleContextLabel = (t, ctx) => {
  const key = `${ROLE_CONTEXT_KEY}${ctx}`;
  const translated = t(key);
  if (translated && translated !== key) return translated;
  const raw = String(ctx || "");
  if (!raw) return raw;
  const shouted = raw === raw.toUpperCase() && raw !== raw.toLowerCase();
  if (!shouted) return raw;
  return raw
    .toLowerCase()
    .replace(/(^|[\s\-_])(\p{L})/gu, (_, sep, ch) => (sep === "_" ? " " : sep) + ch.toUpperCase());
};

/** CITIZEN is the citizen-side counterpart, not an employee assignment. */
const isAssignedContext = (ctx) => String(ctx || "").toUpperCase() !== "CITIZEN";

/**
 * Platform roles, not job descriptions. Every employee carries several of these
 * because of how access control is seeded, and listing them tells the person
 * nothing about what they are here to do — "Internal Microservice Role" is not
 * an assignment (#2038).
 *
 * A denylist rather than an allowlist on purpose: tenants add their own
 * business roles over time, and an allowlist would silently swallow each new
 * one. Anything not named here is assumed to be a real assignment.
 */
const INFRASTRUCTURE_ROLES = new Set([
  "INTERNAL_MICROSERVICE_ROLE",
  "SUPERUSER",
  "MDMS_ADMIN",
  "LOC_ADMIN",
  "ACCOUNT_ADMIN",
  "EMPLOYEE", // every employee has it; it distinguishes nobody
  "CITIZEN", // the citizen-side counterpart, same reasoning
]);

const isAssignedRole = (role) => !INFRASTRUCTURE_ROLES.has(String(role?.code || "").toUpperCase());

/**
 * The subset of the denylist that is never an employee assignment under any
 * reading, as opposed to the ones that are merely too generic to be useful.
 * Used as the floor when filtering would otherwise leave an account with no
 * roles at all.
 */
const NEVER_AN_ASSIGNMENT = new Set(["CITIZEN", "INTERNAL_MICROSERVICE_ROLE"]);
const isNeverAnAssignment = (role) =>
  !NEVER_AN_ASSIGNMENT.has(String(role?.code || "").toUpperCase());

/**
 * The one answer to "what roles does this person hold here", so the pill's
 * count and the panel's chips can never disagree. Role contexts are the
 * higher-level story ("Resolver") and win when the payload carries them;
 * otherwise fall back to the raw roles, minus the platform ones.
 */
const assignedRoleLabels = (t, context) => {
  const contexts = (context?.roleContexts || [])
    .filter(isAssignedContext)
    .map((c) => roleContextLabel(t, c))
    .filter(Boolean);
  if (contexts.length) return contexts;
  const roles = context?.roles || [];
  const assigned = roles.filter(isAssignedRole);
  if (assigned.length) return assigned.map((r) => roleLabel(t, r)).filter(Boolean);
  // A workbench or admin account can hold nothing *but* denylisted roles —
  // SUPERUSER, MDMS_ADMIN, LOC_ADMIN and EMPLOYEE is a complete, real role set
  // under multi-root-tenant, and answering "what am I here to do" with nothing
  // is worse than answering it with platform roles.
  //
  // A floor rather than no filter, though: pgr's `tenantRoles` keeps every role
  // stamped for the tenant, CITIZEN included, so an account carrying
  // [EMPLOYEE, CITIZEN] reaches here with `roleContexts: [CITIZEN]` already
  // discarded by `isAssignedContext`. Falling back to the raw list would put a
  // "Citizen" chip in the panel two lines after this file argues that CITIZEN
  // is not an employee assignment. Keep the two we are certain about out.
  return roles.filter(isNeverAnAssignment).map((r) => roleLabel(t, r)).filter(Boolean);
};

/** "3 departments" / "1 department" — the count is the point, not the list. */
const countLabel = (t, n, singularKey, pluralKey, singular, plural) =>
  `${n} ${n === 1 ? label(t, singularKey, singular) : label(t, pluralKey, plural)}`;

/**
 * Boundaries are localized per hierarchy — `ADMIN_<BOUNDARY>` for the ADMIN
 * hierarchy, and the same shape for others. Falls back to the raw code, which
 * is also the safety net for the seeded records that carry a tenant code in
 * `boundary` instead of a real boundary.
 */
/**
 * City name for the tenant the *context* belongs to. cityDetails describes
 * whichever city the header's ChangeCity control currently shows, which for a
 * state-level employee need not be that tenant — using it blindly would label
 * City A's departments and jurisdictions with City B's name.
 */
const cityLabel = (t, cityDetails, tenantId) => {
  if (cityDetails?.code && tenantId && cityDetails.code !== tenantId) return tenantId;
  return label(t, cityDetails?.i18nKey, tenantId);
};

const jurisdictionLabel = (t, j, cityDetails, tenantId) => {
  const hierarchy = String(j?.hierarchy || "").toUpperCase();
  const boundary = j?.boundary;
  if (!boundary) return null;
  // HRMS stores a city-wide jurisdiction as the tenant code itself rather than
  // a boundary code (the same records BoundaryComponent filters out of the
  // cascade). Rendering it raw shows an operator "pg.citest" as if it were a
  // place; show the city they are already looking at instead.
  if (boundary === tenantId) return cityLabel(t, cityDetails, tenantId);
  return label(t, `${hierarchy}_${String(boundary).toUpperCase()}`, boundary);
};

export function EmployeeWorkingContextSummary({ t, context, cityDetails, tenantId, isError }) {
  if (isError) {
    return (
      <div className="digit-working-context-summary digit-working-context-error">
        {label(t, "CS_WORKING_CONTEXT_UNAVAILABLE", "Working context unavailable")}
      </div>
    );
  }
  if (!context) return null;

  const city = cityLabel(t, cityDetails, context.tenantId || tenantId);
  const departments = (context.departments || []).map((d) => departmentLabel(t, d)).filter(Boolean);
  const roles = assignedRoleLabels(t, context);

  // Counts, not names (#2038). Listing "Lands, Housing & Urban Planning +7"
  // spent the whole bar on one of eight departments and still told you
  // nothing; the count says how much there is, and the panel has the detail.
  const parts = [];
  if (departments.length) {
    parts.push(
      countLabel(t, departments.length, "CS_WORKING_CONTEXT_DEPARTMENT_ONE", "CS_WORKING_CONTEXT_DEPARTMENT_MANY", "department", "departments")
    );
  }
  if (roles.length) {
    parts.push(countLabel(t, roles.length, "CS_WORKING_CONTEXT_ROLE_ONE", "CS_WORKING_CONTEXT_ROLE_MANY", "role", "roles"));
  }
  if (!city && !parts.length) return null;

  return (
    <div className="digit-working-context-summary" title={[city, ...parts].filter(Boolean).join(" · ")}>
      {city && <span className="digit-working-context-place">{city}</span>}
      {parts.map((part, i) => (
        <React.Fragment key={i}>
          {/* `city` is legitimately falsy when cityDetails carries no i18nKey
              and neither tenantId is set — the case cityLabel's fallback chain
              is written to tolerate. Without this guard the pill opened with a
              stray "· 8 departments". */}
          {(i > 0 || city) && <span className="digit-working-context-sep">·</span>}
          <span className="digit-working-context-count">{part}</span>
        </React.Fragment>
      ))}
    </div>
  );
}

/** A labelled row of chips. Renders nothing when the list is empty. */
function ChipGroup({ title, values, chipClassName }) {
  if (!values?.length) return null;
  return (
    <div className="digit-working-context-group">
      <div className="digit-working-context-group-label">{title}</div>
      <div className="digit-working-context-grouprow">
        {values.map((v, i) => (
          <span className={`digit-working-context-chip ${chipClassName || ""}`} key={i}>
            {v}
          </span>
        ))}
      </div>
    </div>
  );
}

export function EmployeeWorkingContextPanel({ t, context, cityDetails, tenantId, onDismiss, anchorRef, id }) {
  const ref = useRef(null);
  // The header's own .digit-header-action-fields container is overflow:hidden
  // and 32px tall, so an absolutely-positioned panel is clipped to nothing.
  // Position fixed against the trigger instead — that way no ancestor's
  // overflow or stacking context can hide it, and the shared header container
  // (which the city and language controls also live in) is left alone.
  const [pos, setPos] = useState(null);

  // Layout effect: position before the browser paints, so the panel never
  // shows a frame in the wrong place.
  useLayoutEffect(() => {
    const place = () => {
      const a = anchorRef?.current;
      if (!a) return;
      const r = a.getBoundingClientRect();
      // Prefer right-aligning to the trigger; clamp so it never leaves the
      // viewport. Narrow phones get the full width minus a gutter.
      const width = Math.min(272, window.innerWidth - 16);
      // Right-align under a compact header trigger; centre in the viewport when
      // the trigger spans the bar (the mobile row), where aligning to either
      // edge strands it in a corner. Clamped so it never leaves the viewport.
      const preferred = r.width > width ? (window.innerWidth - width) / 2 : r.right - width;
      const left = Math.max(8, Math.min(preferred, window.innerWidth - width - 8));
      const next = { top: Math.round(r.bottom + 8), left: Math.round(left) };
      // The settle pass below runs several times; only re-render on a real move.
      setPos((prev) => (prev && prev.top === next.top && prev.left === next.left ? prev : next));
    };
    place();
    // The header is still settling when the panel mounts (web fonts, the city
    // and language controls resolving their labels), so a single measurement
    // anchors the panel to where the trigger *was*. Re-measure on the next
    // frame and whenever the trigger's box actually changes.
    const raf = requestAnimationFrame(place);
    let ro;
    if (typeof ResizeObserver !== "undefined" && anchorRef?.current) {
      ro = new ResizeObserver(place);
      // Watch the row as well as the trigger: the trigger often *moves* rather
      // than resizes when the sibling city/language labels resolve, and a
      // ResizeObserver on the trigger alone never fires for that.
      ro.observe(anchorRef.current);
      const row = anchorRef.current.closest(".digit-header-action-fields") || anchorRef.current.parentElement;
      if (row) ro.observe(row);
    }
    // Bounded catch-all for anything neither observer sees (late web fonts).
    let ticks = 0;
    const settle = setInterval(() => {
      place();
      if (++ticks >= 6) clearInterval(settle);
    }, 100);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(settle);
      ro?.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [anchorRef]);

  useEffect(() => {
    const onDocClick = (e) => {
      // The trigger toggles itself; dismissing here too would fight it.
      if (anchorRef?.current?.contains(e.target)) return;
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
  }, [onDismiss, anchorRef]);

  const rows = useMemo(() => {
    if (!context) return null;
    return {
      city: cityLabel(t, cityDetails, context.tenantId || tenantId),
      departments: (context.departments || []).map((d) => departmentLabel(t, d)).filter(Boolean),
      // Same list the pill counts — see assignedRoleLabels (#2038).
      roles: assignedRoleLabels(t, context),
      jurisdictions: (context.jurisdictions || [])
        .map((j) => ({ name: jurisdictionLabel(t, j, cityDetails, context.tenantId || tenantId), type: j?.boundaryType }))
        .filter((j) => j.name),
    };
  }, [t, context, cityDetails, tenantId]);

  if (!rows) return null;

  return (
    <div
      className="digit-working-context-panel"
      ref={ref}
      id={id}
      // A disclosure, not a dialog: it is read-only, has no close control and
      // does not trap or restore focus. role="dialog" would promise all three
      // to assistive tech and deliver none, so the trigger's aria-expanded +
      // aria-controls describes the relationship honestly instead.
      role="group"
      aria-label={label(t, "CS_WORKING_CONTEXT", "Working context")}
      // Always fixed, even before the first measurement: without it the panel
      // is briefly a normal in-flow child of the 32px, overflow:hidden action
      // row and blows the header out for a frame.
      style={pos ? { position: "fixed", top: pos.top, left: pos.left } : { position: "fixed", visibility: "hidden" }}
    >
      {/* The place this person works, as the panel's own heading — the pill
          only carries counts, so the panel is where the name belongs. */}
      <div className="digit-working-context-place-block">
        <div className="digit-working-context-group-label">
          {label(t, "CS_WORKING_CONTEXT_CITY", "City")}
        </div>
        <div className="digit-working-context-place-name">{rows.city}</div>
        <div className="digit-working-context-subtitle">
          {label(t, "CS_WORKING_CONTEXT_SUBTITLE", "These are your assignments")}
        </div>
      </div>

      <ChipGroup
        title={label(t, "CS_WORKING_CONTEXT_DEPARTMENT", "Departments")}
        values={rows.departments}
      />

      <ChipGroup
        title={label(t, "CS_WORKING_CONTEXT_ROLE", "Roles")}
        values={rows.roles}
      />

      <ChipGroup
        title={label(t, "CS_WORKING_CONTEXT_JURISDICTION", "Jurisdiction")}
        values={rows.jurisdictions.map((j) => (j.type ? `${j.name} (${j.type})` : j.name))}
      />
    </div>
  );
}

/** Summary + click-to-expand panel, for the desktop header. */
let panelSeq = 0;

export function EmployeeWorkingContext({ t, context, cityDetails, tenantId, isError }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef(null);
  // Stable id so aria-controls points somewhere real; two instances can be
  // mounted at once (header + mobile row) so it cannot be a constant.
  const panelIdRef = useRef(null);
  if (panelIdRef.current === null) panelIdRef.current = `digit-working-context-panel-${++panelSeq}`;

  if (isError) {
    // Wrapped in .digit-working-context like every other render of this component, NOT returned
    // bare. Both copies (header + mobile row) mount on the failure path too, and the max-width
    // 640px rules that hide the header copy are keyed on .digit-working-context — a bare summary
    // matches neither the hide rule nor the :has() wrapper-collapse rule, so after a
    // desktop-to-mobile resize the header error and the sticky-row error would both render. That
    // is also the state on any deployment where the employee-context route is not live yet.
    return (
      <div className="digit-working-context">
        <EmployeeWorkingContextSummary t={t} isError context={null} />
      </div>
    );
  }
  if (!context) return null;

  return (
    <div className="digit-working-context">
      <button
        type="button"
        ref={triggerRef}
        className="digit-working-context-trigger"
        aria-expanded={open}
        aria-controls={panelIdRef.current}
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
          anchorRef={triggerRef}
          id={panelIdRef.current}
          onDismiss={() => setOpen(false)}
        />
      )}
    </div>
  );
}

export default EmployeeWorkingContext;
