import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import _ from "lodash";
import { Card, Loader } from "../atoms";
import { CustomSVG } from "../atoms";
import DataTable from "react-data-table-component";
import CheckBox from "../atoms/CheckBox";
import { dataTableCustomStyles } from "../constants/styles/dataTableCustomStyles";
import { SVG } from "../atoms";
import CardLabel from "../atoms/CardLabel";
import Button from "../atoms/Button";
import TextInput from "../atoms/TextInput";

// The card styling lives in the stylesheet behind `(max-width: 47.99rem)`, so
// the query is the single source of truth for where the cards begin. A px
// constant here would diverge from it at any root font size other than 16px:
// at a 12px root, 47.99rem is 575px, and a 700px window would render cards
// that none of the card rules matched.
const MOBILE_MEDIA_QUERY = "(max-width: 47.99rem)";

// react-data-table-component's own resolution, verbatim from the 7.6.2 Cell:
//   cell ? cell(row, i, column, id)
//        : selector ? (format ? format(row, i) : selector(row, i))
//                   : null
// `format` is consulted only when a `selector` exists, and is ignored entirely
// when `cell` is present. Worth matching rather than approximating: this
// molecule is exported publicly, and a column configured with `format` alone
// renders blank in the table, so the card has to render blank too.
const renderCellContent = (column, row, index) => {
  if (typeof column?.cell === "function") {
    return column.cell(row, index, column, column?.id);
  }
  if (typeof column?.selector !== "function") return null;
  if (typeof column?.format === "function") return column.format(row, index);
  return column.selector(row, index);
};

// rdt binds row events on the row but fires them only when the *click target*
// carries this attribute, and it tags a cell's content wrapper only for columns
// that have no `cell` renderer. The synthetic card column is all `cell`, so
// unless the card tags its own fields the row handler can never fire: the one
// tagged element left is the `rdt_TableCell`, and the card covers it edge to
// edge. Mirrors rdt's own rule, which is also the real expression of
// `ignoreRowClick` — omit the tag rather than fight the event:
//   dataTag: column.ignoreRowClick || column.button ? null : "allowRowEvents"
const ROW_EVENT_TAG = "allowRowEvents";
const rowEventTag = (column) =>
  column?.ignoreRowClick || column?.button ? undefined : ROW_EVENT_TAG;

const ResultsDataTable = ({
  data,
  columns,
  showCheckBox,
  selectProps,
  onSelectedRowsChange,
  onRowClicked,
  selectableRowsNoSelectAll,
  expandableRows,
  expandableRowsComponent,
  progressPending,
  progressComponent,
  conditionalRowStyles,
  paginationRowsPerPageOptions,
  onChangePage,
  paginationPerPage,
  paginationDefaultPage,
  onChangeRowsPerPage,
  paginationTotalRows,
  isPaginationRequired,
  defaultSortFieldId,
  defaultSortAsc,
  sortServer,
  onSort,
  tableClassName,
  onRowExpandToggled,
  showTableDescription,
  showTableTitle,
  enableGlobalSearch,
  showSelectedState,
  selectedRows,
  actions,
  searchHeader,
  onSearch,
  handleActionSelect,
  showSelectedStatePosition = "top",
  rowsPerPageText,
  paginationComponentOptions
}) => {
  const { t } = useTranslation();

  // A multi-column table cannot fit a narrow viewport. Below the breakpoint the
  // same rows render as stacked cards instead — one synthetic column holding
  // the whole record, so react-data-table-component keeps owning pagination,
  // the pending state, row selection and row clicks. Labels come from the
  // column configs themselves, which are already translated (`name:
  // t(column.label)` in ResultsDataTableWrapper), so the cards stay localised
  // for free, and every field carries its label — this molecule is shared, and
  // nothing here can know which column a given consumer treats as the record's
  // identity.
  const [isMobileView, setIsMobileView] = useState(
    () =>
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia(MOBILE_MEDIA_QUERY).matches
  );
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return undefined;
    const mql = window.matchMedia(MOBILE_MEDIA_QUERY);
    const onChange = (e) => setIsMobileView(e.matches);
    setIsMobileView(mql.matches);
    // Safari < 14 only has the deprecated add/removeListener pair.
    if (mql.addEventListener) {
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    }
    mql.addListener(onChange);
    return () => mql.removeListener(onChange);
  }, []);

  const mobileColumns = useMemo(
    () => [
      {
        id: "digit-results-mobile-card",
        name: "",
        grow: 1,
        cell: (row, index) => (
          // The card's own whitespace is tagged so a tap in the gaps between
          // fields still opens the record, the way a tap anywhere in a table
          // row does.
          <div className="digit-results-mobile-card" data-tag={ROW_EVENT_TAG}>
            {(columns || []).map((column, columnIndex) => {
              const content = renderCellContent(column, row, index);
              if (content === null || content === undefined || content === "")
                return null;
              // Absent on a column that opted out, which is precisely how rdt
              // keeps the row handler off an action cell.
              const tag = rowEventTag(column);
              return (
                <div
                  className="digit-results-mobile-card-row"
                  key={column?.id || columnIndex}
                  data-tag={tag}
                >
                  {/* The tag has to sit on what the finger actually lands on:
                      the handler reads `e.target`, not the bubbling path. */}
                  <span className="digit-results-mobile-card-label" data-tag={tag}>
                    {column?.name}
                  </span>
                  <span className="digit-results-mobile-card-value" data-tag={tag}>
                    {content}
                  </span>
                </div>
              );
            })}
          </div>
        ),
      },
    ],
    [columns]
  );

  const renderTable = () => {
    return (
      <DataTable
        data={data}
        columns={isMobileView ? mobileColumns : columns}
        noTableHead={isMobileView}
        responsive={true}
        sortIcon={
          <CustomSVG.SortUp width={"16px"} height={"16px"} fill={"#0b4b66"} />
        }
        selectableRows={showCheckBox}
        selectableRowsHighlight={true}
        selectableRowsComponent={CheckBox}
        selectableRowsComponentProps={selectProps}
        onSelectedRowsChange={onSelectedRowsChange}
        onRowClicked={onRowClicked}
        selectableRowsNoSelectAll={selectableRowsNoSelectAll}
        expandableRows={expandableRows}
        expandableRowsComponent={expandableRowsComponent}
        expandableIcon={{
          expanded: (
            <SVG.ArrowBackIos
              fill={"#363636"}
              width={"16px"}
              height={"16px"}
              style={{ transform: "rotate(-90deg)" }}
            ></SVG.ArrowBackIos>
          ),
          collapsed: (
            <SVG.ArrowBackIos
              fill={"#363636"}
              width={"16px"}
              height={"16px"}
              style={{ transform: "rotate(-180deg)" }}
            ></SVG.ArrowBackIos>
          ),
        }}
        onRowExpandToggled={onRowExpandToggled}
        progressPending={progressPending}
        progressComponent={progressComponent || <Loader />}
        customStyles={dataTableCustomStyles}
        conditionalRowStyles={conditionalRowStyles}
        className={
          tableClassName
            ? `digit-data-table ${showCheckBox ? "selectable" : "unselectable"} ${tableClassName}`
            : `digit-data-table ${showCheckBox ? "selectable" : "unselectable"}`
        }
        defaultSortFieldId={defaultSortFieldId}
        defaultSortAsc={defaultSortAsc}
        sortServer={sortServer}
        onSort={onSort}
        pagination={
          isPaginationRequired !== undefined ? isPaginationRequired : true
        }
        paginationServer
        paginationTotalRows={paginationTotalRows}
        onChangeRowsPerPage={onChangeRowsPerPage}
        paginationDefaultPage={paginationDefaultPage}
        paginationPerPage={paginationPerPage}
        onChangePage={onChangePage}
        paginationRowsPerPageOptions={
          paginationRowsPerPageOptions || [10, 20, 30, 40, 50]
        }
        noContextMenu
        fixedHeader={true}
        fixedHeaderScrollHeight={"100vh"}
        paginationComponentOptions={{
          ...paginationComponentOptions,
          rowsPerPageText: rowsPerPageText || t("ROWS_PER_PAGE"),
        }}
      />
    );
  };

  const renderSelectedState = () => {
    if (showSelectedState && selectedRows.length > 0) {
      return (
        <div className="selection-state-wrapper">
          <div className="svg-state-wrapper">
            <SVG.DoneAll
              width={"1.5rem"}
              height={"1.5rem"}
              fill={"#C84C0E"}
            ></SVG.DoneAll>
            <div className={"selected-state"}>{`${selectedRows.length} ${t(
              "ROWS_SELECTED"
            )}`}</div>
          </div>
          {actions?.length > 0 ? (
            <div className="digit-dataTable-actions-container">
              {actions.map((action, index) => (
                <Button
                  key={index}
                  variation={action?.variation || "primary"}
                  label={action?.label || `Action ${index + 1}`}
                  type={action?.type || "button"}
                  size={action?.size || "medium"}
                  icon={action?.icon}
                  onClick={() =>
                    handleActionSelect(index, action.label, selectedRows)
                  }
                  {...action}
                />
              ))}
            </div>
          ) : null}
        </div>
      );
    } else {
      return null;
    }
  };

  return (
    // The modifier, not `:has()`, is what the card styling keys off. Both
    // halves of the layout then switch on one signal: an engine without
    // `:has()` support (Chromium < 105, Firefox < 121, Safari < 15.4) would
    // otherwise collapse the columns in JS while every card rule dropped out,
    // leaving unstyled fields inside the old table chrome.
    <Card
      className={`digit-table-card${
        isMobileView ? " digit-table-card-as-cards" : ""
      }`}
    >
      {(showTableDescription || showTableTitle || enableGlobalSearch) && (
        <div className="table-header-wrapper">
          <div className="header-filter-wrapper">
            {showTableTitle && (
              <div className="table-header">{t(showTableTitle)}</div>
            )}
          </div>
          {showTableDescription && (
            <div className="table-description">{t(showTableDescription)}</div>
          )}
          <div className="digit-global-search-results-table-wrapper">
            {enableGlobalSearch && (
              <CardLabel className="digit-global-search-results-table-header">
                {t(searchHeader) || t("Filter Table Records")}
              </CardLabel>
            )}
            {enableGlobalSearch && (
              <div className="digit-global-search-results-table">
                <TextInput
                  type="search"
                  onChange={(e) => onSearch(e.target.value)}
                  placeholder={t("Search")}
                ></TextInput>
              </div>
            )}
          </div>
        </div>
      )}
      {showSelectedStatePosition === "top" && renderSelectedState()}
      {renderTable()}
      {showSelectedStatePosition === "bottom" && renderSelectedState()}
    </Card>
  );
};

export default ResultsDataTable;
