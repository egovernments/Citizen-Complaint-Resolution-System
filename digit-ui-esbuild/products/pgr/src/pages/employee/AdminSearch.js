import React, { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Redirect, Link, useHistory } from "react-router-dom";
import { useQuery } from "react-query";
import { Request } from "@egovernments/digit-ui-libraries";
import { Loader } from "@egovernments/digit-ui-components";
import Urls from "../../utils/urls";

/**
 * PGRAdminSearch — SUPERUSER-only cross-department complaint search
 * (/employee/pgr/admin-search), custom UI replicating the approved design
 * (docs mock): KPI summary cards, left filter panel (complaint no, department
 * multi-select with chips + "No department (N/A)", from/to dates, guidelines),
 * right results card (count, sort, status pills, view actions, numbered
 * pagination with rows-per-page).
 *
 * Backend: POST /pgr-services/v2/request/_admin/_search (PR #1260).
 * totalCount workaround: the current backend echoes the page size as
 * totalCount (reported on #1260), so we over-fetch by one row per page to
 * know whether a next page exists; the KPI/status breakdown is aggregated
 * client-side by walking all pages while the filtered total stays under
 * STATS_MAX_ROWS (fine at pilot scale; the cards show "—" beyond that).
 */

const STATS_MAX_ROWS = 250;
const PAGE_SIZES = [10, 20, 50];

// applicationStatus -> KPI bucket (standard PGR + CMS workflows)
const STATUS_BUCKET = {
  PENDINGFORASSIGNMENT: "open",
  NEW: "open",
  PENDINGFORREASSIGNMENT: "inprogress",
  PENDINGATLME: "inprogress",
  PENDINGATSUPERVISOR: "inprogress",
  IN_TRIAGE: "inprogress",
  INTRIAGE: "inprogress",
  REFERRED: "inprogress",
  INVESTIGATION: "inprogress",
  UNDER_INVESTIGATION: "inprogress",
  AWAITINGINFORMATION: "inprogress",
  INFOFROMCITIZEN: "inprogress",
  RESOLVED: "resolved",
  CLOSEDAFTERRESOLUTION: "closed",
  CLOSEDAFTERREJECTION: "closed",
  REJECTED: "closed",
  CLOSED: "closed",
};
const bucketOf = (status) => STATUS_BUCKET[String(status || "").toUpperCase()] || "inprogress";

const SORT_OPTIONS = [
  { code: "createdTime", i18nKey: "ES_PGR_ADMIN_CREATED_DATE" },
  { code: "lastModifiedTime", i18nKey: "ES_PGR_ADMIN_LAST_MODIFIED" },
  { code: "serviceRequestId", i18nKey: "CS_COMMON_COMPLAINT_NO" },
  { code: "applicationStatus", i18nKey: "CS_COMPLAINT_DETAILS_CURRENT_STATUS" },
];

const STYLE_ID = "pgr-admin-search-css";
const CSS = `
.pgr-adm { padding: 1rem 1.25rem 2rem; background: var(--color-page-bg, transparent); color: var(--color-text-primary,#1f2937); }
.pgr-adm * { box-sizing: border-box; }
.pgr-adm-crumbs { font-size: .8rem; color: var(--color-text-secondary,#64748b); margin-bottom: .35rem; }
.pgr-adm-crumbs a { color: var(--color-link-normal, var(--color-primary-1, var(--color-primary-main,#c84c0e))); text-decoration: none; }
.pgr-adm-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; margin-bottom: 1rem; }
.pgr-adm-title h1 { margin: 0; font-size: 1.6rem; color: var(--color-text-heading, var(--color-primary-1, var(--color-primary-main,#c84c0e))); }
.pgr-adm-title p { margin: .25rem 0 0; color: var(--color-text-secondary,#64748b); font-size: .9rem; }
.pgr-adm-back { border: 1px solid var(--color-border,#cbd5e1); background: #fff; border-radius: .5rem; padding: .55rem 1rem; font-weight: 600; cursor: pointer; font-size: .85rem; white-space: nowrap; }
.pgr-adm-kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: .75rem; margin-bottom: 1rem; }
.pgr-adm-kpi { display: flex; align-items: center; gap: .75rem; background: var(--color-surface,#fff); border: 1px solid var(--color-border,#e2e8f0); border-radius: .75rem; padding: .9rem 1rem; }
.pgr-adm-kpi-ic { width: 42px; height: 42px; border-radius: 9999px; display: flex; align-items: center; justify-content: center; font-size: 1.1rem; flex: none; }
.pgr-adm-kpi h3 { margin: 0; font-size: .78rem; font-weight: 600; color: var(--color-text-secondary,#64748b); }
.pgr-adm-kpi strong { font-size: 1.35rem; line-height: 1.3; }
.pgr-adm-kpi small { color: var(--color-text-secondary,#94a3b8); font-size: .72rem; }
.pgr-adm-kpi .pct { margin-left: .4rem; font-size: .78rem; font-weight: 600; }
.pgr-adm-body { display: grid; grid-template-columns: 300px 1fr; gap: 1rem; align-items: start; }
@media (max-width: 900px) { .pgr-adm-body { grid-template-columns: 1fr; } }
.pgr-adm-card { background: var(--color-surface,#fff); border: 1px solid var(--color-card-border, var(--color-border,#e2e8f0)); border-radius: .75rem; }
.pgr-adm-filters { padding: 1rem; }
.pgr-adm-filters-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: .75rem; }
.pgr-adm-filters-head h2 { margin: 0; font-size: 1rem; }
.pgr-adm-clearall { background: none; border: none; color: var(--color-link-normal, var(--color-primary-1,#c84c0e)); font-weight: 600; cursor: pointer; font-size: .8rem; padding: 0; }
.pgr-adm-field { margin-bottom: .85rem; }
.pgr-adm-field label { display: block; font-size: .8rem; font-weight: 600; margin-bottom: .3rem; }
.pgr-adm-field input[type="text"], .pgr-adm-field input[type="date"] {
  width: 100%; padding: .5rem .6rem; border: 1px solid var(--color-input-border-default, var(--color-border,#cbd5e1)); border-radius: .5rem; font-size: .85rem; background:#fff;
}
.pgr-adm-field input:focus, .pgr-adm-msd-btn:focus { outline: none; border-color: var(--color-input-border-focus, var(--color-primary-1,#c84c0e)); }
.pgr-adm-msd { position: relative; }
.pgr-adm-msd-btn { width: 100%; display: flex; justify-content: space-between; align-items: center; padding: .5rem .6rem; border: 1px solid var(--color-border,#cbd5e1); border-radius: .5rem; background: #fff; cursor: pointer; font-size: .85rem; color: var(--color-text-secondary,#64748b); }
.pgr-adm-msd-list { position: absolute; z-index: 30; top: calc(100% + 4px); left: 0; right: 0; max-height: 240px; overflow: auto; background: #fff; border: 1px solid var(--color-border,#cbd5e1); border-radius: .5rem; box-shadow: 0 8px 20px rgba(0,0,0,.12); padding: .25rem 0; }
.pgr-adm-msd-opt { display: flex; gap: .5rem; align-items: center; padding: .4rem .6rem; font-size: .85rem; cursor: pointer; }
.pgr-adm-msd-opt:hover { background: var(--color-surface-secondary,#f1f5f9); }
.pgr-adm-chips { display: flex; flex-wrap: wrap; gap: .35rem; margin-top: .45rem; }
.pgr-adm-chip { display: inline-flex; align-items: center; gap: .3rem; border: 1px solid var(--color-primary-1, var(--color-primary-main,#c84c0e)); color: var(--color-primary-1, var(--color-primary-main,#c84c0e)); border-radius: 9999px; padding: .1rem .55rem; font-size: .74rem; background: #fff; }
.pgr-adm-chip button { background: none; border: none; cursor: pointer; color: inherit; font-size: .8rem; line-height: 1; padding: 0; }
.pgr-adm-guide { background: var(--color-primary-1-bg, var(--color-primary-selected-bg,#f4efe9)); border: 1px solid var(--color-border,#e2e8f0); border-radius: .5rem; padding: .6rem .75rem; margin: .75rem 0; }
.pgr-adm-guide p { margin: 0 0 .3rem; font-size: .78rem; font-weight: 700; }
.pgr-adm-guide ul { margin: 0; padding: 0; list-style: none; }
.pgr-adm-guide li { font-size: .74rem; color: var(--color-text-secondary,#4b5563); margin: .15rem 0; padding-left: 1.1rem; position: relative; }
.pgr-adm-guide li:before { content: "✓"; position: absolute; left: 0; color: var(--color-primary-1, var(--color-primary-main,#c84c0e)); }
.pgr-adm-actions { display: flex; gap: .5rem; }
.pgr-adm-btn { flex: 1; padding: .6rem .75rem; border-radius: .5rem; font-weight: 700; font-size: .85rem; cursor: pointer; border: 1px solid transparent; }
.pgr-adm-btn--primary { background: var(--color-button-primary-bg-default, var(--color-primary-1, var(--color-primary-main,#c84c0e))); color: #fff; }
.pgr-adm-btn--primary:hover { background: var(--color-button-primary-bg-hover, var(--color-primary-1,#a33d0b)); }
.pgr-adm-btn--ghost { background: #fff; border-color: var(--color-border,#cbd5e1); }
.pgr-adm-err { color: var(--color-error,#b3261e); font-size: .76rem; margin: .4rem 0 0; }
.pgr-adm-results { padding: 0; overflow: hidden; }
.pgr-adm-results-head { display: flex; align-items: center; justify-content: space-between; gap: .75rem; padding: .85rem 1rem; border-bottom: 1px solid var(--color-border,#eef2f7); flex-wrap: wrap; }
.pgr-adm-results-head h2 { margin: 0; font-size: 1rem; }
.pgr-adm-results-head h2 span { color: var(--color-text-secondary,#64748b); font-weight: 500; font-size: .85rem; }
.pgr-adm-sort { display: flex; align-items: center; gap: .4rem; font-size: .8rem; color: var(--color-text-secondary,#64748b); }
.pgr-adm-sort select, .pgr-adm-pgsize select { padding: .35rem .5rem; border: 1px solid var(--color-border,#cbd5e1); border-radius: .4rem; background: #fff; font-size: .8rem; }
.pgr-adm-iconbtn { border: 1px solid var(--color-border,#cbd5e1); background: #fff; border-radius: .4rem; padding: .35rem .55rem; cursor: pointer; font-size: .8rem; }
.pgr-adm-table { width: 100%; border-collapse: collapse; }
.pgr-adm-table th { text-align: left; font-size: .74rem; text-transform: uppercase; letter-spacing: .02em; color: var(--color-text-secondary,#64748b); padding: .65rem 1rem; background: var(--color-surface-secondary,#f8fafc); border-bottom: 1px solid var(--color-border,#eef2f7); white-space: nowrap; }
.pgr-adm-table td { padding: .7rem 1rem; border-bottom: 1px solid var(--color-border,#f1f5f9); font-size: .84rem; vertical-align: middle; }
.pgr-adm-table a { color: var(--color-link-normal, var(--color-primary-1, var(--color-primary-main,#c84c0e))); font-weight: 600; text-decoration: underline; }
.pgr-adm-table a:hover { color: var(--color-link-hover, var(--color-primary-1,#a33d0b)); }
.pgr-adm-pill { display: inline-block; border-radius: 9999px; padding: .15rem .6rem; font-size: .74rem; font-weight: 700; white-space: nowrap; }
.pgr-adm-pill--open { background: #e8f5e9; color: #1b5e20; }
.pgr-adm-pill--inprogress { background: #fff3e0; color: #b26a00; }
.pgr-adm-pill--resolved { background: #e3f2fd; color: #1565c0; }
.pgr-adm-pill--closed { background: #eceff1; color: #455a64; }
.pgr-adm-empty { padding: 2.25rem 1rem; text-align: center; color: var(--color-text-secondary,#64748b); font-size: .9rem; }
.pgr-adm-foot { display: flex; align-items: center; justify-content: space-between; gap: .75rem; padding: .75rem 1rem; flex-wrap: wrap; }
.pgr-adm-foot .info { font-size: .78rem; color: var(--color-text-secondary,#64748b); }
.pgr-adm-pages { display: flex; align-items: center; gap: .25rem; }
.pgr-adm-page { min-width: 32px; height: 32px; border: 1px solid var(--color-border,#cbd5e1); background: #fff; border-radius: .4rem; cursor: pointer; font-size: .8rem; }
.pgr-adm-page[disabled] { opacity: .45; cursor: default; }
.pgr-adm-page--active { background: var(--color-button-primary-bg-default, var(--color-primary-1,#c84c0e)); color: #fff; border-color: var(--color-button-primary-bg-default, var(--color-primary-1,#c84c0e)); }
.pgr-adm-pgsize { display: flex; align-items: center; gap: .4rem; font-size: .78rem; color: var(--color-text-secondary,#64748b); }
`;

function injectCss() {
  if (typeof document === "undefined" || document.getElementById(STYLE_ID)) return;
  const el = document.createElement("style");
  el.id = STYLE_ID;
  el.textContent = CSS;
  document.head.appendChild(el);
}

const fmtDate = (epoch) => {
  if (!epoch) return "—";
  const d = new Date(Number(epoch));
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const searchAdmin = (params) =>
  Request({ url: Urls.pgr.adminSearch, method: "POST", auth: true, userService: true, useCache: false, params });

const PGRAdminSearch = () => {
  const { t } = useTranslation();
  const history = useHistory();
  const tenantId = Digit.ULBService.getCurrentTenantId();
  injectCss();

  const roles = Digit.UserService.getUser()?.info?.roles?.map((r) => r?.code) || [];
  const isSuperUser = roles.includes("SUPERUSER");

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
    const opts = [{ code: "NA", label: t("ES_PGR_ADMIN_DEPT_NA") }, ...list.map((d) => ({ code: d.code, label: label(d) }))];
    const map = {};
    list.forEach((d) => { const l = label(d); map[d.code] = l; if (d.name) map[d.name] = l; });
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
  const [deptOpen, setDeptOpen] = useState(false);
  const deptRef = useRef(null);

  useEffect(() => {
    const close = (e) => { if (deptRef.current && !deptRef.current.contains(e.target)) setDeptOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
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
  const { data: rowsData, isLoading: rowsLoading, isError, refetch } = useQuery(
    rowsKey,
    async () => {
      const res = await searchAdmin(buildParams(committed, page, pageSize));
      const all = res?.ServiceWrappers || [];
      const hasMore = all.length > pageSize;
      const rows = hasMore ? all.slice(0, pageSize) : all;
      const backendTotal = Number(res?.totalCount);
      const trust = Number.isFinite(backendTotal) && backendTotal > all.length;
      const total = trust ? backendTotal : page * pageSize + rows.length + (hasMore ? 1 : 0);
      return { rows, total, totalExact: trust || !hasMore };
    },
    { enabled: isSuperUser, keepPreviousData: true, cacheTime: 0, staleTime: 0, retry: false, refetchOnWindowFocus: false }
  );

  // ── KPI stats: walk all pages of the current filter while small enough ──
  const statsKey = ["pgrAdminSearchStats", JSON.stringify(committed)];
  const { data: stats } = useQuery(
    statsKey,
    async () => {
      const counts = { total: 0, open: 0, inprogress: 0, resolved: 0, closed: 0, exact: true };
      let offset = 0;
      for (let i = 0; i < Math.ceil(STATS_MAX_ROWS / 50); i++) {
        const res = await searchAdmin({ ...buildParams(committed, 0, 50), limit: 50, offset });
        const batch = res?.ServiceWrappers || [];
        batch.forEach((w) => { counts.total += 1; counts[bucketOf(w?.service?.applicationStatus)] += 1; });
        if (batch.length < 50) return counts;
        offset += 50;
      }
      counts.exact = false; // hit the cap — there is more we didn't count
      return counts;
    },
    { enabled: isSuperUser, cacheTime: 0, staleTime: 0, retry: false, refetchOnWindowFocus: false }
  );

  if (!isSuperUser) return <Redirect to={`/${window?.contextPath}/employee`} />;
  if (deptLoading) return <Loader />;

  const tr = (k, fb) => { const v = t(k); return v === k ? fb : v; };

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

  const rows = rowsData?.rows || [];
  const total = rowsData?.total ?? 0;
  const totalExact = rowsData?.totalExact ?? true;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const pageWindow = (() => {
    const w = [];
    const start = Math.max(0, Math.min(page - 2, totalPages - 5));
    for (let i = start; i < Math.min(start + 5, totalPages); i++) w.push(i);
    return w;
  })();
  const showFrom = total === 0 ? 0 : page * pageSize + 1;
  const showTo = page * pageSize + rows.length;
  const pct = (n) => (stats && stats.total > 0 ? `${((n / stats.total) * 100).toFixed(2)}%` : "");

  const KPIS = [
    { key: "total", label: tr("ES_PGR_ADMIN_KPI_TOTAL", "Total Complaints"), sub: tr("ES_PGR_ADMIN_KPI_TOTAL_SUB", "Across all departments"), bg: "#e8f5e9", fg: "#1b5e20", ic: "▦" },
    { key: "open", label: tr("ES_PGR_ADMIN_KPI_OPEN", "Open"), bg: "#e8f5e9", fg: "#2e7d32", ic: "✉" },
    { key: "inprogress", label: tr("ES_PGR_ADMIN_KPI_INPROGRESS", "In Progress"), bg: "#fff3e0", fg: "#b26a00", ic: "◔" },
    { key: "resolved", label: tr("ES_PGR_ADMIN_KPI_RESOLVED", "Resolved"), bg: "#e3f2fd", fg: "#1565c0", ic: "✓" },
    { key: "closed", label: tr("ES_PGR_ADMIN_KPI_CLOSED", "Closed"), bg: "#eceff1", fg: "#455a64", ic: "⊗" },
  ];

  return (
    <div className="pgr-adm">
      <div className="pgr-adm-crumbs">
        <Link to={`/${window?.contextPath}/employee`}>{tr("ACTION_TEST_HOME", "Home")}</Link>
        {" / "}<span>PGR</span>{" / "}<span>{tr("ES_PGR_ADMIN_SEARCH", "Admin Complaint Search")}</span>
      </div>
      <div className="pgr-adm-head">
        <div className="pgr-adm-title">
          <h1>{tr("ES_PGR_ADMIN_SEARCH", "Admin Complaint Search")}</h1>
          <p>{tr("ES_PGR_ADMIN_SEARCH_SUB", "Search and view complaints across all departments")}</p>
        </div>
        <button className="pgr-adm-back" onClick={() => history.push(`/${window?.contextPath}/employee`)}>
          ← {tr("ES_PGR_ADMIN_BACK", "Back to Dashboard")}
        </button>
      </div>

      {/* KPI cards — aggregated client-side (exact while the filtered set ≤ STATS_MAX_ROWS) */}
      <div className="pgr-adm-kpis">
        {KPIS.map((k) => (
          <div className="pgr-adm-kpi" key={k.key}>
            <div className="pgr-adm-kpi-ic" style={{ background: k.bg, color: k.fg }} aria-hidden>{k.ic}</div>
            <div>
              <h3>{k.label}</h3>
              <strong>
                {stats ? `${stats[k.key].toLocaleString()}${stats.exact ? "" : "+"}` : "—"}
                {k.key !== "total" && stats && stats.exact && <span className="pct" style={{ color: k.fg }}>{pct(stats[k.key])}</span>}
              </strong>
              {k.sub && <div><small>{k.sub}</small></div>}
            </div>
          </div>
        ))}
      </div>

      <div className="pgr-adm-body">
        {/* ── Filters panel ── */}
        <div className="pgr-adm-card pgr-adm-filters">
          <div className="pgr-adm-filters-head">
            <h2>☰ {tr("ES_COMMON_FILTER_BY", "Filters")}</h2>
            <button className="pgr-adm-clearall" onClick={onClear}>{tr("ES_CLEAR_ALL", "Clear All")}</button>
          </div>

          <div className="pgr-adm-field">
            <label htmlFor="adm-cno">{tr("CS_COMMON_COMPLAINT_NO", "Complaint No.")}</label>
            <input id="adm-cno" type="text" placeholder={tr("ES_PGR_ADMIN_CNO_PH", "Enter complaint number")}
              value={filters.complaintNumber}
              onChange={(e) => setFilters((f) => ({ ...f, complaintNumber: e.target.value }))} />
          </div>

          <div className="pgr-adm-field" ref={deptRef}>
            <label>{tr("ES_PGR_ADMIN_HEADER_DEPARTMENT", "Department")}</label>
            <div className="pgr-adm-msd">
              <button type="button" className="pgr-adm-msd-btn" onClick={() => setDeptOpen((o) => !o)}>
                <span>{tr("ES_PGR_ADMIN_SELECT_DEPARTMENTS", "Select departments")}</span>
                <span aria-hidden>▾</span>
              </button>
              {deptOpen && (
                <div className="pgr-adm-msd-list" role="listbox">
                  {deptOptions.opts.map((o) => (
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
            {filters.departments.length > 0 && (
              <div className="pgr-adm-chips">
                {filters.departments.slice(0, 3).map((d) => (
                  <span className="pgr-adm-chip" key={d.code}>
                    {d.label}
                    <button aria-label={`remove ${d.label}`} onClick={() => toggleDept(d)}>×</button>
                  </span>
                ))}
                {filters.departments.length > 3 && <span className="pgr-adm-chip">+{filters.departments.length - 3}</span>}
              </div>
            )}
          </div>

          <div className="pgr-adm-field">
            <label htmlFor="adm-from">{tr("ES_PGR_ADMIN_FROM_DATE", "From Date")}</label>
            <input id="adm-from" type="date" value={filters.fromDate}
              onChange={(e) => setFilters((f) => ({ ...f, fromDate: e.target.value }))} />
          </div>
          <div className="pgr-adm-field">
            <label htmlFor="adm-to">{tr("ES_PGR_ADMIN_TO_DATE", "To Date")}</label>
            <input id="adm-to" type="date" value={filters.toDate}
              onChange={(e) => setFilters((f) => ({ ...f, toDate: e.target.value }))} />
          </div>

          <div className="pgr-adm-guide">
            <p>ⓘ {tr("ES_PGR_ADMIN_GUIDE_TITLE", "Search Guidelines")}</p>
            <ul>
              <li>{tr("ES_PGR_ADMIN_GUIDE_1", "Select at least one search criteria")}</li>
              <li>{tr("ES_PGR_ADMIN_GUIDE_2", "Date range cannot exceed 365 days")}</li>
              <li>{tr("ES_PGR_ADMIN_GUIDE_3", "To date should be greater than or equal to From date")}</li>
            </ul>
          </div>

          {validationError && <div className="pgr-adm-err" role="alert">{validationError}</div>}

          <div className="pgr-adm-actions">
            <button className="pgr-adm-btn pgr-adm-btn--primary" onClick={onSearch}>
              🔍 {tr("ACTION_TEST_SEARCH", "Search")}
            </button>
            <button className="pgr-adm-btn pgr-adm-btn--ghost" onClick={onClear}>
              ↺ {tr("ES_PGR_ADMIN_CLEAR", "Clear")}
            </button>
          </div>
        </div>

        {/* ── Results ── */}
        <div className="pgr-adm-card pgr-adm-results">
          <div className="pgr-adm-results-head">
            <h2>
              {tr("ES_PGR_ADMIN_RESULTS", "Results")}{" "}
              <span>({total.toLocaleString()}{totalExact ? "" : "+"} {tr("ES_PGR_ADMIN_COMPLAINTS", "Complaints")})</span>
            </h2>
            <div className="pgr-adm-sort">
              <span>{tr("ES_PGR_ADMIN_SORT_BY", "Sort by")}</span>
              <select value={sortBy} onChange={(e) => { setSortBy(e.target.value); setPage(0); }}>
                {SORT_OPTIONS.map((o) => <option key={o.code} value={o.code}>{tr(o.i18nKey, o.code)}</option>)}
              </select>
              <select value={sortOrder} onChange={(e) => { setSortOrder(e.target.value); setPage(0); }}>
                <option value="DESC">↓ {tr("ES_PGR_ADMIN_DESC", "Desc")}</option>
                <option value="ASC">↑ {tr("ES_PGR_ADMIN_ASC", "Asc")}</option>
              </select>
              <button className="pgr-adm-iconbtn" title={tr("ES_PGR_ADMIN_REFRESH", "Refresh")} onClick={() => refetch()}>⟳</button>
            </div>
          </div>

          {rowsLoading ? (
            <div className="pgr-adm-empty"><Loader /></div>
          ) : isError ? (
            <div className="pgr-adm-empty" role="alert">
              {tr("ES_PGR_ADMIN_ERROR", "Something went wrong fetching complaints.")}{" "}
              <button className="pgr-adm-iconbtn" onClick={() => refetch()}>{tr("ES_PGR_ADMIN_RETRY", "Retry")}</button>
            </div>
          ) : rows.length === 0 ? (
            <div className="pgr-adm-empty">{tr("ES_PGR_ADMIN_NO_RESULTS", "No complaints found matching your criteria.")}</div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="pgr-adm-table">
                <thead>
                  <tr>
                    <th>{tr("CS_COMMON_COMPLAINT_NO", "Complaint No.")}</th>
                    <th>{tr("ES_PGR_ADMIN_HEADER_DEPARTMENT", "Department")}</th>
                    <th>{tr("CS_COMPLAINT_DETAILS_COMPLAINT_TYPE", "Category")}</th>
                    <th>{tr("CS_COMPLAINT_DETAILS_CURRENT_STATUS", "Status")}</th>
                    <th>{tr("ES_PGR_ADMIN_CREATED_DATE", "Created Date")}</th>
                    <th>{tr("ES_PGR_ADMIN_LAST_MODIFIED", "Last Modified")}</th>
                    <th>{tr("ES_PGR_ADMIN_ACTIONS", "Actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((w) => {
                    const s = w.service || {};
                    const dept = s?.additionalDetail?.department;
                    const deptLabel = !dept || dept === "NA" ? tr("ES_PGR_ADMIN_DEPT_NA", "No department (N/A)") : deptOptions.map[dept] || dept;
                    const statusKey = `CS_COMMON_${s.applicationStatus}`;
                    const statusLabel = tr(statusKey, s.applicationStatus);
                    const detailUrl = `/${window.contextPath}/employee/pgr/complaint-details/${s.serviceRequestId}`;
                    return (
                      <tr key={s.serviceRequestId}>
                        <td><Link to={detailUrl}>{s.serviceRequestId}</Link></td>
                        <td>{deptLabel}</td>
                        <td>{s.serviceCode}</td>
                        <td><span className={`pgr-adm-pill pgr-adm-pill--${bucketOf(s.applicationStatus)}`}>{statusLabel}</span></td>
                        <td>{fmtDate(s?.auditDetails?.createdTime)}</td>
                        <td>{fmtDate(s?.auditDetails?.lastModifiedTime)}</td>
                        <td><Link to={detailUrl}>👁 {tr("ES_PGR_ADMIN_VIEW", "View")}</Link></td>
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
              {tr("ES_PGR_ADMIN_OF", "of")} {total.toLocaleString()}{totalExact ? "" : "+"} {tr("ES_PGR_ADMIN_ENTRIES", "entries")}
            </div>
            <div className="pgr-adm-pages">
              <button className="pgr-adm-page" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>‹</button>
              {pageWindow.map((p) => (
                <button key={p} className={`pgr-adm-page ${p === page ? "pgr-adm-page--active" : ""}`} onClick={() => setPage(p)}>
                  {p + 1}
                </button>
              ))}
              <button className="pgr-adm-page" disabled={page >= totalPages - 1} onClick={() => setPage((p) => p + 1)}>›</button>
            </div>
            <div className="pgr-adm-pgsize">
              <span>{tr("ES_PGR_ADMIN_ROWS_PER_PAGE", "Rows per page")}</span>
              <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(0); }}>
                {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PGRAdminSearch;
