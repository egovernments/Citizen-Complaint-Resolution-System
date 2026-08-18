import React, { useMemo, useState } from "react";
import { normalizeStringList } from "../utils/multiSelectFilters";
import PopoverMenu, {
  PopoverMenuGroupLabel,
  PopoverMenuItem,
} from "./ui/PopoverMenu";

export const MultiSelectChip = ({ label, count }) => (
  <span className="dashboard-multiselect-trigger-content">
    <span className="dashboard-multiselect-trigger-label">{label}</span>
    {count > 0 && (
      <span className="dashboard-multiselect-count" aria-hidden>
        {count}
      </span>
    )}
  </span>
);

const normalizedSearch = (value) =>
  String(value ?? "")
    .trim()
    .toLocaleLowerCase();

const MultiSelectPanel = ({
  options,
  values,
  searchable,
  searchPlaceholder,
  allLabel,
  applyLabel,
  cancelLabel,
  emptyLabel,
  onApply,
  close,
}) => {
  const [draft, setDraft] = useState(() => normalizeStringList(values));
  const [search, setSearch] = useState("");
  const query = normalizedSearch(search);
  const visible = useMemo(
    () =>
      options.filter(
        (option) => !query || normalizedSearch(option.label).includes(query)
      ),
    [options, query]
  );
  const selected = new Set(draft);
  const toggle = (id) => {
    setDraft((current) =>
      current.includes(id)
        ? current.filter((value) => value !== id)
        : [...current, id]
    );
  };

  const rows = [];
  let lastGroup = null;
  for (const option of visible) {
    if (option.group && option.group !== lastGroup) {
      rows.push(
        <PopoverMenuGroupLabel key={`group-${option.group}`}>
          {option.group}
        </PopoverMenuGroupLabel>
      );
    }
    lastGroup = option.group || null;
    rows.push(
      <PopoverMenuItem
        key={option.id}
        selected={selected.has(option.id)}
        multiple
        title={option.label}
        onSelect={() => toggle(option.id)}
      >
        {option.label}
      </PopoverMenuItem>
    );
  }

  return (
    <div className="dashboard-multiselect-panel">
      {searchable && (
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          onKeyDown={(event) => {
            if (
              ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
            ) {
              event.stopPropagation();
            }
          }}
          placeholder={searchPlaceholder}
          aria-label={searchPlaceholder}
          className="dashboard-multiselect-search"
          data-popover-autofocus=""
          autoFocus
        />
      )}
      <div className="dashboard-popover-list dashboard-multiselect-options">
        {rows.length ? (
          rows
        ) : (
          <div className="dashboard-multiselect-empty">{emptyLabel}</div>
        )}
      </div>
      <div className="dashboard-multiselect-footer">
        <button
          type="button"
          className="dashboard-multiselect-clear"
          onClick={() => setDraft([])}
        >
          {allLabel}
        </button>
        <span className="dashboard-multiselect-footer-actions">
          <button
            type="button"
            className="dashboard-multiselect-cancel"
            onClick={() => close()}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className="dashboard-multiselect-apply"
            onClick={() => {
              onApply(draft);
              close();
            }}
          >
            {applyLabel}
          </button>
        </span>
      </div>
    </div>
  );
};

const MultiSelectFilter = ({
  options = [],
  values = [],
  label,
  allLabel,
  ariaLabel,
  loading = false,
  searchable = false,
  searchPlaceholder,
  applyLabel,
  cancelLabel,
  emptyLabel,
  onChange,
}) => {
  const choices = options.filter((option) => option.id !== "all");
  const count = normalizeStringList(values).length;
  return (
    <PopoverMenu
      ariaLabel={ariaLabel}
      chip={<MultiSelectChip label={count ? label : allLabel} count={count} />}
      chipTitle={count ? `${label}: ${count}` : allLabel}
      disabled={loading}
      panelWidth={300}
      chipClassName={count ? "dashboard-popover-trigger--active" : ""}
    >
      {({ close }) => (
        <MultiSelectPanel
          options={choices}
          values={values}
          searchable={searchable}
          searchPlaceholder={searchPlaceholder}
          allLabel={allLabel}
          applyLabel={applyLabel}
          cancelLabel={cancelLabel}
          emptyLabel={emptyLabel}
          onApply={onChange}
          close={close}
        />
      )}
    </PopoverMenu>
  );
};

export default MultiSelectFilter;
