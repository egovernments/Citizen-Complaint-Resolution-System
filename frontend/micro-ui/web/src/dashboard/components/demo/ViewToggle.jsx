import React from "react";

const ViewToggle = ({ value, onChange, options }) => (
  <div className="dashboard-view-toggle tw-inline-flex tw-overflow-hidden tw-rounded-sm tw-border tw-border-border">
    {options.map((opt) => {
      const active = value === opt.id;
      return (
        <button
          key={opt.id}
          type="button"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={() => onChange(opt.id)}
          className={
            active
              ? "tw-border-0 tw-bg-chrome tw-px-2.5 tw-py-1 tw-text-[11px] tw-font-medium tw-text-chrome-foreground"
              : "tw-border-0 tw-bg-surface tw-px-2.5 tw-py-1 tw-text-[11px] tw-font-medium tw-text-muted-foreground hover:tw-text-foreground"
          }
        >
          {opt.label}
        </button>
      );
    })}
  </div>
);

export default ViewToggle;
