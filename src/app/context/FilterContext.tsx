"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

const YEAR = 2026;
const MONTH_KEYS: string[] = Array.from({ length: 12 }, (_, i) =>
  `${YEAR}-${String(i + 1).padStart(2, "0")}-01`
);

const QUARTER_MONTHS: Record<number, number[]> = {
  1: [1, 2, 3],
  2: [4, 5, 6],
  3: [7, 8, 9],
  4: [10, 11, 12],
};

function monthKeyToMonthIndex(key: string): number {
  const m = key.split("-")[1];
  return m ? parseInt(m, 10) : 0;
}

function monthIndexToKey(monthIndex: number): string {
  return `${YEAR}-${String(monthIndex).padStart(2, "0")}-01`;
}

export interface FilterState {
  selectedMonths: Set<string>;
  setSelectedMonths: (months: Set<string>) => void;
  selectMonth: (key: string) => void;
  deselectMonth: (key: string) => void;
  toggleMonth: (key: string) => void;
  selectQuarter: (q: 1 | 2 | 3 | 4) => void;
  deselectQuarter: (q: 1 | 2 | 3 | 4) => void;
  toggleQuarter: (q: 1 | 2 | 3 | 4) => void;
  selectAll: () => void;
  selectNone: () => void;
  reset: () => void;
  isMonthSelected: (key: string) => boolean;
  isQuarterSelected: (q: 1 | 2 | 3 | 4) => boolean;
  monthKeys: string[];
  year: number;
}

const defaultState: FilterState = {
  selectedMonths: new Set(),
  setSelectedMonths: () => {},
  selectMonth: () => {},
  deselectMonth: () => {},
  toggleMonth: () => {},
  selectQuarter: () => {},
  deselectQuarter: () => {},
  toggleQuarter: () => {},
  selectAll: () => {},
  selectNone: () => {},
  reset: () => {},
  isMonthSelected: () => false,
  isQuarterSelected: () => false,
  monthKeys: MONTH_KEYS,
  year: YEAR,
};

const FilterContext = createContext<FilterState>(defaultState);

export function FilterProvider({ children }: { children: ReactNode }) {
  const [selectedMonths, setSelectedMonths] = useState<Set<string>>(() => new Set(MONTH_KEYS));

  const selectMonth = useCallback((key: string) => {
    setSelectedMonths((prev) => new Set(prev).add(key));
  }, []);

  const deselectMonth = useCallback((key: string) => {
    setSelectedMonths((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  }, []);

  const toggleMonth = useCallback((key: string) => {
    setSelectedMonths((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const isQuarterFullySelected = useCallback((q: 1 | 2 | 3 | 4) => {
    return (current: Set<string>) => {
      const indices = QUARTER_MONTHS[q];
      return indices.every((m) => current.has(monthIndexToKey(m)));
    };
  }, []);

  const selectQuarter = useCallback((q: 1 | 2 | 3 | 4) => {
    const keys = QUARTER_MONTHS[q].map(monthIndexToKey);
    setSelectedMonths((prev) => {
      const next = new Set(prev);
      keys.forEach((k) => next.add(k));
      return next;
    });
  }, []);

  const deselectQuarter = useCallback((q: 1 | 2 | 3 | 4) => {
    const keys = QUARTER_MONTHS[q].map(monthIndexToKey);
    setSelectedMonths((prev) => {
      const next = new Set(prev);
      keys.forEach((k) => next.delete(k));
      return next;
    });
  }, []);

  const toggleQuarter = useCallback((q: 1 | 2 | 3 | 4) => {
    setSelectedMonths((prev) => {
      const keys = QUARTER_MONTHS[q].map(monthIndexToKey);
      const allSelected = keys.every((k) => prev.has(k));
      const next = new Set(prev);
      if (allSelected) keys.forEach((k) => next.delete(k));
      else keys.forEach((k) => next.add(k));
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelectedMonths(new Set(MONTH_KEYS));
  }, []);

  const selectNone = useCallback(() => {
    setSelectedMonths(new Set());
  }, []);

  const reset = useCallback(() => {
    setSelectedMonths(new Set(MONTH_KEYS));
  }, []);

  const setSelectedMonthsDirect = useCallback((months: Set<string>) => {
    setSelectedMonths(months);
  }, []);

  const isMonthSelected = useCallback((key: string) => selectedMonths.has(key), [selectedMonths]);

  const isQuarterSelected = useCallback(
    (q: 1 | 2 | 3 | 4) => isQuarterFullySelected(q)(selectedMonths),
    [selectedMonths, isQuarterFullySelected]
  );

  const value = useMemo<FilterState>(
    () => ({
      selectedMonths,
      setSelectedMonths: setSelectedMonthsDirect,
      selectMonth,
      deselectMonth,
      toggleMonth,
      selectQuarter,
      deselectQuarter,
      toggleQuarter,
      selectAll,
      selectNone,
      reset,
      isMonthSelected,
      isQuarterSelected,
      monthKeys: MONTH_KEYS,
      year: YEAR,
    }),
    [
      selectedMonths,
      setSelectedMonthsDirect,
      selectMonth,
      deselectMonth,
      toggleMonth,
      selectQuarter,
      deselectQuarter,
      toggleQuarter,
      selectAll,
      selectNone,
      reset,
      isMonthSelected,
      isQuarterSelected,
    ]
  );

  return <FilterContext.Provider value={value}>{children}</FilterContext.Provider>;
}

export function useFilter(): FilterState {
  const ctx = useContext(FilterContext);
  if (!ctx) throw new Error("useFilter must be used within FilterProvider");
  return ctx;
}

/** Normalize YYYY-MM or YYYY-MM-01 to YYYY-MM-01 for comparison. */
export function monthKeyFromSummary(monthOrKey: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(monthOrKey)) return monthOrKey;
  if (/^\d{4}-\d{2}$/.test(monthOrKey)) return `${monthOrKey}-01`;
  return monthOrKey;
}

export { MONTH_KEYS, QUARTER_MONTHS, monthKeyToMonthIndex, monthIndexToKey };
