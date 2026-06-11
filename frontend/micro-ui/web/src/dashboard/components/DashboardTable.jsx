import React from "react";

const TrendCell = ({ value }) => {
  if (value == null || !Number.isFinite(value)) {
    return <span className="dashboard-table-muted">—</span>;
  }
  const up = value >= 0;
  return (
    <span className={up ? "dashboard-table-trend-up" : "dashboard-table-trend-down"}>
      {up ? "↑" : "↓"}
      {Math.abs(value).toFixed(1)}%
    </span>
  );
};

const formatPercent = (value, decimals = 1) => {
  if (value == null || !Number.isFinite(value)) return "—";
  const pct = value <= 1 ? value * 100 : value;
  return `${pct.toFixed(decimals)}%`;
};

const formatHours = (ms) => {
  if (ms == null || !Number.isFinite(ms)) return "—";
  const hours = ms / 3600000;
  return `${hours.toFixed(1)}h`;
};

const formatInteger = (value) => {
  if (value == null || !Number.isFinite(value)) return "—";
  return String(Math.round(value));
};

const CELL_RENDERERS = {
  text: (value) => value ?? "—",
  integer: (value) => formatInteger(value),
  percent: (value) => formatPercent(value),
  hours: (value) => formatHours(value),
  trend: (value) => <TrendCell value={value} />,
};

const DashboardTable = ({ columns, rows }) => {
  if (!rows?.length) {
    return (
      <p className="dashboard-table-empty tw-text-[10px] tw-text-slate-500">No data</p>
    );
  }

  return (
    <div className="dashboard-table-wrap">
      <table className="dashboard-table">
        <colgroup>
          {columns.map((col) => (
            <col key={col.id} style={col.width ? { width: col.width } : undefined} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {columns.map((col) => (
              <th
                key={col.id}
                className={col.align === "right" ? "dashboard-table-th-right" : undefined}
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr
              key={row.id ?? rowIndex}
              className={row.highlight ? "dashboard-table-row-highlight" : undefined}
            >
              {columns.map((col) => {
                const raw = row[col.id];
                const isLabel = col.id === "label";
                const render = CELL_RENDERERS[col.type] ?? CELL_RENDERERS.text;
                const content = col.type === "trend" ? render(raw) : render(raw);
                const labelText = typeof raw === "string" ? raw : String(raw ?? "");

                return (
                  <td
                    key={col.id}
                    className={col.align === "right" ? "dashboard-table-td-right" : undefined}
                  >
                    {isLabel ? (
                      <span className="dashboard-table-primary" title={labelText}>
                        <span className="dashboard-table-label">{content}</span>
                        {row.badge ? (
                          <span className="dashboard-table-badge">{row.badge}</span>
                        ) : null}
                      </span>
                    ) : (
                      content
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default DashboardTable;
