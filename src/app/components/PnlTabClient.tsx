"use client";

import {
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import type { PnlEntity, PnlSnapshot } from "@/app/actions/pnl";
import { useFilter } from "@/app/context/FilterContext";
import {
  getCachedPnlSnapshot,
  getPnlSnapshotFromClientCache,
  getPnlViewState,
  prefetchOtherEntitiesForMonths,
  prefetchPnlSnapshot,
  revalidatePnlSnapshot,
  setActivePnlEntity,
  setPnlViewState,
  snapshotsEqual,
} from "@/lib/pnl-client-cache";
import PnlView from "./PnlView";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const FETCH_DEBOUNCE_MS = 160;
const PNL_DEBUG = process.env.NEXT_PUBLIC_PNL_DEBUG === "1";

function monthKeyToLabel(key: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(key);
  if (!m) return key;
  const mi = parseInt(m[2]!, 10) - 1;
  const y = m[1]!;
  if (mi >= 0 && mi < 12) return `${MONTH_NAMES[mi]} ${y}`;
  return key;
}

function selectedMonthKeys(selected: Set<string>): string[] {
  const keys = [...selected].filter(Boolean).sort();
  return keys;
}

function selectedMonthsLabel(keys: string[]): string {
  if (keys.length === 0) return "Select a month";
  if (keys.length === 1) return monthKeyToLabel(keys[0]!);
  const labels = keys.map((key) => monthKeyToLabel(key).replace(" 2026", ""));
  return `Consolidated view for ${labels.join(", ")} 2026`;
}

function currentMonthKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
}

function primaryInitialMonth(keys: string[]): string {
  const current = currentMonthKey();
  return keys.includes(current) ? current : keys[keys.length - 1]!;
}

function PnlTabClient() {
  const { selectedMonths } = useFilter();
  const selectedKeys = useMemo(() => selectedMonthKeys(selectedMonths), [selectedMonths]);
  const deferredKeys = useDeferredValue(selectedKeys);
  const monthsKey = useMemo(() => deferredKeys.join("|"), [deferredKeys]);
  const initialView = useMemo(() => getPnlViewState(), []);
  const [entity, setEntity] = useState<PnlEntity>(initialView?.entity ?? "Consolidated");
  const [snapshot, setSnapshotState] = useState<PnlSnapshot | null>(() => {
    if (!initialView) return null;
    return initialView.monthsKey === monthsKey ? initialView.snapshot : null;
  });
  const setSnapshot = useCallback((next: PnlSnapshot | null) => {
    setSnapshotState((prev) => (snapshotsEqual(prev, next) ? prev : next));
  }, []);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(snapshot == null);
  const [, startTransition] = useTransition();
  const requestIdRef = useRef(0);
  const filterChangeAtRef = useRef<number | null>(null);
  const snapshotRef = useRef<PnlSnapshot | null>(snapshot);

  useEffect(() => {
    setActivePnlEntity(entity);
  }, [entity]);

  useEffect(() => {
    snapshotRef.current = snapshot;
    if (snapshot) {
      setPnlViewState({ entity: snapshot.entity, monthsKey: snapshot.months.join("|"), snapshot });
    }
  }, [snapshot]);

  useEffect(() => {
    if (!snapshot || snapshot.months.length === 0) return;
    prefetchOtherEntitiesForMonths(snapshot.months);
  }, [snapshot]);

  useEffect(() => {
    if (PNL_DEBUG) {
      filterChangeAtRef.current = performance.now();
      console.log(`[pnl-client] selection changed key="${monthsKey}" entity=${entity}`);
    }
  }, [monthsKey, entity]);

  useEffect(() => {
    let cancelled = false;
    const myRequestId = ++requestIdRef.current;

    if (deferredKeys.length === 0) {
      Promise.resolve().then(() => {
        if (cancelled || myRequestId !== requestIdRef.current) return;
        setSnapshot(null);
        setLoadError(null);
        setLoading(false);
      });
      return () => {
        cancelled = true;
      };
    }

    const cacheKey = `${entity}|${monthsKey}`;
    const cached = getCachedPnlSnapshot(deferredKeys, entity);
    if (cached) {
      Promise.resolve().then(() => {
        if (cancelled || myRequestId !== requestIdRef.current) return;
        setSnapshot(cached);
        setLoadError(null);
        setLoading(false);
        if (PNL_DEBUG && filterChangeAtRef.current != null) {
          console.log(
            `[pnl-client] cache hit "${cacheKey}" total=${(
              performance.now() - filterChangeAtRef.current
            ).toFixed(1)}ms`,
          );
          filterChangeAtRef.current = null;
        }
      });

      void revalidatePnlSnapshot(deferredKeys, entity)
        .then((fresh) => {
          if (cancelled || myRequestId !== requestIdRef.current) return;
          setSnapshot(fresh);
        })
        .catch(() => {
          // Cached data is already on screen; silent revalidation failures should not interrupt the user.
        });

      return () => {
        cancelled = true;
      };
    }

    const startTimer = setTimeout(() => {
      if (cancelled || myRequestId !== requestIdRef.current) return;
      setLoading(true);
      if (PNL_DEBUG && filterChangeAtRef.current != null) {
        console.log(
          `[pnl-client] stale overlay shown after=${(
            performance.now() - filterChangeAtRef.current
          ).toFixed(1)}ms`,
        );
      }
    }, 0);

    const debounce = setTimeout(async () => {
      if (cancelled || myRequestId !== requestIdRef.current) return;
      const requestStart = PNL_DEBUG ? performance.now() : 0;
      const isFirstVisibleLoad = snapshotRef.current == null;
      const initialKeys =
        isFirstVisibleLoad && deferredKeys.length > 1
          ? [primaryInitialMonth(deferredKeys)]
          : deferredKeys;
      const initialRes = await getPnlSnapshotFromClientCache(initialKeys, entity)
        .then((data) => ({ ok: true as const, data }))
        .catch((error: unknown) => ({
          ok: false as const,
          error: error instanceof Error ? error.message : "Could not load P&L.",
        }));
      if (cancelled || myRequestId !== requestIdRef.current) return;
      if (initialRes.ok) {
        setLoadError(null);
        setSnapshot(initialRes.data);
      } else {
        setLoadError(initialRes.error);
        setLoading(false);
        return;
      }
      if (PNL_DEBUG) {
        const networkMs = performance.now() - requestStart;
        const totalMs =
          filterChangeAtRef.current != null
            ? performance.now() - filterChangeAtRef.current
            : networkMs;
        console.log(
          `[pnl-client] fetch initial "${entity}|${initialKeys.join("|")}" network=${networkMs.toFixed(1)}ms total=${totalMs.toFixed(1)}ms`,
        );
        filterChangeAtRef.current = null;
      }

      if (initialKeys.length === deferredKeys.length) {
        setLoading(false);
        return;
      }

      setTimeout(() => {
        void getPnlSnapshotFromClientCache(deferredKeys, entity)
          .then((full) => {
            if (cancelled || myRequestId !== requestIdRef.current) return;
            setSnapshot(full);
            setLoading(false);
          })
          .catch((error: unknown) => {
            if (cancelled || myRequestId !== requestIdRef.current) return;
            setLoadError(error instanceof Error ? error.message : "Could not load full P&L range.");
            setLoading(false);
          });
      }, 0);
    }, FETCH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(startTimer);
      clearTimeout(debounce);
    };
  }, [monthsKey, entity, deferredKeys, setSnapshot]);

  const monthLabel = selectedMonthsLabel(deferredKeys);
  const multiNote = deferredKeys.length > 1 ? `${deferredKeys.length} selected months` : undefined;
  const isStale = selectedKeys !== deferredKeys;
  const handleEntityChange = useCallback(
    (nextEntity: PnlEntity) => {
      if (nextEntity === entity) return;
      const cached = getCachedPnlSnapshot(deferredKeys, nextEntity);
      if (cached) {
        startTransition(() => {
          setEntity(nextEntity);
          setSnapshot(cached);
          setLoading(false);
        });
        return;
      }
      setLoading(true);
      startTransition(() => setEntity(nextEntity));
    },
    [deferredKeys, entity, setSnapshot, startTransition],
  );
  const handleEntityIntent = useCallback(
    (nextEntity: PnlEntity) => {
      if (nextEntity === entity) return;
      prefetchPnlSnapshot(deferredKeys, nextEntity);
    },
    [deferredKeys, entity],
  );

  if (deferredKeys.length === 0 && selectedKeys.length === 0) {
    return (
      <div className="rounded-xl border border-amber-500/25 bg-amber-950/20 px-4 py-6 text-sm text-amber-100/90">
        Choose at least one month in the sidebar to view P&amp;L.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {loadError ? (
        <div className="rounded-xl border border-red-500/30 bg-red-950/30 px-4 py-3 text-sm text-red-200">
          {loadError}
        </div>
      ) : null}
      <PnlView
        snapshot={snapshot}
        entity={entity}
        onEntityChange={handleEntityChange}
        onEntityIntent={handleEntityIntent}
        monthLabel={monthLabel}
        multiMonthNote={multiNote}
        isLoading={loading || isStale}
      />
    </div>
  );
}

export default memo(PnlTabClient);
