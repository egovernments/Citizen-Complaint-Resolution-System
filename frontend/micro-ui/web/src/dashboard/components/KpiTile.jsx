import React from 'react';

/**
 * Generic viz-agnostic tile renderer.
 * Reads def.viz (from the backend catalog) to decide how to render.
 * Reads result.columns[].role to find dimensions vs measures.
 * Zero hardcoded column names, zero hardcoded format assignments.
 *
 * Props:
 * - def: tile descriptor from catalog (has viz, titleKey, kpiId)
 * - result: data from /_query for this kpiId ({ columns, rows, value, asOf, scope })
 * - error: error object from errors map { code, message } | null
 * - vizOverride: optional user-chosen viz type (table/bar/etc)
 */
export function KpiTile({ def, result, error, vizOverride }) {
  if (error) {
    return (
      <div className="kpi-tile kpi-tile--error">
        <span className="kpi-tile__error-code">{error.code || 'ERROR'}</span>
        <span className="kpi-tile__error-msg">{error.message || 'Failed to load'}</span>
      </div>
    );
  }

  if (!result) {
    return <div className="kpi-tile kpi-tile--loading"><div className="kpi-tile__skeleton" /></div>;
  }

  const viz = def?.viz || {};
  const kind = vizOverride || viz.kind || 'scalar';
  const { columns = [], rows = [], value, values, asOf, scope } = result;

  const dims = columns.filter(c => c.role === 'dimension');
  const measures = columns.filter(c => c.role === 'measure');

  const content = (() => {
    switch (kind) {
      case 'scalar': {
        const val = value ?? (values && Object.values(values)[0]) ?? (rows[0] && rows[0][viz.valueKey]);
        return <ScalarDisplay value={val} format={viz.format} accent={viz.accent} />;
      }
      case 'bar':
      case 'line':
      case 'area': {
        return <SeriesDisplay rows={rows} dimKey={dims[0]?.name || viz.dimensionKey} measures={measures} kind={kind} />;
      }
      case 'rankedList': {
        return <RankedListDisplay rows={rows} dimKey={dims[0]?.name || viz.dimensionKey} measure={measures[0]} />;
      }
      case 'dow': {
        return <DowDisplay rows={rows} dimKey={dims[0]?.name || viz.dimensionKey || 'created_dow'} measure={measures[0]} />;
      }
      case 'map': {
        return <MapPlaceholder />;  // map viz is unimplemented (hot-ward tiles are queryKey:null)
      }
      default: {
        return <TableDisplay columns={columns} rows={rows} />;
      }
    }
  })();

  return (
    <div className={`kpi-tile kpi-tile--${kind}`} data-accent={viz.accent}>
      {content}
      {asOf && <span className="kpi-tile__asof">as of {formatAsOf(asOf)}</span>}
      {scope && scope.boundaryPrefixes && (
        <span className="kpi-tile__scope">{scope.boundaryPrefixes.join(', ')}</span>
      )}
    </div>
  );
}

/** Applies the format spec from the catalog to a scalar value. */
function applyFormat(val, format) {
  if (val == null) return '—';
  switch (format) {
    case 'integer':           return Math.round(val).toLocaleString();
    case 'percentInteger':    return `${Math.round(val * 100)}%`;
    case 'percentOneDecimal': return `${(val * 100).toFixed(1)}%`;
    case 'percentNoDecimal':  return `${Math.round(val * 100)}%`;
    case 'decimalOne':        return Number(val).toFixed(1);
    case 'decimalTwo':        return Number(val).toFixed(2);
    case 'hoursDays': {
      const ms = Number(val);
      const days = Math.floor(ms / 86400000);
      const hrs  = Math.floor((ms % 86400000) / 3600000);
      return days > 0 ? `${days}d ${hrs}h` : `${hrs}h`;
    }
    case 'hoursDecimal': return `${(Number(val) / 3600000).toFixed(1)}h`;
    case 'ordinal': {
      const n = Math.round(val);
      const s = ['th','st','nd','rd'];
      const v = n % 100;
      return n + (s[(v - 20) % 10] || s[v] || s[0]);
    }
    case 'signedInteger': return `${val >= 0 ? '+' : ''}${Math.round(val).toLocaleString()}`;
    default: return String(val);
  }
}

function ScalarDisplay({ value, format, accent }) {
  return (
    <div className="kpi-scalar" data-accent={accent}>
      <span className="kpi-scalar__value">{applyFormat(value, format)}</span>
    </div>
  );
}

function SeriesDisplay({ rows, dimKey, measures, kind }) {
  // Minimal implementation — real charting library integration left to UI work
  return (
    <div className="kpi-series">
      <table>
        <thead>
          <tr>
            <th>{dimKey}</th>
            {measures.map(m => <th key={m.name}>{m.name}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 10).map((row, i) => (
            <tr key={i}>
              <td>{row[dimKey]}</td>
              {measures.map(m => <td key={m.name}>{applyFormat(row[m.name], m.format)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RankedListDisplay({ rows, dimKey, measure }) {
  return (
    <ol className="kpi-ranked-list">
      {rows.slice(0, 10).map((row, i) => (
        <li key={i}>
          <span className="kpi-ranked-list__label">{row[dimKey]}</span>
          <span className="kpi-ranked-list__value">{applyFormat(row[measure?.name], measure?.format)}</span>
        </li>
      ))}
    </ol>
  );
}

function DowDisplay({ rows, dimKey, measure }) {
  const DOW_LABELS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  return (
    <div className="kpi-dow">
      {rows.map((row, i) => (
        <div key={i} className="kpi-dow__bar">
          <span>{DOW_LABELS[row[dimKey]] || row[dimKey]}</span>
          <span>{applyFormat(row[measure?.name], measure?.format)}</span>
        </div>
      ))}
    </div>
  );
}

function TableDisplay({ columns, rows }) {
  return (
    <table className="kpi-table">
      <thead><tr>{columns.map(c => <th key={c.name}>{c.name}</th>)}</tr></thead>
      <tbody>
        {rows.slice(0, 20).map((row, i) => (
          <tr key={i}>{columns.map(c => <td key={c.name}>{applyFormat(row[c.name], c.format)}</td>)}</tr>
        ))}
      </tbody>
    </table>
  );
}

function MapPlaceholder() {
  return <div className="kpi-map-placeholder">Map visualization (pending boundary query support)</div>;
}

function formatAsOf(asOf) {
  try { return new Date(asOf).toLocaleTimeString(); } catch { return asOf; }
}
