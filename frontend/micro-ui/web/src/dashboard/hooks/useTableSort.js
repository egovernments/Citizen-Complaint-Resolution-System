import { useCallback, useState } from "react";
import { getDefaultSortDirection, sortTableRows } from "../utils/tableSort";

export default function useTableSort(columns, { defaultKey, defaultDirection } = {}) {
  const [sortState, setSortState] = useState(() => {
    if (!defaultKey) {
      return { key: null, direction: "asc" };
    }
    const column = columns.find((entry) => entry.id === defaultKey);
    return {
      key: defaultKey,
      direction: defaultDirection ?? getDefaultSortDirection(column),
    };
  });

  const handleSort = useCallback(
    (key) => {
      const column = columns.find((entry) => entry.id === key);
      setSortState((current) => {
        if (current.key !== key) {
          return { key, direction: getDefaultSortDirection(column) };
        }
        return {
          key,
          direction: current.direction === "asc" ? "desc" : "asc",
        };
      });
    },
    [columns]
  );

  const sortRows = useCallback(
    (rows) => sortTableRows(rows, columns, sortState),
    [columns, sortState]
  );

  return { sortState, handleSort, sortRows };
}
