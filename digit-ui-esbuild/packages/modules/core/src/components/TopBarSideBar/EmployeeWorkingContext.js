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
const roleContextLabel = (t, ctx) => label(t, `${ROLE_CONTEXT_KEY}${ctx}`, ctx);

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
        {label(t, "CS_WORKING_CONTEXT_UNAVAILABLE", "Working context unavailable")}
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

  // The header truncates when space is tight, so carry the full value in a
  // tooltip; the expanded panel has it in full either way.
  const plain = [city, ...departments, ...roleContexts].filter(Boolean).join(" · ");

  return (
    <div className="digit-working-context-summary" title={plain}>
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
      roleContexts: (context.roleContexts || []).map((c) => roleContextLabel(t, c)).filter(Boolean),
      roles: (context.roles || []).map((r) => roleLabel(t, r)).filter(Boolean),
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
      <Group title={label(t, "CS_WORKING_CONTEXT_CITY", "City")}>{rows.city}</Group>

      <Group title={label(t, "CS_WORKING_CONTEXT_DEPARTMENT", "Department")}>
        {rows.departments.length
          ? rows.departments.map((d, i) => <div key={i}>{d}</div>)
          : null}
      </Group>

      <Group title={label(t, "CS_WORKING_CONTEXT_ROLE", "Role")}>
        {rows.roleContexts.length || rows.roles.length ? (
          <React.Fragment>
            {rows.roleContexts.map((c, i) => (
              <div key={`c${i}`}>{c}</div>
            ))}
            {rows.roles.length ? <div className="digit-working-context-raw-roles">{rows.roles.join(", ")}</div> : null}
          </React.Fragment>
        ) : null}
      </Group>

      <Group title={label(t, "CS_WORKING_CONTEXT_JURISDICTION", "Jurisdiction")}>
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
let panelSeq = 0;

export function EmployeeWorkingContext({ t, context, cityDetails, tenantId, isError }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef(null);
  // Stable id so aria-controls points somewhere real; two instances can be
  // mounted at once (header + mobile row) so it cannot be a constant.
  const panelIdRef = useRef(null);
  if (panelIdRef.current === null) panelIdRef.current = `digit-working-context-panel-${++panelSeq}`;

  if (isError) {
    return <EmployeeWorkingContextSummary t={t} isError context={null} />;
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
