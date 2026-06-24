---
name: XDASH backend latency fix
overview: "Concrete code changes (repo: leap4-descrepency-internal-backend) to remove the ~120-166s cold latency on /reports/query, /external-reports and the main /home/overview. Root: generateReport + the main overview run a live aggregation over the per-org subset of the 323M-row DemandSupplyTransactions. Fix = add a DemandSupplyDaily rollup (built once/day by the already-running cache worker) that ReportService reads, serve the main /home/overview from the existing fresh HomePageCache, and switch the live-fallback hint to the existing isAllDayData index."
todos:
  - id: rollup-schema
    content: "Add src/Database/schemas/demandSupplyDaily.schema.ts (org,date,demand,supply + raw metrics; unique {organization,date,demand,supply}) and DemandSupplyDailyProvider in src/Database/schemas.providers.ts (mirror homePageCache.schema.ts + generateSchemaProvider)"
    status: pending
  - id: rollup-cron
    content: "home-cache-worker.service.ts: inject DemandSupplyTransaction + DemandSupplyDaily models; add @Cron updateDemandSupplyDailyRollup() that per org per finalized day (yesterday + missing) aggregates {isAllDayData:true, day} group by {demand,supply} (hint timestamp_AND_isAllDayData_AND_supply) and bulk-upserts rollup rows; register both providers in home-cache-worker.module.ts"
    status: pending
  - id: report-read-rollup
    content: "report.service.ts: inject DemandSupplyDaily model; in generateReport source rows from DemandSupplyDaily (match org+date-range+supplyTagIds[+demand], group by {demand,supply,[timestamp]}, sum) feeding the existing transformData/aggregateByDimensions (dimensions + PriceRulesApplier net metrics unchanged); live fallback for ranges including today; add DemandSupplyDailyProvider to report.module.ts. Covers /reports/query AND /external-reports"
    status: pending
  - id: overview-cache
    content: "home.controller.ts getHomePageOverview: when userOrganization.length===1, use cache-aware getAdServersData (was getHomeOverview), getTopTagsData (was getTop100TagsTable), getTopPartnersData (was getPartnersComboTable), and getPartnersData(DEMAND)+getPartnersData(SUPPLY) merged (was getPartnerOverview); keep live path for multi-org / custom ranges"
    status: pending
  - id: hint-switch
    content: "Switch the live-fallback report aggregation hint from timestamp_1_supply_1 to the existing timestamp_AND_isAllDayData_AND_supply (report.service.ts / report.aggregation-builder.ts). Optional: createIndex a covering index only if the once/day rollup build is still slow"
    status: pending
  - id: verify
    content: "Verify: /reports/query + /external-reports for a past day < ~2s (was ~120-166s); main /home/overview for today/yesterday fast; adte-management cron/sync, pairs, self-heal, home stay 200 (no 300s/504)"
    status: pending
isProject: false
---

# XDASH backend: eliminate query latency (concrete code changes)

Repo: `leap4-descrepency-internal-backend`.

## Core issue (verified)
`/reports/query` (and `/external-reports/:orgId/query`, same `ReportService.generateReport`) and the main `/home/overview` run a **live aggregation** over the per-org subset of `DemandSupplyTransactions` (~323M rows). Measured cold latency **~120-166s** (warm ~2s). This is the root of the cron 504s, refresh aborts, self-heal 504s, and pairs-not-landing.

Verified DB facts (prod):
- Existing indexes on `DemandSupplyTransactions`: `timestamp_1_supply_1`, `timestamp_isAllDayData`, **`timestamp_AND_isAllDayData_AND_supply` ({timestamp,isAllDayData,supply})**, `timestamp_AND_isAllDayData_AND_demand`, plain `timestamp`. The report currently `.hint("timestamp_1_supply_1")` — i.e. it ignores the better `isAllDayData`-inclusive index.
- `HomePageCache` is **fresh** (180 docs, newest today) → the `CACHE_WORKER_MODE` worker is already running. No "deploy the worker" step needed.
- `DemandSupplyDaily` does not exist yet (clean add).

## Code changes

### 1. New rollup collection `DemandSupplyDaily`
- New file `src/Database/schemas/demandSupplyDaily.schema.ts` (mirror [homePageCache.schema.ts](src/Database/schemas/homePageCache.schema.ts)): fields `{ organization: String(index), date: Date(index), demand: ObjectId, supply: ObjectId, revenue, cost, impressions, requests, completion, incomingRequests: Number }`, `collection: 'DemandSupplyDaily'`, and `schema.index({ organization:1, date:1, demand:1, supply:1 }, { unique: true })`. Export `DemandSupplyDaily = { name: 'DemandSupplyDaily' }`.
- In [src/Database/schemas.providers.ts](src/Database/schemas.providers.ts): `export const DemandSupplyDailyProvider = generateSchemaProvider(DemandSupplyDaily, DemandSupplyDailySchema);` (same as `HomePageCacheProvider`).

### 2. Cache-worker cron builds the rollup once/day
- In [home-cache-worker.service.ts](src/featuers/home-cache-worker/home-cache-worker.service.ts): inject `@Inject(DemandSupplyTransaction.name) dstModel` and `@Inject(DemandSupplyDaily.name) dailyModel`. Add `@Cron('25 * * * *') updateDemandSupplyDailyRollup()` (guarded by `isCacheWorkerMode()` + a running flag, like the existing tasks) that, for each org (`staticEntities.getAdServerOrganizations()`) and each finalized day to (re)build (yesterday + any day in the current month missing from `DemandSupplyDaily`), runs once:
```ts
const supplyIds = staticEntities.getAdServerTags(org).filter(t=>t.side==='supply').map(t=>new Types.ObjectId(t._id));
const rows = await dstModel.aggregate([
  { $match: { isAllDayData: true, timestamp: { $gte: dayStart, $lte: dayEnd }, supply: { $in: supplyIds } } },
  { $group: { _id: { demand: "$demand", supply: "$supply" },
      revenue:{$sum:"$revenue"}, cost:{$sum:"$cost"}, impressions:{$sum:"$impressions"},
      requests:{$sum:"$requests"}, completion:{$sum:"$completion"}, incomingRequests:{$sum:"$incomingRequests"} } },
]).hint("timestamp_AND_isAllDayData_AND_supply").allowDiskUse(true);
// bulkWrite upsert rows into DemandSupplyDaily keyed {organization:org, date:dayStart, demand, supply}
```
- Register `DemandSupplyTransactionProvider` + `DemandSupplyDailyProvider` in [home-cache-worker.module.ts](src/featuers/home-cache-worker/home-cache-worker.module.ts). (Per-day, per-org runs in the long-lived worker, not under the API 300s ceiling.)

### 3. `ReportService.generateReport` reads the rollup
- In [report.service.ts](src/featuers/reports/report.service.ts): inject `@Inject(DemandSupplyDaily.name) dailyModel`. Replace the raw `demandSupplyTransactionModel.aggregate(buildPipeline(...))` ([report.service.ts:78-82](src/featuers/reports/report.service.ts)) with an aggregation over `DemandSupplyDaily`: `$match { organization: organizationId, date in [start,end], supply: { $in: supplyTagIds }, (demand: { $in: filteredDemandTagIds }) }`, then `$group` by `{ demand, supply, [timestamp per aggregationPeriod] }` summing the raw metrics, then `buildComputedMetricsStage`. The output keeps the SAME `_id:{demand,supply,timestamp}` + `metrics{}` shape, so the existing `transformData` + `aggregateByDimensions` (tag→partner/adServer/dataPoint) and `PriceRulesApplier` net metrics are unchanged. Do the same for `buildTotalsPipeline`.
- Fallback: if the requested range includes **today** (unfinalized, not in the rollup), fetch only today's slice live from `DemandSupplyTransactions` and merge. (Past-only ranges never touch raw transactions.)
- Add `DemandSupplyDailyProvider` to [report.module.ts](src/featuers/reports/report.module.ts) providers.
- This fixes both `/reports/query` and `/external-reports/:orgId/query`.

### 4. Main `/home/overview` from `HomePageCache`
- In [home.controller.ts](src/featuers/home/home.controller.ts) `getHomePageOverview` ([:97-121]): when `userOrganization.length === 1` (adte-management's case), swap the live calls for the cache-aware methods ([home.service.ts:219-266](src/featuers/home/home.service.ts)):
  - `getHomeOverview` -> `getAdServersData(key,...)`, `getTop100TagsTable` -> `getTopTagsData(key,...)`, `getPartnersComboTable` -> `getTopPartnersData(key,...)` (1:1).
  - `getPartnerOverview` -> `getPartnersData(key,...,DEMAND)` + `getPartnersData(key,...,SUPPLY)`, merged into one `overviewTotals` (concat `partners` per date bucket) before the existing demand/supply sort+slice.
- Keep the current live path for multi-org or custom ranges (cache only covers single org + standard dateTypes). Served from the fresh `HomePageCache` for today/yesterday -> removes the ~120-166s cookie-totals latency.

### 5. Index hint (cheap win + optional)
- Switch the live-fallback report aggregation `.hint("timestamp_1_supply_1")` to the existing **`timestamp_AND_isAllDayData_AND_supply`** in [report.service.ts](src/featuers/reports/report.service.ts) / [report.aggregation-builder.ts](src/featuers/reports/report.aggregation-builder.ts) (it includes `isAllDayData`, so Mongo skips the intraday `isAllDayData:false` entries). Same hint used by the rollup build (step 2).
- Optional: only if the once/day rollup build is still too slow, `createIndex` a covering index `{isAllDayData:1, supply:1, timestamp:1, demand:1, revenue:1, cost:1, impressions:1, requests:1, completion:1, incomingRequests:1}` (Atlas / one-off script, `background:true`).

## Sequencing
1 (schema) -> 2 (rollup cron, let it backfill the month) -> 3 (report reads rollup) -> 4 (overview cache) -> 5 (hint). 5 can ship first as a standalone speedup.

## Verify
`POST /reports/query` + `/external-reports/:orgId/query` for a past day return < ~2s (was ~120-166s); main `/home/overview` for today/yesterday is fast; and adte-management `cron/sync`, `pairs`, `self-heal`, home all stay 200 with no 300s/504.
