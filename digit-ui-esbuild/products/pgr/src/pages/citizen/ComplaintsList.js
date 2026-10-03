/* eslint-disable react/prop-types */
// Citizen "My Complaints": the citizen's own complaints as an inbox, the way
// employees see theirs (#2223). A table on a desktop (Complaint No., Concern,
// Status, Filed on); on a phone, where a table doesn't fit, a list with the
// same facts per row. A search over the complaint number and the text
// (description, subcategory and category) narrows it, newest first, ten to a
// page. Any row opens the complaint.
//
// "Concern" is the complaint's subcategory with its description under it, cut
// to one line (two on a phone).

import React, { useEffect, useMemo, useState } from "react";
import { complaintLabel } from "../../utils/complaintLabel";
import { pageOf, searchComplaints, statusTone } from "../../utils/citizenComplaints";
import { trackEvent } from "../../utils/analytics";
import { useTranslation } from "react-i18next";
import { Link, useHistory, useRouteMatch } from "react-router-dom";

import { Loader } from "@egovernments/digit-ui-react-components";
import { Button, Card, Input } from "@egovernments/digit-ui-components-v2";
import { ChevronLeft, ChevronRight, FilePlus2, Inbox, Search } from "lucide-react";
import { LOCALE } from "../../constants/Localization";

const PAGE_SIZE = 10;
// pgr-services' largest page. The search runs over what this returns, so a
// citizen's complaints are fetched in one go rather than the default 100.
const FETCH_LIMIT = 200;
// The search and page, kept for the tab so Back from a complaint returns to
// the same view rather than the first page. Only Back, Forward and a reload
// restore it: opening My Complaints afresh starts clean.
const VIEW_KEY = "pgr.citizen.my-complaints.view";

function readView() {
  try {
    const saved = JSON.parse(window.sessionStorage.getItem(VIEW_KEY) || "null");
    return { query: typeof saved?.query === "string" ? saved.query : "", page: Number(saved?.page) || 1 };
  } catch {
    return { query: "", page: 1 };
  }
}

function StatusPill({ status, label }) {
  return <span className={`cms-status-pill is-${statusTone(status)}`}>{label}</span>;
}

function EmptyState({ icon, title, body, action }) {
  return (
    <Card
      style={{
        padding: "48px 24px",
        textAlign: "center",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "12px",
      }}
    >
      <span
        aria-hidden
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          height: "3rem",
          width: "3rem",
          borderRadius: "9999px",
          backgroundColor: "var(--color-primary-selected-bg, #FFF4D7)",
          color: "var(--color-primary-1, var(--color-primary-main, #c84c0e))",
        }}
      >
        {icon}
      </span>
      <h3 style={{ margin: 0, fontSize: "1.125rem", fontWeight: 600, color: "var(--color-text-heading, #363636)" }}>
        {title}
      </h3>
      {body ? (
        <p style={{ margin: 0, fontSize: "0.875rem", color: "var(--color-text-secondary, #6B7280)", maxWidth: "32rem" }}>
          {body}
        </p>
      ) : null}
      {action}
    </Card>
  );
}

export const ComplaintsList = () => {
  const User = Digit.UserService.getUser();
  const mobileNumber =
    User?.mobileNumber || User?.info?.mobileNumber || User?.info?.userInfo?.mobileNumber;
  const tenantId =
    Digit.SessionStorage.get("CITIZEN.COMMON.HOME.CITY")?.code ||
    Digit.ULBService.getCurrentTenantId();
  const { t } = useTranslation();
  const history = useHistory();
  const { path } = useRouteMatch();
  const { isLoading, error, data, revalidate } = Digit.Hooks.pgr.useComplaintsList(tenantId, {
    mobileNumber,
    limit: FETCH_LIMIT,
  });

  // The tenant's complaint types: each subcategory with its category
  // (menuPath), so a row can name both and the search can match either.
  const serviceDefs = Digit.Hooks.pgr.useServiceDefs(tenantId, "PGR");
  const defsByCode = useMemo(() => {
    const map = {};
    (serviceDefs || []).forEach((def) => {
      if (def?.serviceCode) map[def.serviceCode] = def;
    });
    return map;
  }, [serviceDefs]);

  const [initialView] = useState(() => (history.action === "POP" ? readView() : { query: "", page: 1 }));
  const [query, setQuery] = useState(initialView.query);
  const [page, setPage] = useState(initialView.page);

  useEffect(() => {
    revalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A new search starts from its first page; the one restored on return
  // keeps its page.
  const restoredQuery = React.useRef(query);
  useEffect(() => {
    if (query !== restoredQuery.current) setPage(1);
    restoredQuery.current = null;
  }, [query]);
  useEffect(() => {
    try {
      window.sessionStorage.setItem(VIEW_KEY, JSON.stringify({ query, page }));
    } catch {
      // Storage blocked: the view just isn't kept.
    }
  }, [query, page]);

  const tr = (key, fallback) => {
    const v = t(key);
    return v === key ? fallback : v;
  };

  const rows = useMemo(() => {
    const names = Digit.SessionStorage.get("complaintHierarchyNameByCode") || {};
    return (data?.ServiceWrappers || []).map(({ service }) => {
      const def = defsByCode[service.serviceCode];
      const createdTime = service.auditDetails?.createdTime || 0;
      const statusKey = `CS_COMMON_${service.applicationStatus}`;
      const statusLabel = t(statusKey);
      return {
        id: service.serviceRequestId,
        status: service.applicationStatus,
        statusLabel: statusLabel && statusLabel !== statusKey ? statusLabel : service.applicationStatus,
        concern: complaintLabel(t, service.serviceCode, def?.name || names[service.serviceCode]),
        category: def?.menuPath ? complaintLabel(t, def.menuPath, def.menuPathName) : "",
        description: service.description || "",
        createdTime,
        filedOn: createdTime ? Digit.DateUtils.ConvertTimestampToDate(createdTime) : "",
      };
    });
  }, [data, defsByCode, t]);

  const matches = useMemo(() => searchComplaints(rows, query), [rows, query]);
  const shown = pageOf(matches, page, PAGE_SIZE);
  const searching = query.trim().length > 0;

  const goCreate = () => history.push(`/${window.contextPath}/citizen/pgr/create-complaint`);
  const detailsUrl = (id) => `${path}/${id}`;
  const onOpen = (id, from) => trackEvent("pgr.my-complaints.open", { category: "pgr", label: from, value: searching ? 1 : 0 });
  const open = (id, from) => {
    onOpen(id, from);
    history.push(detailsUrl(id));
  };

  const count = rows.length;
  const countLabel =
    count === 1 ? tr("CS_MY_COMPLAINTS_COUNT_ONE", "1 complaint") : tr("CS_MY_COMPLAINTS_COUNT", "{count} complaints").replace("{count}", count);
  const range = tr("CS_MY_COMPLAINTS_RANGE", "{from}–{to} of {total}")
    .replace("{from}", shown.from)
    .replace("{to}", shown.to)
    .replace("{total}", shown.total);
  const headers = {
    number: tr("CS_MY_COMPLAINTS_COL_NUMBER", "Complaint No."),
    concern: tr("CS_MY_COMPLAINTS_COL_CONCERN", "Concern"),
    status: tr("CS_MY_COMPLAINTS_COL_STATUS", "Status"),
    filedOn: tr("CS_MY_COMPLAINTS_COL_FILED_ON", "Filed on"),
  };

  return (
    <div
      className="v2-scope cms-complaints"
      style={{
        display: "flex",
        flexDirection: "column",
        flex: "1 1 auto",
        minHeight: 0,
        width: "100%",
      }}
    >
      <header className="cms-complaints-head">
        <div className="cms-complaints-title">
          <h1>{tr(LOCALE.MY_COMPLAINTS, "My Complaints")}</h1>
          {count > 0 ? <span className="cms-complaints-count">{countLabel}</span> : null}
        </div>
        <Button onClick={goCreate} leading={<FilePlus2 className="h-4 w-4" />}>
          {tr("CS_COMMON_FILE_A_COMPLAINT", "File a Complaint")}
        </Button>
      </header>
      <div className="cms-complaints-body">
        {isLoading ? (
          <div style={{ padding: "32px 0" }}>
            <Loader />
          </div>
        ) : error ? (
          <EmptyState
            icon={<Inbox style={{ height: "1.5rem", width: "1.5rem" }} />}
            title={tr("CS_COMMON_ERROR_LOADING_TITLE", "Couldn't load your complaints")}
            body={tr(LOCALE.ERROR_LOADING_RESULTS, "Please try again in a moment.")}
            action={
              <Button variant="outline" onClick={revalidate}>
                {tr("CS_COMMON_RETRY", "Retry")}
              </Button>
            }
          />
        ) : count === 0 ? (
          <EmptyState
            icon={<Inbox style={{ height: "1.5rem", width: "1.5rem" }} />}
            title={tr("CS_NO_COMPLAINTS_TITLE", "No complaints yet")}
            body={tr(LOCALE.NO_COMPLAINTS, "You haven't filed any complaints. File one and we'll route it to the right team.")}
            action={
              <Button onClick={goCreate} leading={<FilePlus2 className="h-4 w-4" />}>
                {tr("CS_COMMON_FILE_A_COMPLAINT", "File a Complaint")}
              </Button>
            }
          />
        ) : (
          <>
            <div className="cms-complaints-search">
              <Search aria-hidden className="cms-complaints-search-icon" />
              <Input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onBlur={() => {
                  if (searching) trackEvent("pgr.my-complaints.search", { category: "pgr", value: matches.length });
                }}
                placeholder={tr("CS_MY_COMPLAINTS_SEARCH", "Search by complaint no. or text")}
                aria-label={tr("CS_MY_COMPLAINTS_SEARCH", "Search by complaint no. or text")}
                className="cms-complaints-search-field"
              />
            </div>
            {matches.length === 0 ? (
              <EmptyState
                icon={<Search style={{ height: "1.5rem", width: "1.5rem" }} />}
                title={tr("CS_MY_COMPLAINTS_NO_MATCH_TITLE", "No complaints match your search")}
                body={tr("CS_MY_COMPLAINTS_NO_MATCH_BODY", "Try a complaint number, or a word from the description.")}
                action={
                  <Button variant="outline" onClick={() => setQuery("")}>
                    {tr("CS_MY_COMPLAINTS_CLEAR_SEARCH", "Clear search")}
                  </Button>
                }
              />
            ) : (
              <div className="cms-complaints-card">
                <table className="cms-complaints-table">
                  <colgroup>
                    <col className="cms-complaints-col-number" />
                    <col />
                    <col className="cms-complaints-col-status" />
                    <col className="cms-complaints-col-date" />
                    <col className="cms-complaints-col-go" />
                  </colgroup>
                  <thead>
                    <tr>
                      <th scope="col">{headers.number}</th>
                      <th scope="col">{headers.concern}</th>
                      <th scope="col">{headers.status}</th>
                      <th scope="col">{headers.filedOn}</th>
                      <th scope="col" aria-hidden />
                    </tr>
                  </thead>
                  <tbody>
                    {shown.rows.map((row) => (
                      // The number is the link for the keyboard; the rest of
                      // the row takes the pointer there too.
                      <tr key={row.id} onClick={() => open(row.id, "table")}>
                        <td>
                          <Link
                            className="cms-complaints-number"
                            to={detailsUrl(row.id)}
                            onClick={(e) => {
                              e.stopPropagation();
                              onOpen(row.id, "table");
                            }}
                          >
                            {row.id}
                          </Link>
                        </td>
                        <td>
                          <div className="cms-complaints-concern" title={row.concern}>
                            {row.concern}
                          </div>
                          {row.description ? (
                            <div className="cms-complaints-desc" title={row.description}>
                              {row.description}
                            </div>
                          ) : null}
                        </td>
                        <td>
                          <StatusPill status={row.status} label={row.statusLabel} />
                        </td>
                        <td className="cms-complaints-date">{row.filedOn}</td>
                        <td className="cms-complaints-go" aria-hidden>
                          <ChevronRight />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <ul className="cms-complaints-list">
                  {shown.rows.map((row) => (
                    <li key={row.id}>
                      <Link className="cms-complaints-item" to={detailsUrl(row.id)} onClick={() => onOpen(row.id, "list")}>
                        <span className="cms-complaints-item-body">
                          <span className="cms-complaints-item-top">
                            <StatusPill status={row.status} label={row.statusLabel} />
                            <span className="cms-complaints-date">{row.filedOn}</span>
                          </span>
                          <span className="cms-complaints-concern">{row.concern}</span>
                          {row.description ? <span className="cms-complaints-desc">{row.description}</span> : null}
                          <span className="cms-complaints-number">{row.id}</span>
                        </span>
                        <ChevronRight aria-hidden className="cms-complaints-go" />
                      </Link>
                    </li>
                  ))}
                </ul>
                <div className="cms-complaints-pager">
                  <span>{range}</span>
                  {shown.pages > 1 ? (
                    <span className="cms-complaints-pager-buttons">
                      <button
                        type="button"
                        onClick={() => setPage(shown.page - 1)}
                        disabled={shown.page <= 1}
                        aria-label={tr("CS_COMMON_PREVIOUS", "Previous")}
                      >
                        <ChevronLeft aria-hidden />
                      </button>
                      <button
                        type="button"
                        onClick={() => setPage(shown.page + 1)}
                        disabled={shown.page >= shown.pages}
                        aria-label={tr("CS_COMMON_NEXT", "Next")}
                      >
                        <ChevronRight aria-hidden />
                      </button>
                    </span>
                  ) : null}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default ComplaintsList;
