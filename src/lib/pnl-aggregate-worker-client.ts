"use client";

import type { PnlEntity, PnlSnapshot } from "@/app/actions/pnl";
import {
  aggregateSnapshotsPure,
  type PnlEntityAgg,
  type PnlSnapshotAgg,
} from "./pnl-aggregate-pure";

type AggregateResult =
  | { type: "aggregate-result"; id: number; ok: true; snapshot: PnlSnapshotAgg }
  | { type: "aggregate-result"; id: number; ok: false; error: string };

let worker: Worker | null = null;
let workerFailed = false;
let nextId = 1;

function totalRowCount(snapshots: PnlSnapshotAgg[]): number {
  let n = 0;
  for (const s of snapshots) n += s.rows.length;
  return n;
}

function shouldOffloadMainThread(snapshots: PnlSnapshotAgg[]): boolean {
  return snapshots.length > 1 || totalRowCount(snapshots) > 72;
}

function getWorker(): Worker | null {
  if (typeof window === "undefined" || workerFailed) return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL("./pnl-aggregate.worker.ts", import.meta.url), { type: "module" });
    worker.addEventListener("error", () => {
      workerFailed = true;
      try {
        worker?.terminate();
      } catch {
        /* ignore */
      }
      worker = null;
    });
    return worker;
  } catch {
    workerFailed = true;
    return null;
  }
}

export async function aggregateSnapshotsOffMainThread(
  months: string[],
  entity: PnlEntity,
  snapshots: PnlSnapshot[],
): Promise<PnlSnapshot> {
  const aggSnaps = snapshots as unknown as PnlSnapshotAgg[];
  const entityAgg = entity as PnlEntityAgg;

  if (!shouldOffloadMainThread(aggSnaps)) {
    return aggregateSnapshotsPure(months, entityAgg, aggSnaps) as unknown as PnlSnapshot;
  }

  const w = getWorker();
  if (!w) {
    return aggregateSnapshotsPure(months, entityAgg, aggSnaps) as unknown as PnlSnapshot;
  }

  const id = nextId++;
  return new Promise<PnlSnapshot>((resolve, reject) => {
    const onMessage = (ev: MessageEvent<AggregateResult>) => {
      const data = ev.data;
      if (!data || data.type !== "aggregate-result" || data.id !== id) return;
      w.removeEventListener("message", onMessage);
      if (data.ok) {
        resolve(data.snapshot as unknown as PnlSnapshot);
      } else {
        reject(new Error(data.error));
      }
    };
    w.addEventListener("message", onMessage);
    try {
      w.postMessage({
        type: "aggregate",
        id,
        months,
        entity: entityAgg,
        snapshots: aggSnaps,
      });
    } catch {
      w.removeEventListener("message", onMessage);
      resolve(aggregateSnapshotsPure(months, entityAgg, aggSnaps) as unknown as PnlSnapshot);
    }
  });
}
