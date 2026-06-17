import React from "react";
import { DATA_TABLE_STYLES } from "../config/dataTablePresentation";

/**
 * Shared chrome for data-table widgets with custom headers (title + optional controls).
 * Standard grid tables use WidgetHeader + DashboardGrid body wiring instead.
 */
const DataTableChrome = ({
  title,
  headerActions = null,
  bodyClassName,
  scrollable = true,
  children,
  footer = null,
}) => {
  const styles = DATA_TABLE_STYLES;

  return (
    <div className={styles.shell}>
      <header className={`${styles.headerChrome} dashboard-drag-handle`}>
        <h2 className={styles.title}>{title}</h2>
        {headerActions}
      </header>
      <div className={bodyClassName ?? styles.body}>
        {scrollable ? <div className={styles.scroll}>{children}</div> : children}
      </div>
      {footer}
    </div>
  );
};

export default DataTableChrome;
