import React, { useMemo } from "react";
import { getBrandTheme } from "../config/dashboardConfig";
import Sidebar from "./Sidebar";
import Navbar from "./Navbar";

const DashboardLayout = ({
  children,
  onResetLayout,
  visibleKpiIds,
  onAddKpi,
  onDragKpiStart,
  onDragKpiEnd,
  subMetricValues,
  getSubMetricId,
  asOf,
}) => {
  const brandStyle = useMemo(() => {
    const theme = getBrandTheme();
    return {
      "--brand-teal": theme.teal,
      "--brand-dark": theme.dark,
      "--brand-slate": theme.slate,
    };
  }, []);

  return (
    <div
      className="tw-flex tw-h-screen tw-overflow-hidden tw-bg-slate-100"
      style={brandStyle}
    >
      <Sidebar
        visibleKpiIds={visibleKpiIds}
        onAddKpi={onAddKpi}
        onDragKpiStart={onDragKpiStart}
        onDragKpiEnd={onDragKpiEnd}
        subMetricValues={subMetricValues}
        getSubMetricId={getSubMetricId}
      />
      <div className="tw-flex tw-min-w-0 tw-flex-1 tw-flex-col">
        <Navbar onResetLayout={onResetLayout} asOf={asOf} />
        <main className="tw-flex-1 tw-overflow-auto tw-p-6">{children}</main>
      </div>
    </div>
  );
};

export default DashboardLayout;
