import React from "react";
import {
  getNumberTileValueClass,
  VISUALIZATION_STYLES,
  VIZ_TYPE,
} from "../config/visualizationStyles";
import ResizeGrip from "./ResizeGrip";

const numberTile = VISUALIZATION_STYLES[VIZ_TYPE.NUMBER_TILE];

const RemoveIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="tw-h-3.5 tw-w-3.5"
    aria-hidden="true"
  >
    <path d="M18 6 6 18" />
    <path d="m6 6 12 12" />
  </svg>
);

const KpiCard = ({
  title,
  value,
  context,
  status,
  listItems = [],
  hasList = false,
  loading = false,
  onRemove,
}) => {
  const isUnavailable = value === "—";
  const displayValue = value ?? (loading ? "…" : "—");
  const valueClass = getNumberTileValueClass(status, { unavailable: isUnavailable });

  return (
    <div
      className={`${numberTile.card} tw-group${
        hasList
          ? " tw-flex tw-h-full tw-min-h-0 tw-flex-col"
          : ` ${numberTile.cardMetric}`
      }`}
    >
      {onRemove ? (
        <button
          type="button"
          title="Remove from dashboard"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={onRemove}
          className="dashboard-widget-remove-btn"
          aria-label={`Remove ${title}`}
        >
          <RemoveIcon />
        </button>
      ) : null}

      <div className={numberTile.title} title={title}>
        {title}
      </div>

      <div
        className={`${numberTile.value} ${valueClass} ${
          loading ? numberTile.valueLoading : ""
        }`}
      >
        {displayValue}
      </div>

      {!hasList ? (
        <div className={numberTile.context}>{context || "\u00A0"}</div>
      ) : context ? (
        <div className={`${numberTile.context} tw-mt-2`}>{context}</div>
      ) : null}

      {hasList ? (
        <div className="dashboard-kpi-list-body tw-mt-2 tw-min-h-0 tw-flex-1 tw-overflow-y-auto">
          {listItems.length > 0 ? (
            <ol className="dashboard-kpi-list tw-m-0 tw-list-none tw-space-y-1 tw-p-0">
              {listItems.map((item) => (
                <li
                  key={`${item.rank}-${item.label}`}
                  className="dashboard-kpi-list-item tw-flex tw-items-center tw-justify-between tw-gap-2 tw-rounded-sm tw-bg-muted tw-px-2 tw-py-1.5"
                >
                  <div className="tw-flex tw-min-w-0 tw-items-center tw-gap-1.5">
                    <span className="tw-flex tw-h-4 tw-w-4 tw-shrink-0 tw-items-center tw-justify-center tw-rounded-full tw-bg-muted tw-text-[9px] tw-font-bold tw-text-foreground">
                      {item.rank}
                    </span>
                    <span
                      className="tw-min-w-0 tw-truncate tw-text-[12px] tw-text-foreground"
                      title={item.label}
                    >
                      {item.label}
                    </span>
                  </div>
                  <span className="tw-shrink-0 tw-text-[12px] tw-font-semibold tw-tabular-nums tw-text-foreground">
                    {item.value}
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="tw-text-[12px] tw-text-muted-foreground">
              {loading ? "Loading…" : "No list data"}
            </p>
          )}
        </div>
      ) : null}

      <ResizeGrip />
    </div>
  );
};

export default KpiCard;
