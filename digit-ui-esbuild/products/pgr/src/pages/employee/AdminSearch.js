import React, { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Redirect, Link, useHistory } from "react-router-dom";
import { useQuery } from "react-query";
import { Request } from "@egovernments/digit-ui-libraries";
import { Loader } from "@egovernments/digit-ui-components";
import { DateRange as RangeCalendar } from "react-date-range"; // same lib the inbox date filter uses; .rdr* styles ship in digit-ui-css
import { pt as dfnsPt, enGB as dfnsEnGB } from "date-fns/locale";
import Urls from "../../utils/urls";
import { complaintLabel } from "../../utils/complaintLabel";

/**
 * PGRAdminSearch — cross-department complaint search (SUPERUSER + CMS_ADMIN)
 * (/employee/pgr/admin-search), custom UI replicating the approved design:
 * tenant banner top-right; single-row filter bar (complaint no with search/#
 * adornments, department multi-select with in-field chips capped at 3 + "+N"
 * overflow and a "No department (N/A)" sentinel, single range-calendar date
 * field, Search/Clear inline); results card ("N Complaints Found" + freshness
 * dot, sort + Excel export via Digit.Download.Excel, sortable columns, tinted
 * department tags, dot-status pills, stacked date/time cells, click-anywhere
 * rows, «‹1›» pagination with rows-per-page). Brand colors flow through the
 * theme token chain; the fixed hexes below are semantic status/tag tints only.
 *
 * Backend: POST /pgr-services/v2/request/_admin/_search (PR #1260).
 * totalCount workaround: the current backend echoes the page size as
 * totalCount (reported on #1260), so we over-fetch by one row per page to
 * know whether a next page exists; the count renders as "N+" until the last
 * page (or a fixed backend) makes it exact.
 *
 * Sorting: complaint no / status / created / last-modified sort server-side
 * (AdminSearchCriteria sortBy); department / complaint type sort the CURRENT
 * PAGE client-side (labels are derived FE-side, the backend can't order them).
 */

const PAGE_SIZES = [10, 20, 50];
const EXPORT_MAX_ROWS = 500;
const SERVER_SORT_COLS = ["serviceRequestId", "applicationStatus", "createdTime", "lastModifiedTime"];

// applicationStatus -> pill bucket (standard PGR + CMS workflows).
// Semantics follow the citizen My Complaints pills: rejected-family = error
// red, resolved-family = success green, freshly-opened = warning amber.
const STATUS_BUCKET = {
  PENDINGFORASSIGNMENT: "open",
  NEW: "open",
  PENDINGATLME: "assigned",
  PENDINGATSUPERVISOR: "assigned",
  PENDINGFORREASSIGNMENT: "inprogress",
  IN_TRIAGE: "inprogress",
  INTRIAGE: "inprogress",
  REFERRED: "inprogress",
  INVESTIGATION: "inprogress",
  UNDER_INVESTIGATION: "inprogress",
  AWAITINGINFORMATION: "inprogress",
  INFOFROMCITIZEN: "inprogress",
  RESOLVED: "resolved",
  RESOLVEDBYSUPERVISOR: "resolved",
  CLOSEDAFTERRESOLUTION: "resolved",
  REJECTED: "rejected",
  CLOSEDAFTERREJECTION: "rejected",
  CANCELLED: "rejected",
  CLOSED: "closed",
};
const bucketOf = (status) => STATUS_BUCKET[String(status || "").toUpperCase()] || "inprogress";

// department tags: ONE calm tint for every department (per review — the
// per-code color cycling read as noise); grey only for "Not Assigned".
const DEPT_TINT = { bg: "#e3f2fd", fg: "#1565c0" };
const NA_TINT = { bg: "#eceff1", fg: "#455a64" };
const deptTint = (code) => (!code || code === "NA" ? NA_TINT : DEPT_TINT);

const SORT_OPTIONS = [
  { code: "createdTime", i18nKey: "ES_PGR_ADMIN_CREATED_TIME", fb: "Created Time" },
  { code: "lastModifiedTime", i18nKey: "ES_PGR_ADMIN_LAST_MODIFIED", fb: "Last Modified" },
  { code: "serviceRequestId", i18nKey: "CS_COMMON_COMPLAINT_NO", fb: "Complaint No" },
  { code: "applicationStatus", i18nKey: "CS_COMPLAINT_DETAILS_CURRENT_STATUS", fb: "Status" },
];

const STYLE_ID = "pgr-admin-search-css";
const CSS = `
.pgr-adm { padding: 1rem 1.25rem 2rem; background: var(--color-page-bg, transparent); color: var(--color-text-primary,#1f2937); }
.pgr-adm * { box-sizing: border-box; }
.pgr-adm-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; margin-bottom: 1rem; flex-wrap: wrap; }
.pgr-adm-title h1 { margin: 0; font-size: 1.6rem; color: var(--color-text-heading, var(--color-primary-1, var(--color-primary-main,#c84c0e))); }
.pgr-adm-title p { margin: .25rem 0 0; color: var(--color-text-secondary,#64748b); font-size: .9rem; }
.pgr-adm-banner { display: flex; align-items: center; gap: .5rem; background: var(--color-primary-1-bg, var(--color-primary-selected-bg,#f4efe9)); border: 1px solid var(--color-border,#e2e8f0); border-radius: .6rem; padding: .6rem .9rem; font-size: .82rem; color: var(--color-text-primary,#334155); }
.pgr-adm-banner svg { color: var(--color-primary-1, var(--color-primary-main,#c84c0e)); flex: none; }
.pgr-adm-banner b { color: var(--color-primary-1, var(--color-primary-main,#c84c0e)); }
.pgr-adm-card { background: var(--color-surface,#fff); border: 1px solid var(--color-card-border, var(--color-border,#e2e8f0)); border-radius: .75rem; margin-bottom: 1rem; }
.pgr-adm-frow { display: grid; grid-template-columns: minmax(190px,1fr) minmax(250px,1.5fr) minmax(260px,1.2fr) auto; gap: 1rem; padding: .9rem 1rem; align-items: end; }
@media (max-width: 1200px) { .pgr-adm-frow { grid-template-columns: 1fr 1fr; } }
@media (max-width: 760px) { .pgr-adm-frow { grid-template-columns: 1fr; } }
.pgr-adm-frow > * { min-width: 0; }
@media (max-width: 640px) {
  .pgr-adm { padding: .75rem .75rem 1.5rem; }
  .pgr-adm-top { flex-direction: column; align-items: stretch; }
  .pgr-adm-fbtns { width: 100%; }
  .pgr-adm-fbtns .pgr-adm-btn { flex: 1; justify-content: center; }
  .pgr-adm-results-head { flex-direction: column; align-items: stretch; }
  .pgr-adm-table th, .pgr-adm-table td { padding: .55rem .6rem; }
  .pgr-adm-foot { justify-content: center; }
  .pgr-adm-rdr { left: 0; right: auto; max-width: calc(100vw - 2.5rem); overflow-x: auto; }
}
.pgr-adm-field > label { display: block; font-size: .8rem; font-weight: 600; margin-bottom: .3rem; }
/* icon + input as flex SIBLINGS inside a bordered wrapper — the platform's global input rules
   override padding on inputs, so absolutely-positioned icons would overlap the text */
.pgr-adm-cno { display: flex; align-items: center; gap: .45rem; min-height: 44px; padding: 0 .6rem; border: 1px solid var(--color-input-border-default, var(--color-border,#cbd5e1)); border-radius: .5rem; background: #fff; }
.pgr-adm-cno input { flex: 1; min-width: 0; border: none !important; outline: none !important; box-shadow: none !important; background: transparent; font-size: .85rem; padding: .5rem 0; min-height: 0; }
.pgr-adm-cno .mag { color: var(--color-text-secondary,#94a3b8); display: inline-flex; flex: none; }
.pgr-adm-cno .hash { color: var(--color-text-secondary,#94a3b8); font-size: .9rem; flex: none; }
.pgr-adm-cno:focus-within, .pgr-adm-msd-field:focus-within, .pgr-adm-date:focus-within { outline: none; border-color: var(--color-input-border-focus, var(--color-primary-1,#c84c0e)); }
.pgr-adm-msd { position: relative; }
.pgr-adm-msd-field { min-height: 44px; width: 100%; display: flex; flex-wrap: nowrap; align-items: center; gap: .35rem; padding: .3rem 2rem .3rem .5rem; border: 1px solid var(--color-input-border-default, var(--color-border,#cbd5e1)); border-radius: .5rem; background: #fff; cursor: pointer; position: relative; overflow: hidden; }
.pgr-adm-msd-field .ph { color: var(--color-text-secondary,#94a3b8); font-size: .85rem; padding-left: .1rem; }
.pgr-adm-msd-field .caret { position: absolute; right: .6rem; top: 50%; transform: translateY(-50%); color: var(--color-text-secondary,#64748b); font-size: .75rem; }
.pgr-adm-tag { display: inline-flex; align-items: center; gap: .35rem; background: var(--color-surface-secondary,#f1f5f9); border: 1px solid var(--color-border,#e2e8f0); border-radius: .4rem; padding: .18rem .5rem; font-size: .78rem; line-height: 1.25; color: var(--color-text-primary,#334155); white-space: nowrap; max-width: 100%; flex: none; }
.pgr-adm-tag i { overflow: hidden; text-overflow: ellipsis; font-style: normal; max-width: 130px; }
/* a span, not a <button>: the platform's global button rules (primary bg, 10px 28px padding) can't be out-specified from here */
.pgr-adm-tag .x { cursor: pointer; color: var(--color-text-secondary,#64748b); font-size: .85rem; line-height: 1; padding: 0 .1rem; user-select: none; }
.pgr-adm-tag .x:hover { color: var(--color-error,#b3261e); }
.pgr-adm-msd-search { display: flex; align-items: center; gap: .4rem; padding: .4rem .6rem; border-bottom: 1px solid var(--color-border,#eef2f7); position: sticky; top: 0; background: #fff; color: var(--color-text-secondary,#94a3b8); }
.pgr-adm-msd-search input { flex: 1; min-width: 0; font-size: .82rem; }
.pgr-adm-recent { position: absolute; z-index: 30; top: calc(100% + 4px); left: 0; right: 0; background: #fff; border: 1px solid var(--color-border,#cbd5e1); border-radius: .5rem; box-shadow: 0 8px 20px rgba(0,0,0,.12); padding: .25rem 0; }
.pgr-adm-recent .hd { font-size: .68rem; font-weight: 700; text-transform: uppercase; letter-spacing: .03em; color: var(--color-text-secondary,#94a3b8); padding: .3rem .6rem .15rem; }
.pgr-adm-recent .it { display: flex; align-items: center; gap: .45rem; padding: .4rem .6rem; font-size: .84rem; cursor: pointer; }
.pgr-adm-recent .it:hover { background: var(--color-surface-secondary,#f1f5f9); }
.pgr-adm-recent .it svg { color: var(--color-text-secondary,#94a3b8); flex: none; }
.pgr-adm-msd-list { position: absolute; z-index: 30; top: calc(100% + 4px); left: 0; right: 0; max-height: 260px; overflow: auto; background: #fff; border: 1px solid var(--color-border,#cbd5e1); border-radius: .5rem; box-shadow: 0 8px 20px rgba(0,0,0,.12); padding: .25rem 0; }
.pgr-adm-msd-opt { display: flex; gap: .5rem; align-items: center; padding: .4rem .6rem; font-size: .85rem; cursor: pointer; }
.pgr-adm-msd-opt:hover { background: var(--color-surface-secondary,#f1f5f9); }
.pgr-adm-daterange { position: relative; }
.pgr-adm-date { display: flex; align-items: center; gap: .45rem; min-height: 44px; padding: 0 2rem 0 .6rem; border: 1px solid var(--color-input-border-default, var(--color-border,#cbd5e1)); border-radius: .5rem; background: #fff; cursor: pointer; position: relative; }
.pgr-adm-date > svg { flex: none; color: var(--color-text-secondary,#94a3b8); pointer-events: none; }
.pgr-adm-date .val { flex: 1; min-width: 0; font-size: .82rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pgr-adm-date .val.ph { color: var(--color-text-secondary,#94a3b8); }
.pgr-adm-date .caret { position: absolute; right: .6rem; top: 50%; transform: translateY(-50%); color: var(--color-text-secondary,#64748b); font-size: .75rem; }
.pgr-adm-rdr { position: absolute; z-index: 40; top: calc(100% + 4px); right: 0; background: #fff; border: 1px solid var(--color-border,#cbd5e1); border-radius: .6rem; box-shadow: 0 10px 24px rgba(0,0,0,.14); overflow: hidden; }
.pgr-adm-rdr .rdrCalendarWrapper { font-size: 10px; }
.pgr-adm-rdr .rdrMonth { width: 24em; }
.pgr-adm-rdr .rdrMonthAndYearWrapper { padding-top: 2px; height: 46px; }
.pgr-adm-fbtns { display: flex; gap: .6rem; }
.pgr-adm-fbtns .pgr-adm-btn { min-height: 44px; padding: .6rem 1.5rem; font-size: .9rem; }
.pgr-adm-err { color: var(--color-error,#b3261e); font-size: .78rem; padding: 0 1rem .75rem; }
.pgr-adm-btn { display: inline-flex; align-items: center; gap: .45rem; padding: .55rem 1.1rem; border-radius: .5rem; font-weight: 700; font-size: .85rem; cursor: pointer; border: 1px solid transparent; white-space: nowrap; }
.pgr-adm-btn--primary { background: var(--color-button-primary-bg-default, var(--color-primary-1, var(--color-primary-main,#c84c0e))); color: #fff; }
.pgr-adm-btn--primary:hover { background: var(--color-button-primary-bg-hover, var(--color-primary-1,#a33d0b)); }
.pgr-adm-btn--ghost { background: #fff; border-color: var(--color-border,#cbd5e1); color: var(--color-text-primary,#334155); }
.pgr-adm-btn--ghost:hover { background: var(--color-surface-secondary,#f8fafc); }
.pgr-adm-btn[disabled] { opacity: .55; cursor: default; }
.pgr-adm-results { padding: 0; overflow: hidden; margin-bottom: 0; }
.pgr-adm-results-head { display: flex; align-items: center; justify-content: space-between; gap: .75rem; padding: .85rem 1rem; border-bottom: 1px solid var(--color-border,#eef2f7); flex-wrap: wrap; }
.pgr-adm-found { display: flex; align-items: baseline; gap: .9rem; flex-wrap: wrap; }
.pgr-adm-found h2 { margin: 0; font-size: 1.05rem; }
.pgr-adm-updated { display: inline-flex; align-items: center; gap: .35rem; font-size: .78rem; color: var(--color-text-secondary,#64748b); }
.pgr-adm-updated::before { content: ""; width: 7px; height: 7px; border-radius: 9999px; background: #2e7d32; }
.pgr-adm-sort { display: flex; align-items: center; gap: .4rem; font-size: .8rem; color: var(--color-text-secondary,#64748b); flex-wrap: wrap; }
.pgr-adm-sel { appearance: none; -webkit-appearance: none; -moz-appearance: none; padding: .45rem 2rem .45rem .7rem; border: 1px solid var(--color-border,#cbd5e1); border-radius: .5rem; background: #fff url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'><polyline points='6 9 12 15 18 9'/></svg>") no-repeat right .6rem center / 11px; font-size: .8rem; color: inherit; cursor: pointer; }
.pgr-adm-sort .pgr-adm-sel { min-height: 40px; }
.pgr-adm-sort .pgr-adm-btn { min-height: 40px; }
.pgr-adm-table { width: 100%; border-collapse: collapse; }
.pgr-adm-table th { text-align: left; font-size: .78rem; font-weight: 600; color: var(--color-text-primary,#334155); padding: .65rem 1rem; background: var(--color-surface-secondary,#f8fafc); border-bottom: 1px solid var(--color-border,#eef2f7); white-space: nowrap; }
.pgr-adm-th-sort { cursor: pointer; user-select: none; }
.pgr-adm-th-sort .si { color: var(--color-text-secondary,#94a3b8); font-size: .72rem; margin-left: .2rem; }
.pgr-adm-th-sort .si.act { color: var(--color-primary-1, var(--color-primary-main,#c84c0e)); }
.pgr-adm-table td { padding: .7rem 1rem; border-bottom: 1px solid var(--color-border,#f1f5f9); font-size: .84rem; vertical-align: middle; }
.pgr-adm-table tbody tr { cursor: pointer; }
.pgr-adm-table tbody tr:hover { background: var(--color-surface-secondary,#fafbfc); }
.pgr-adm-cno-link { display: inline-flex; align-items: center; gap: .3rem; color: var(--color-text-primary,#1f2937); font-weight: 700; text-decoration: underline; }
.pgr-adm-cno-link:hover { color: var(--color-link-hover, var(--color-primary-1, var(--color-primary-main,#c84c0e))); }
.pgr-adm-deptag { display: inline-flex; align-items: center; gap: .35rem; border-radius: .4rem; padding: .2rem .55rem; font-size: .76rem; font-weight: 600; white-space: nowrap; }
.pgr-adm-deptag i { font-style: normal; }
.pgr-adm-pill { display: inline-flex; align-items: center; gap: .35rem; border-radius: 9999px; padding: .18rem .65rem; font-size: .74rem; font-weight: 700; white-space: nowrap; }
.pgr-adm-pill::before { content: ""; width: 6px; height: 6px; border-radius: 9999px; background: currentColor; flex: none; }
.pgr-adm-pill--open { background: var(--color-primary-selected-bg,#FFF4D7); color: var(--color-warning,#9E5F00); }
.pgr-adm-pill--assigned { background: #e3f2fd; color: #1565c0; }
.pgr-adm-pill--inprogress { background: #e0f2f1; color: #00695c; }
.pgr-adm-pill--resolved { background: var(--color-success-bg,#E8F3EE); color: var(--color-success,#00703C); }
.pgr-adm-pill--rejected { background: var(--color-error-bg,#FAE5E2); color: var(--color-error,#d4351c); }
.pgr-adm-pill--closed { background: #eceff1; color: #455a64; }
.pgr-adm-dt { display: inline-flex; align-items: center; gap: .45rem; white-space: nowrap; }
.pgr-adm-dt svg { color: var(--color-text-secondary,#94a3b8); flex: none; }
.pgr-adm-dt .t { display: block; color: var(--color-text-secondary,#64748b); font-size: .76rem; }
.pgr-adm-empty { padding: 2.25rem 1rem; text-align: center; color: var(--color-text-secondary,#64748b); font-size: .9rem; }
.pgr-adm-foot { display: flex; align-items: center; justify-content: space-between; gap: .75rem; padding: .75rem 1rem; flex-wrap: wrap; }
.pgr-adm-foot .info { font-size: .78rem; color: var(--color-text-secondary,#64748b); }
.pgr-adm-pages { display: flex; align-items: center; gap: .25rem; }
.pgr-adm-page { min-width: 36px; height: 36px; border: 1px solid var(--color-border,#cbd5e1); background: #fff; border-radius: .4rem; cursor: pointer; font-size: .8rem; color: var(--color-text-primary,#334155); }
.pgr-adm-page[disabled] { opacity: .45; cursor: default; }
.pgr-adm-page--active { background: var(--color-button-primary-bg-default, var(--color-primary-1,#c84c0e)); color: #fff; border-color: var(--color-button-primary-bg-default, var(--color-primary-1,#c84c0e)); }
.pgr-adm-pgsize { display: flex; align-items: center; gap: .4rem; font-size: .78rem; color: var(--color-text-secondary,#64748b); }
.pgr-adm-pgsize .pgr-adm-sel { min-height: 36px; }
`;

function injectCss() {
  if (typeof document === "undefined") return;
  const existing = document.getElementById(STYLE_ID);
  if (existing) { if (existing.textContent !== CSS) existing.textContent = CSS; return; }
  const el = document.createElement("style");
  el.id = STYLE_ID;
  el.textContent = CSS;
  document.head.appendChild(el);
}

const Ic = ({ children, size = 15 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable="false">{children}</svg>
);
const IcInfo = () => <Ic size={16}><circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" /></Ic>;
const IcSearch = ({ size = 14 }) => <Ic size={size}><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></Ic>;
const IcClear = () => <Ic size={14}><path d="M1 4v6h6" /><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" /></Ic>;
const IcExport = () => <Ic size={14}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></Ic>;
const IcBuilding = () => <Ic size={12}><rect x="4" y="2" width="16" height="20" rx="1" /><line x1="9" y1="22" x2="9" y2="18" /><line x1="15" y1="22" x2="15" y2="18" /><line x1="8" y1="6" x2="10" y2="6" /><line x1="14" y1="6" x2="16" y2="6" /><line x1="8" y1="10" x2="10" y2="10" /><line x1="14" y1="10" x2="16" y2="10" /><line x1="8" y1="14" x2="10" y2="14" /><line x1="14" y1="14" x2="16" y2="14" /></Ic>;
const IcCal = ({ size = 14 }) => <Ic size={size}><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></Ic>;
const IcClock = () => <Ic size={13}><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></Ic>;

const searchAdmin = (params) =>
  Request({ url: Urls.pgr.adminSearch, method: "POST", auth: true, userService: true, useCache: false, params });

// The platform stylesheet forces input chrome (border/padding/height) with
// !important from a source scoped CSS cannot beat — inline !important is the
// only author style that outranks it in the cascade, hence a ref callback.
const bareInput = (el) => {
  if (!el) return;
  ["border", "outline", "box-shadow"].forEach((p) => el.style.setProperty(p, "none", "important"));
  el.style.setProperty("background", "transparent", "important");
  el.style.setProperty("min-height", "0", "important");
  el.style.setProperty("height", "auto", "important");
  el.style.setProperty("padding", "0.5rem 0", "important");
  el.style.setProperty("margin", "0", "important");
};

// Same cascade problem for <select>s: the platform forces select padding/height,
// clipping the text under the custom chevron — inline !important via ref wins.
const CHEV =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'><polyline points='6 9 12 15 18 9'/></svg>\")";
const selRef = (minW, h) => (el) => {
  if (!el) return;
  const imp = (p, v) => el.style.setProperty(p, v, "important");
  imp("appearance", "none");
  imp("-webkit-appearance", "none");
  imp("-moz-appearance", "none");
  imp("padding", "0.4rem 1.9rem 0.4rem 0.7rem");
  imp("border", "1px solid var(--color-border, #cbd5e1)");
  imp("border-radius", "0.5rem");
  imp("background-color", "#fff");
  imp("background-image", CHEV);
  imp("background-repeat", "no-repeat");
  imp("background-position", "right 0.55rem center");
  imp("background-size", "11px");
  imp("height", h);
  imp("min-height", h);
  imp("min-width", minW);
  imp("width", "auto");
  imp("font-size", "0.8rem");
  imp("line-height", "1.2");
  imp("box-shadow", "none");
  imp("cursor", "pointer");
};

const PGRAdminSearch = () => {
  const { t, i18n } = useTranslation();
  const history = useHistory();
  const tenantId = Digit.ULBService.getCurrentTenantId();
  injectCss();

  const roles = Digit.UserService.getUser()?.info?.roles?.map((r) => r?.code) || [];
  // Roles allowed on this screen (must mirror the PGRCard link roles).
  const ADMIN_SEARCH_ROLES = ["SUPERUSER", "CMS_ADMIN"];
  const isSuperUser = roles.some((r) => ADMIN_SEARCH_ROLES.includes(r));

  const lang = String(i18n?.language || "en").startsWith("pt") ? "pt-PT" : "en-GB";
  const fmtDT = (epoch) => {
    if (!epoch) return { d: "—", t: "" };
    const dt = new Date(Number(epoch));
    const d = dt.toLocaleDateString(lang, { day: "2-digit", month: "short", year: "numeric" });
    const tm = dt
      .toLocaleTimeString(lang, { hour: "2-digit", minute: "2-digit", hour12: lang === "en-GB" })
      .replace(/\b(am|pm)\b/gi, (m) => m.toUpperCase());
    return { d, t: tm };
  };

  // ── departments (options + display-normalisation map) ──────────────────
  const { data: departments, isLoading: deptLoading } = Digit.Hooks.useCustomMDMS(
    tenantId, "common-masters", [{ name: "Department" }],
    { select: (d) => d?.["common-masters"]?.Department || [], enabled: isSuperUser }
  );
  const deptOptions = useMemo(() => {
    const label = (d) => {
      const k = `COMMON_MASTERS_DEPARTMENT_${d.code}`;
      const v = t(k);
      return v === k ? d.name || d.code : v;
    };
    const list = (Array.isArray(departments) ? departments : []).filter((d) => d?.code);
    const naT = t("ES_PGR_ADMIN_DEPT_NA");
    const opts = [{ code: "NA", label: naT === "ES_PGR_ADMIN_DEPT_NA" ? "No Department Assigned" : naT }, ...list.map((d) => ({ code: d.code, label: label(d) }))];
    const map = {}; // code OR stored name -> {label, code} (additionalDetail.department holds either)
    list.forEach((d) => {
      const l = label(d);
      map[d.code] = { label: l, code: d.code };
      if (d.name) map[d.name] = { label: l, code: d.code };
    });
    return { opts, map };
  }, [departments, t]);

  // ── filter state (committed-snapshot pattern) ───────────────────────────
  const emptyFilters = { complaintNumber: "", departments: [], fromDate: "", toDate: "" };
  const [filters, setFilters] = useState(emptyFilters);
  const [committed, setCommitted] = useState(emptyFilters); // auto-loads all on mount
  const [validationError, setValidationError] = useState("");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [sortBy, setSortBy] = useState("createdTime");
  const [sortOrder, setSortOrder] = useState("DESC");
  const [clientSort, setClientSort] = useState(null); // {col: 'department'|'complaintType', dir} — current page only
  const [deptOpen, setDeptOpen] = useState(false);
  const [deptQuery, setDeptQuery] = useState("");
  const [dateOpen, setDateOpen] = useState(false);
  const [dateFocus, setDateFocus] = useState([0, 0]); // react-date-range focus: [range, 0=start|1=end]
  const [exporting, setExporting] = useState(false);
  const [exportNote, setExportNote] = useState("");
  const [cnoOpen, setCnoOpen] = useState(false);
  const [, setAgoTick] = useState(0); // re-render so "Updated Xs ago" stays fresh
  const deptRef = useRef(null);
  const dateRef = useRef(null);
  const cnoRef = useRef(null);

  useEffect(() => {
    const close = (e) => {
      if (deptRef.current && !deptRef.current.contains(e.target)) { setDeptOpen(false); setDeptQuery(""); }
      if (dateRef.current && !dateRef.current.contains(e.target)) setDateOpen(false);
      if (cnoRef.current && !cnoRef.current.contains(e.target)) setCnoOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  // last 5 searched complaint numbers, per tenant (suggestions under the input)
  const RECENT_KEY = `pgrAdmRecentCno.${tenantId}`;
  const getRecent = () => { try { return JSON.parse(localStorage.getItem(RECENT_KEY)) || []; } catch (e) { return []; } };
  const [recent, setRecent] = useState(getRecent);
  const pushRecent = (v) => {
    const list = [v, ...getRecent().filter((x) => x !== v)].slice(0, 5);
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(list)); } catch (e) {}
    setRecent(list);
  };
  useEffect(() => {
    const id = setInterval(() => setAgoTick((x) => x + 1), 10000);
    return () => clearInterval(id);
  }, []);

  const buildParams = (f, pg, size) => {
    const p = { tenantId, limit: Math.min(size + 1, 51), offset: pg * size, sortBy, sortOrder };
    if (f.complaintNumber) p.serviceRequestId = f.complaintNumber.trim().toUpperCase();
    if (f.departments.length) p.departmentCode = f.departments.map((d) => d.code);
    if (f.fromDate) p.fromDate = new Date(`${f.fromDate}T00:00:00`).getTime();
    if (f.toDate) p.toDate = new Date(`${f.toDate}T23:59:59.999`).getTime();
    return p;
  };

  // ── rows query (over-fetch by 1 → next-page probe; see header comment) ──
  const rowsKey = ["pgrAdminSearchUi", JSON.stringify(committed), page, pageSize, sortBy, sortOrder];
  const { data: rowsData, isLoading: rowsLoading, isError, refetch, dataUpdatedAt } = useQuery(
    rowsKey,
    async () => {
      const res = await searchAdmin(buildParams(committed, page, pageSize));
      const all = res?.ServiceWrappers || [];
      let hasMore = all.length > pageSize;
      const rows = hasMore ? all.slice(0, pageSize) : all;
      // the backend clamps limit to 50, so at pageSize 50 the +1 over-fetch
      // can't come back — probe the next offset with a 1-row request instead
      if (!hasMore && all.length === pageSize) {
        const probe = await searchAdmin({ ...buildParams(committed, page, pageSize), limit: 1, offset: (page + 1) * pageSize });
        hasMore = (probe?.ServiceWrappers || []).length > 0;
      }
      const backendTotal = Number(res?.totalCount);
      const trust = Number.isFinite(backendTotal) && backendTotal > all.length;
      const total = trust ? backendTotal : page * pageSize + rows.length + (hasMore ? 1 : 0);
      return { rows, total, totalExact: trust || !hasMore };
    },
    { enabled: isSuperUser, keepPreviousData: true, cacheTime: 0, staleTime: 0, retry: false, refetchOnWindowFocus: false }
  );

  if (!isSuperUser) return <Redirect to={`/${window?.contextPath}/employee`} />;
  if (deptLoading) return <Loader />;

  const tr = (k, fb) => { const v = t(k); return v === k ? fb : v; };

  const tenantKey = `TENANT_TENANTS_${String(tenantId || "").replace(/\./g, "_").toUpperCase()}`;
  const tenantName = tr(tenantKey, tenantId);

  const validate = (f) => {
    const today = new Date(); today.setHours(23, 59, 59, 999);
    if (f.fromDate && new Date(f.fromDate) > today) return tr("ES_PGR_ADMIN_ERR_FUTURE", "From date cannot be in the future");
    if (f.fromDate && f.toDate && new Date(f.toDate) < new Date(f.fromDate))
      return tr("ES_PGR_ADMIN_ERR_RANGE_ORDER", "To date must be on or after the from date");
    if (f.fromDate && f.toDate && new Date(f.toDate) - new Date(f.fromDate) > 365 * 24 * 3600 * 1000)
      return tr("ES_PGR_ADMIN_ERR_RANGE_SPAN", "Date range cannot exceed 365 days");
    if (f.complaintNumber && !/^[A-Za-z0-9\-]{2,64}$/.test(f.complaintNumber.trim()))
      return tr("ES_PGR_ADMIN_COMPLAINT_NO_INVALID", "Invalid complaint number format");
    return "";
  };
  const onSearch = () => {
    const err = validate(filters);
    setValidationError(err);
    if (err) return;
    if (filters.complaintNumber.trim()) pushRecent(filters.complaintNumber.trim().toUpperCase());
    setCnoOpen(false);
    setPage(0);
    setCommitted({ ...filters, departments: [...filters.departments] });
  };
  const onClear = () => {
    setFilters(emptyFilters); setValidationError(""); setPage(0);
    setCommitted(emptyFilters);
  };
  const toggleDept = (opt) => {
    setFilters((f) => {
      const has = f.departments.some((d) => d.code === opt.code);
      return { ...f, departments: has ? f.departments.filter((d) => d.code !== opt.code) : [...f.departments, opt] };
    });
  };

  // additionalDetail can arrive as a JSON STRING on some records (legacy
  // employee-created complaints) — normalize before reading .department.
  const deptOf = (svc) => {
    let ad = svc && svc.additionalDetail;
    if (typeof ad === "string") { try { ad = JSON.parse(ad); } catch (e) { ad = null; } }
    return ad && ad.department;
  };
  const deptCell = (raw) => {
    if (!raw || raw === "NA") return { label: tr("ES_PGR_ADMIN_DEPT_NA", "No Department Assigned"), code: "NA" };
    const hit = deptOptions.map[raw];
    return hit || { label: raw, code: raw };
  };

  // ── single range-calendar plumbing (filters keep yyyy-mm-dd strings) ────
  const isoOf = (d) => {
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  };
  const dateOf = (iso) => (iso ? new Date(`${iso}T00:00:00`) : new Date());
  const disp = (iso) => { const [y, m, d] = iso.split("-"); return `${d}/${m}/${y}`; };
  const rangeLabel = filters.fromDate
    ? `${disp(filters.fromDate)} – ${disp(filters.toDate || filters.fromDate)}`
    : tr("ES_PGR_ADMIN_DATE_RANGE_PH", "Select date range");
  const onRangePick = (r) => {
    const sel = r.range1 || Object.values(r)[0];
    if (!sel) return;
    setFilters((f) => ({ ...f, fromDate: isoOf(sel.startDate), toDate: isoOf(sel.endDate) }));
  };
  // the library moves focus start→end after the 1st click and back to start
  // after the 2nd — that round-trip IS "range complete", so close then
  const onRangeFocus = (f) => {
    setDateFocus(f);
    if (f[1] === 0) setDateOpen(false);
  };
  const primaryFill = (typeof window !== "undefined" &&
    getComputedStyle(document.documentElement).getPropertyValue("--color-primary-1").trim()) || "#c84c0e";

  const onExport = async () => {
    if (exporting) return;
    setExporting(true);
    setExportNote("");
    try {
      const out = [];
      let offset = 0;
      let capped = true;
      for (let i = 0; i < Math.ceil(EXPORT_MAX_ROWS / 50); i++) {
        const res = await searchAdmin({ ...buildParams(committed, 0, 50), limit: 50, offset });
        const batch = res?.ServiceWrappers || [];
        out.push(...batch);
        if (batch.length < 50) { capped = false; break; }
        offset += 50;
      }
      // real .xlsx via the platform's Digit.Download.Excel (xlsx lib, json_to_sheet)
      const H = {
        cno: tr("CS_COMMON_COMPLAINT_NO", "Complaint No."),
        dept: tr("ES_PGR_ADMIN_HEADER_DEPARTMENT", "Department"),
        type: tr("CS_COMPLAINT_DETAILS_COMPLAINT_TYPE", "Complaint Type"),
        status: tr("CS_COMPLAINT_DETAILS_CURRENT_STATUS", "Status"),
        created: tr("ES_PGR_ADMIN_CREATED_ON", "Created On"),
        modified: tr("ES_PGR_ADMIN_LAST_MODIFIED", "Last Modified"),
      };
      const data = out.map((w) => {
        const s = w.service || {};
        const cd = fmtDT(s?.auditDetails?.createdTime);
        const md = fmtDT(s?.auditDetails?.lastModifiedTime);
        return {
          [H.cno]: s.serviceRequestId,
          [H.dept]: deptCell(deptOf(s)).label,
          [H.type]: complaintLabel(t, s.serviceCode),
          [H.status]: tr(`CS_COMMON_${s.applicationStatus}`, s.applicationStatus),
          [H.created]: `${cd.d}, ${cd.t}`,
          [H.modified]: `${md.d}, ${md.t}`,
        };
      });
      // Digit.Download.Excel truncates the download name to 30 chars — stay under it
      Digit.Download.Excel(data, `complaints-${new Date().toISOString().slice(0, 10)}`);
      if (capped) setExportNote(tr("ES_PGR_ADMIN_EXPORT_CAPPED", `Exported the first ${EXPORT_MAX_ROWS} rows only`));
    } catch (e) {
      setExportNote(tr("ES_PGR_ADMIN_EXPORT_FAILED", "Export failed — please try again"));
    } finally {
      setExporting(false);
    }
  };

  const rows = rowsData?.rows || [];
  const total = rowsData?.total ?? 0;
  const totalExact = rowsData?.totalExact ?? true;
  const totalStr = `${total.toLocaleString()}${totalExact ? "" : "+"}`;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const pageWindow = (() => {
    const w = [];
    const start = Math.max(0, Math.min(page - 2, totalPages - 5));
    for (let i = start; i < Math.min(start + 5, totalPages); i++) w.push(i);
    return w;
  })();
  const showFrom = total === 0 ? 0 : page * pageSize + 1;
  const showTo = page * pageSize + rows.length;

  // department / complaint type: label-based sort of the CURRENT page (labels only exist FE-side)
  const displayRows = (() => {
    if (!clientSort) return rows;
    const key = clientSort.col === "department"
      ? (w) => deptCell(deptOf(w?.service)).label
      : (w) => complaintLabel(t, w?.service?.serviceCode) || "";
    const dir = clientSort.dir === "ASC" ? 1 : -1;
    return [...rows].sort((a, b) => dir * String(key(a)).localeCompare(String(key(b))));
  })();

  const setServerSort = (col) => {
    setClientSort(null);
    if (sortBy === col) setSortOrder((o) => (o === "DESC" ? "ASC" : "DESC"));
    else { setSortBy(col); setSortOrder("DESC"); }
    setPage(0);
  };
  const setSort = (col) => {
    if (SERVER_SORT_COLS.includes(col)) return setServerSort(col);
    setClientSort((cs) => (cs?.col === col ? { col, dir: cs.dir === "ASC" ? "DESC" : "ASC" } : { col, dir: "ASC" }));
  };
  const sortState = (col) => {
    if (clientSort) return clientSort.col === col ? clientSort.dir : null;
    return SERVER_SORT_COLS.includes(col) && sortBy === col ? sortOrder : null;
  };
  const SortTh = ({ col, children }) => {
    const st = sortState(col);
    return (
      <th className="pgr-adm-th-sort" onClick={() => setSort(col)} title={tr("ES_PGR_ADMIN_SORT_BY", "Sort by")}>
        {children}
        <span className={`si ${st ? "act" : ""}`}>{st ? (st === "DESC" ? "↓" : "↑") : "⇅"}</span>
      </th>
    );
  };

  const agoLabel = (() => {
    if (!dataUpdatedAt) return "";
    const s = Math.max(0, Math.round((Date.now() - dataUpdatedAt) / 1000));
    const upd = tr("ES_PGR_ADMIN_UPDATED", "Updated");
    if (s < 60) return `${upd} ${s} ${tr("ES_PGR_ADMIN_SECS_AGO", "sec ago")}`;
    if (s < 3600) return `${upd} ${Math.floor(s / 60)} ${tr("ES_PGR_ADMIN_MINS_AGO", "min ago")}`;
    return `${upd} ${Math.floor(s / 3600)} ${tr("ES_PGR_ADMIN_HOURS_AGO", "hr ago")}`;
  })();

  const CHIP_LIMIT = 3;
  const chips = filters.departments.slice(0, CHIP_LIMIT);
  const chipOverflow = filters.departments.length - chips.length;

  const dtCell = (epoch) => {
    const v = fmtDT(epoch);
    return (
      <span className="pgr-adm-dt">
        <IcCal />
        <span>
          {v.d}
          <span className="t">{v.t}</span>
        </span>
      </span>
    );
  };

  return (
    <div className="pgr-adm">
      <div className="pgr-adm-top">
        <div className="pgr-adm-title">
          <h1>{tr("ES_PGR_ADMIN_SEARCH", "Admin Complaint Search")}</h1>
          <p>{tr("ES_PGR_ADMIN_SEARCH_SUB", "Search and view complaints across all departments")}.</p>
        </div>
        <div className="pgr-adm-banner">
          <IcInfo />
          <span>{tr("ES_PGR_ADMIN_TENANT_BANNER", "You are viewing data for")} <b>{tenantName}</b></span>
        </div>
      </div>

      {/* ── Filter bar ── */}
      <div className="pgr-adm-card">
        <div className="pgr-adm-frow">
          <div className="pgr-adm-field" ref={cnoRef} style={{ position: "relative" }}>
            <label htmlFor="adm-cno">{tr("CS_COMMON_COMPLAINT_NO", "Complaint No.")}</label>
            <div className="pgr-adm-cno">
              <span className="mag"><IcSearch /></span>
              <input id="adm-cno" type="text" ref={bareInput} placeholder={tr("ES_PGR_ADMIN_CNO_PH", "Enter complaint number")}
                value={filters.complaintNumber} autoComplete="off"
                onFocus={() => setCnoOpen(true)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onSearch(); } }}
                onChange={(e) => { setFilters((f) => ({ ...f, complaintNumber: e.target.value })); setCnoOpen(true); }} />
              <span className="hash" aria-hidden>#</span>
            </div>
            {(() => {
              const q = filters.complaintNumber.trim().toUpperCase();
              const hits = recent.filter((r) => !q || (r.includes(q) && r !== q));
              return cnoOpen && hits.length > 0 ? (
                <div className="pgr-adm-recent" role="listbox">
                  <div className="hd">{tr("ES_PGR_ADMIN_RECENT", "Recent searches")}</div>
                  {hits.map((r) => (
                    <div className="it" key={r} role="option" aria-selected="false"
                      onClick={() => { setFilters((f) => ({ ...f, complaintNumber: r })); setCnoOpen(false); }}>
                      <IcClock /> {r}
                    </div>
                  ))}
                </div>
              ) : null;
            })()}
          </div>

          <div className="pgr-adm-field" ref={deptRef}>
            <label>{tr("ES_PGR_ADMIN_HEADER_DEPARTMENT", "Department")}</label>
            <div className="pgr-adm-msd">
              <div className="pgr-adm-msd-field" role="button" tabIndex={0}
                onClick={() => { setDeptQuery(""); setDeptOpen((o) => !o); }}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setDeptQuery(""); setDeptOpen((o) => !o); } }}>
                {filters.departments.length === 0 && <span className="ph">{tr("ES_PGR_ADMIN_SELECT_DEPARTMENTS", "Select departments")}</span>}
                {chips.map((d) => (
                  <span className="pgr-adm-tag" key={d.code} onClick={(e) => e.stopPropagation()}>
                    <i>{d.label}</i>
                    <span className="x" role="button" tabIndex={0} aria-label={`remove ${d.label}`}
                      onClick={() => toggleDept(d)}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); toggleDept(d); } }}>×</span>
                  </span>
                ))}
                {chipOverflow > 0 && <span className="pgr-adm-tag"><i>+{chipOverflow}</i></span>}
                <span className="caret" aria-hidden>▾</span>
              </div>
              {deptOpen && (
                <div className="pgr-adm-msd-list" role="listbox">
                  <div className="pgr-adm-msd-search" onClick={(e) => e.stopPropagation()}>
                    <IcSearch />
                    <input type="text" ref={bareInput} autoFocus value={deptQuery}
                      placeholder={tr("ES_PGR_ADMIN_DEPT_SEARCH_PH", "Search departments")}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); setDeptOpen(false); setDeptQuery(""); onSearch(); } }}
                      onChange={(e) => setDeptQuery(e.target.value)} />
                  </div>
                  {deptOptions.opts
                    .filter((o) => !deptQuery.trim() || o.label.toLowerCase().includes(deptQuery.trim().toLowerCase()))
                    .map((o) => (
                      <label key={o.code} className="pgr-adm-msd-opt">
                        <input type="checkbox"
                          checked={filters.departments.some((d) => d.code === o.code)}
                          onChange={() => toggleDept(o)} />
                        <span>{o.label}</span>
                      </label>
                    ))}
                </div>
              )}
            </div>
          </div>

          <div className="pgr-adm-field pgr-adm-daterange" ref={dateRef}>
            <label>{tr("ES_PGR_ADMIN_DATE_RANGE", "Date Range")}</label>
            <div className="pgr-adm-date" role="button" tabIndex={0}
              aria-label={tr("ES_PGR_ADMIN_DATE_RANGE", "Date Range")}
              onClick={() => { setDateFocus([0, 0]); setDateOpen((o) => !o); }}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setDateFocus([0, 0]); setDateOpen((o) => !o); } }}>
              <IcCal />
              <span className={`val ${filters.fromDate ? "" : "ph"}`}>{rangeLabel}</span>
              <span className="caret" aria-hidden>▾</span>
            </div>
            {dateOpen && (
              <div className="pgr-adm-rdr">
                <RangeCalendar
                  ranges={[{ startDate: dateOf(filters.fromDate), endDate: dateOf(filters.toDate || filters.fromDate), key: "range1" }]}
                  focusedRange={dateFocus}
                  onRangeFocusChange={onRangeFocus}
                  onChange={onRangePick}
                  rangeColors={[primaryFill]}
                  maxDate={new Date()}
                  weekStartsOn={1}
                  showDateDisplay={false}
                  retainEndDateOnFirstSelection={true}
                  locale={lang === "pt-PT" ? dfnsPt : dfnsEnGB}
                />
              </div>
            )}
          </div>

          <div className="pgr-adm-fbtns">
            <button className="pgr-adm-btn pgr-adm-btn--primary" onClick={onSearch}>
              <IcSearch /> {tr("ACTION_TEST_SEARCH", "Search")}
            </button>
            <button className="pgr-adm-btn pgr-adm-btn--ghost" onClick={onClear}>
              <IcClear /> {tr("ES_PGR_ADMIN_CLEAR", "Clear")}
            </button>
          </div>
        </div>

        {validationError && <div className="pgr-adm-err" role="alert">{validationError}</div>}
      </div>

      {/* ── Results ── */}
      <div className="pgr-adm-card pgr-adm-results">
        <div className="pgr-adm-results-head">
          <div className="pgr-adm-found">
            <h2>{totalStr} {tr("ES_PGR_ADMIN_COMPLAINTS_FOUND", "Complaints Found")}</h2>
            {agoLabel && <span className="pgr-adm-updated">{agoLabel}</span>}
          </div>
          <div className="pgr-adm-sort">
            <span>{tr("ES_PGR_ADMIN_SORT_BY", "Sort by")}</span>
            <select className="pgr-adm-sel" ref={selRef("150px", "40px")} value={sortBy} onChange={(e) => { setClientSort(null); setSortBy(e.target.value); setPage(0); }}>
              {SORT_OPTIONS.map((o) => <option key={o.code} value={o.code}>{tr(o.i18nKey, o.fb)}</option>)}
            </select>
            <select className="pgr-adm-sel" ref={selRef("96px", "40px")} value={sortOrder} onChange={(e) => { setClientSort(null); setSortOrder(e.target.value); setPage(0); }}>
              <option value="DESC">{tr("ES_PGR_ADMIN_DESC", "Desc")}</option>
              <option value="ASC">{tr("ES_PGR_ADMIN_ASC", "Asc")}</option>
            </select>
            <button className="pgr-adm-btn pgr-adm-btn--ghost" onClick={onExport} disabled={exporting || rows.length === 0}>
              <IcExport /> {exporting ? tr("ES_PGR_ADMIN_EXPORTING", "Exporting…") : tr("ES_PGR_ADMIN_EXPORT", "Export")}
            </button>
            {exportNote && <span style={{ color: "var(--color-error,#b3261e)", fontSize: ".76rem" }}>{exportNote}</span>}
          </div>
        </div>

        {rowsLoading ? (
          <div className="pgr-adm-empty"><Loader /></div>
        ) : isError ? (
          <div className="pgr-adm-empty" role="alert">
            {tr("ES_PGR_ADMIN_ERROR", "Something went wrong fetching complaints.")}{" "}
            <button className="pgr-adm-btn pgr-adm-btn--ghost" onClick={() => refetch()}>{tr("ES_PGR_ADMIN_RETRY", "Retry")}</button>
          </div>
        ) : rows.length === 0 ? (
          <div className="pgr-adm-empty">{tr("ES_PGR_ADMIN_NO_RESULTS", "No complaints found matching your criteria.")}</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="pgr-adm-table">
              <thead>
                <tr>
                  <SortTh col="serviceRequestId">{tr("CS_COMMON_COMPLAINT_NO", "Complaint No.")}</SortTh>
                  <SortTh col="department">{tr("ES_PGR_ADMIN_HEADER_DEPARTMENT", "Department")}</SortTh>
                  <SortTh col="complaintType">{tr("CS_COMPLAINT_DETAILS_COMPLAINT_TYPE", "Complaint Type")}</SortTh>
                  <SortTh col="applicationStatus">{tr("CS_COMPLAINT_DETAILS_CURRENT_STATUS", "Status")}</SortTh>
                  <SortTh col="createdTime">{tr("ES_PGR_ADMIN_CREATED_ON", "Created On")}</SortTh>
                  <SortTh col="lastModifiedTime">{tr("ES_PGR_ADMIN_LAST_MODIFIED", "Last Modified")}</SortTh>
                </tr>
              </thead>
              <tbody>
                {displayRows.map((w) => {
                  const s = w.service || {};
                  const dept = deptCell(deptOf(s));
                  const tint = deptTint(dept.code);
                  const statusLabel = tr(`CS_COMMON_${s.applicationStatus}`, s.applicationStatus);
                  const detailUrl = `/${window.contextPath}/employee/pgr/complaint-details/${s.serviceRequestId}`;
                  return (
                    <tr key={s.serviceRequestId} onClick={() => history.push(detailUrl)}
                      title={tr("ES_PGR_ADMIN_VIEW", "View")}>
                      <td>
                        <Link className="pgr-adm-cno-link" to={detailUrl} onClick={(e) => e.stopPropagation()}>
                          {s.serviceRequestId}
                        </Link>
                      </td>
                      <td>
                        <span className="pgr-adm-deptag" style={{ background: tint.bg, color: tint.fg }} title={dept.label}>
                          <IcBuilding /> <i>{dept.label}</i>
                        </span>
                      </td>
                      <td>{complaintLabel(t, s.serviceCode)}</td>
                      <td><span className={`pgr-adm-pill pgr-adm-pill--${bucketOf(s.applicationStatus)}`}>{statusLabel}</span></td>
                      <td>{dtCell(s?.auditDetails?.createdTime)}</td>
                      <td>{dtCell(s?.auditDetails?.lastModifiedTime)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="pgr-adm-foot">
          <div className="info">
            {tr("ES_PGR_ADMIN_SHOWING", "Showing")} {showFrom} {tr("ES_PGR_ADMIN_TO", "to")} {showTo}{" "}
            {tr("ES_PGR_ADMIN_OF", "of")} {totalStr} {tr("ES_PGR_ADMIN_RESULTS_WORD", "results")}
          </div>
          <div className="pgr-adm-pages">
            <button className="pgr-adm-page" disabled={page === 0} onClick={() => setPage(0)} aria-label="first page">«</button>
            <button className="pgr-adm-page" disabled={page === 0} onClick={() => setPage((p) => p - 1)} aria-label="previous page">‹</button>
            {pageWindow.map((p) => (
              <button key={p} className={`pgr-adm-page ${p === page ? "pgr-adm-page--active" : ""}`} onClick={() => setPage(p)}>
                {p + 1}
              </button>
            ))}
            <button className="pgr-adm-page" disabled={page >= totalPages - 1} onClick={() => setPage((p) => p + 1)} aria-label="next page">›</button>
            <button className="pgr-adm-page" disabled={!totalExact || page >= totalPages - 1} onClick={() => setPage(totalPages - 1)} aria-label="last page">»</button>
          </div>
          <div className="pgr-adm-pgsize">
            <span>{tr("ES_PGR_ADMIN_ROWS_PER_PAGE", "Rows per page")}</span>
            <select className="pgr-adm-sel" ref={selRef("76px", "36px")} value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(0); }}>
              {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PGRAdminSearch;
