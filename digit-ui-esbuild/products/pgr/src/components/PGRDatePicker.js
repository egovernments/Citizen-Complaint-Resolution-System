import React from "react";

/**
 * PGRDatePicker — self-contained calendar-popover date picker for FormComposerV2
 * (rendered via a `type: "component"` field). Avoids the native <input type="date">
 * and the library's react-datepicker (both broken by vendored CSS).
 *
 * Styling deliberately uses the DIGIT theme tokens (--color-border, Roboto /
 * --color-text-heading, --color-primary-main) + the inputs' max-width (37.5rem),
 * and the clickable cells are <div>s (NOT <button>s) so they don't inherit the
 * app's global button styling. No drop-shadow. Mobile-safe (full width + the
 * popover caps to the viewport). Reads/writes a "YYYY-MM-DD" string via setValue.
 */

const PRIMARY = "var(--color-primary-main, var(--color-primary-1, #c84c0e))";
const BORDER = "var(--color-border, #d6d5d4)";
const TEXT = "var(--color-text-heading, #363636)";
const MUTED = "#6b7280";
const FONT = "Roboto, sans-serif";

// :focus styling can't be done via inline styles. Match the DIGIT inputs: a
// primary-coloured border on focus, with NO browser outline ring and NO shadow.
const FOCUS_CSS = `
.pgr-datepicker-field,
.pgr-datepicker-pop,
.pgr-datepicker-pop [role="button"] { box-shadow: none !important; }
.pgr-datepicker-field:hover { border-color: #0b0c0c !important; }
.pgr-datepicker-field:focus,
.pgr-datepicker-field:focus-visible {
  outline: none !important;
  box-shadow: none !important;
  border-color: var(--color-primary-main, var(--color-primary-1, #c84c0e)) !important;
}
.pgr-datepicker-pop [role="button"]:focus,
.pgr-datepicker-pop [role="button"]:focus-visible { outline: none; background: #e5e7eb; }
.pgr-datepicker-pop [role="button"]:hover { background: #f3f4f6; }
`;

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MON_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const pad = (n) => String(n).padStart(2, "0");
const parseDate = (v) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v || "");
  return m ? { y: +m[1], mo: +m[2], d: +m[3] } : null;
};
const fmtDisplay = (v) => {
  const p = parseDate(v);
  return p ? `${pad(p.d)} ${MON_ABBR[p.mo - 1]} ${p.y}` : "";
};

const CalendarIcon = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#505A5F" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
    <line x1="16" y1="2" x2="16" y2="6" />
    <line x1="8" y1="2" x2="8" y2="6" />
    <line x1="3" y1="10" x2="21" y2="10" />
  </svg>
);

const PGRDatePicker = (props) => {
  const setValue = props?.setValue || props?.onSelect;
  const config = props?.config || {};
  const name = config?.populators?.name || config?.key || props?.props?.populators?.name;
  const placeholder = config?.populators?.placeholder || "";
  const disabled = !!(props?.disabled || props?.props?.disable);
  const formData = props?.formData || props?.data || {};

  const watched = typeof props?.watch === "function" && name ? props.watch(name) : undefined;
  const value = typeof watched === "string" ? watched : typeof formData?.[name] === "string" ? formData[name] : "";
  const selected = parseDate(value);

  const today = new Date();
  const [open, setOpen] = React.useState(false);
  const [view, setView] = React.useState(() =>
    selected ? { y: selected.y, mo: selected.mo } : { y: today.getFullYear(), mo: today.getMonth() + 1 }
  );
  // Optional upper bound (CCSD-1952): populators.maxDate === "today" caps
  // selection at the current date — used by "Date of fact"-style extended
  // attributes, where a future date is meaningless. Future cells render
  // greyed-out and unclickable; month navigation stays free.
  const maxDate =
    (config?.populators?.maxDate || props?.props?.populators?.maxDate) === "today" ? today : null;
  const isAfterMax = (d) => {
    if (!maxDate) return false;
    const cell = new Date(view.y, view.mo - 1, d);
    const cap = new Date(maxDate.getFullYear(), maxDate.getMonth(), maxDate.getDate());
    return cell.getTime() > cap.getTime();
  };
  const ref = React.useRef(null);

  React.useEffect(() => {
    if (!open) return undefined;
    const onDocClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const toggle = () => {
    if (disabled) return;
    if (!open && selected) setView({ y: selected.y, mo: selected.mo });
    setOpen((o) => !o);
  };
  const prevMonth = () => setView((v) => (v.mo === 1 ? { y: v.y - 1, mo: 12 } : { y: v.y, mo: v.mo - 1 }));
  const nextMonth = () => setView((v) => (v.mo === 12 ? { y: v.y + 1, mo: 1 } : { y: v.y, mo: v.mo + 1 }));
  const pick = (d) => {
    if (!d || !setValue || !name) return;
    if (isAfterMax(d)) return; // future date blocked (CCSD-1952)
    setValue(name, `${view.y}-${pad(view.mo)}-${pad(d)}`);
    setOpen(false);
  };
  const keyActivate = (fn) => (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      fn();
    }
  };

  const firstDow = new Date(view.y, view.mo - 1, 1).getDay();
  const daysInMonth = new Date(view.y, view.mo, 0).getDate();
  const cells = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const isSel = (d) => selected && selected.y === view.y && selected.mo === view.mo && selected.d === d;
  const isToday = (d) => today.getFullYear() === view.y && today.getMonth() + 1 === view.mo && today.getDate() === d;

  const s = {
    wrap: { position: "relative", width: "100%", maxWidth: "37.5rem", fontFamily: FONT },
    field: {
      display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem",
      height: "2.5rem", padding: "0 0.75rem", border: `0.5px solid ${BORDER}`, borderRadius: "4px",
      background: disabled ? "#f3f4f6" : "#fff", cursor: disabled ? "not-allowed" : "pointer",
      fontFamily: FONT, fontSize: "1rem", color: value ? TEXT : MUTED, userSelect: "none",
      boxSizing: "border-box", width: "100%",
    },
    pop: {
      position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 9999,
      background: "#fff", border: `0.5px solid ${BORDER}`, borderRadius: "4px",
      padding: "0.5rem", width: "17.5rem", maxWidth: "calc(100vw - 2rem)", boxSizing: "border-box",
      fontFamily: FONT,
    },
    head: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.25rem" },
    nav: { cursor: "pointer", fontSize: "1.25rem", lineHeight: 1, padding: "0.1rem 0.6rem", color: TEXT, borderRadius: "4px", userSelect: "none" },
    monthLabel: { fontWeight: 600, fontSize: "0.9rem", color: TEXT },
    grid: { display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: "2px" },
    wk: { textAlign: "center", fontSize: "0.7rem", color: MUTED, padding: "0.25rem 0", fontWeight: 600 },
    cell: {
      textAlign: "center", padding: "0.4rem 0", borderRadius: "4px", fontSize: "0.85rem",
      cursor: "pointer", color: TEXT, userSelect: "none", border: "1px solid transparent", boxSizing: "border-box",
    },
  };

  return (
    <div className="pgr-datepicker" style={s.wrap} ref={ref}>
      <style>{FOCUS_CSS}</style>
      <div
        className="pgr-datepicker-field"
        style={s.field}
        onClick={toggle}
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-haspopup="dialog"
        aria-expanded={open}
        onKeyDown={keyActivate(toggle)}
      >
        <span>{value ? fmtDisplay(value) : placeholder}</span>
        <span style={{ display: "inline-flex" }}>{CalendarIcon}</span>
      </div>

      {open ? (
        <div className="pgr-datepicker-pop" style={s.pop} role="dialog">
          <div style={s.head}>
            <div role="button" tabIndex={0} style={s.nav} onClick={prevMonth} onKeyDown={keyActivate(prevMonth)} aria-label="Previous month">‹</div>
            <div style={s.monthLabel}>{MONTHS[view.mo - 1]} {view.y}</div>
            <div role="button" tabIndex={0} style={s.nav} onClick={nextMonth} onKeyDown={keyActivate(nextMonth)} aria-label="Next month">›</div>
          </div>
          <div style={s.grid}>
            {WEEKDAYS.map((w) => (
              <div key={w} style={s.wk}>{w}</div>
            ))}
            {cells.map((d, i) =>
              d === null ? (
                <div key={`e${i}`} />
              ) : (
                <div
                  key={d}
                  role="button"
                  tabIndex={isAfterMax(d) ? -1 : 0}
                  aria-disabled={isAfterMax(d) || undefined}
                  onClick={() => pick(d)}
                  onKeyDown={keyActivate(() => pick(d))}
                  style={{
                    ...s.cell,
                    ...(isSel(d) ? { background: PRIMARY, color: "#fff", fontWeight: 700, borderColor: PRIMARY } : {}),
                    ...(!isSel(d) && isToday(d) ? { borderColor: PRIMARY } : {}),
                    ...(isAfterMax(d) ? { color: "#c3c7cc", cursor: "not-allowed", background: "transparent" } : {}),
                  }}
                >
                  {d}
                </div>
              )
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default PGRDatePicker;
