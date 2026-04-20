import { useState, useCallback, useMemo, useEffect } from 'react';
import type { DigitColumn } from '../columns/types';

export interface UseColumnConfigOptions {
  resource: string;
  columns: DigitColumn[];
  alwaysVisibleSources?: string[];
  preferenceKey?: string;
}

export interface UseColumnConfigResult {
  visibleColumns: DigitColumn[];
  hiddenColumns: DigitColumn[];
  toggleColumn: (source: string) => void;
  resetColumns: () => void;
  isColumnHidden: (source: string) => boolean;
}

const getStorageKey = (preferenceKey?: string, resource?: string): string => {
  const key = preferenceKey ?? resource;
  return `digit-datagrid:${key}:columns`;
};

const loadHiddenColumns = (storageKey: string): Set<string> => {
  try {
    const stored = localStorage.getItem(storageKey);
    if (stored) {
      const parsed = JSON.parse(stored);
      return new Set(Array.isArray(parsed) ? parsed : []);
    }
  } catch (error) {
    console.warn('Failed to load column preferences:', error);
  }
  return new Set();
};

const saveHiddenColumns = (storageKey: string, hiddenSources: Set<string>): void => {
  try {
    localStorage.setItem(storageKey, JSON.stringify(Array.from(hiddenSources)));
  } catch (error) {
    console.warn('Failed to save column preferences:', error);
  }
};

export const useColumnConfig = ({
  resource,
  columns,
  alwaysVisibleSources = [],
  preferenceKey,
}: UseColumnConfigOptions): UseColumnConfigResult => {
  const storageKey = useMemo(() => getStorageKey(preferenceKey, resource), [preferenceKey, resource]);

  const [hiddenSources, setHiddenSources] = useState<Set<string>>(() => loadHiddenColumns(storageKey));

  // Sync to localStorage whenever hiddenSources changes
  useEffect(() => {
    saveHiddenColumns(storageKey, hiddenSources);
  }, [storageKey, hiddenSources]);

  const alwaysVisibleSet = useMemo(() => new Set(alwaysVisibleSources), [alwaysVisibleSources]);

  const toggleColumn = useCallback(
    (source: string) => {
      // Cannot toggle always-visible columns
      if (alwaysVisibleSet.has(source)) {
        return;
      }

      setHiddenSources((prev) => {
        const next = new Set(prev);
        if (next.has(source)) {
          next.delete(source);
        } else {
          next.add(source);
        }
        return next;
      });
    },
    [alwaysVisibleSet]
  );

  const resetColumns = useCallback(() => {
    setHiddenSources(new Set());
  }, []);

  const isColumnHidden = useCallback(
    (source: string): boolean => {
      return hiddenSources.has(source);
    },
    [hiddenSources]
  );

  const { visibleColumns, hiddenColumns } = useMemo(() => {
    const visible: DigitColumn[] = [];
    const hidden: DigitColumn[] = [];

    columns.forEach((column) => {
      if (hiddenSources.has(column.source)) {
        hidden.push(column);
      } else {
        visible.push(column);
      }
    });

    return { visibleColumns: visible, hiddenColumns: hidden };
  }, [columns, hiddenSources]);

  return {
    visibleColumns,
    hiddenColumns,
    toggleColumn,
    resetColumns,
    isColumnHidden,
  };
};
