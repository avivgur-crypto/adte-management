/// <reference lib="webworker" />

import { aggregateSnapshotsPure, type PnlEntityAgg, type PnlSnapshotAgg } from "./pnl-aggregate-pure";

type Inbound =
  | { type: "aggregate"; id: number; months: string[]; entity: PnlEntityAgg; snapshots: PnlSnapshotAgg[] }
  | { type: "ping"; id: number };

const ctx: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;

ctx.addEventListener("message", (event: MessageEvent<Inbound>) => {
  const msg = event.data;
  if (!msg || typeof msg !== "object") return;
  if (msg.type === "ping") {
    ctx.postMessage({ type: "pong", id: msg.id });
    return;
  }
  if (msg.type !== "aggregate") return;
  try {
    const snapshot = aggregateSnapshotsPure(msg.months, msg.entity, msg.snapshots);
    ctx.postMessage({ type: "aggregate-result", id: msg.id, ok: true as const, snapshot });
  } catch (e) {
    const message = e instanceof Error ? e.message : "aggregate failed";
    ctx.postMessage({ type: "aggregate-result", id: msg.id, ok: false as const, error: message });
  }
});
