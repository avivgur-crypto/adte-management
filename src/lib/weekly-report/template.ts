/**
 * One-page weekly exec report HTML — Adtex black theme.
 */

import { readFileSync } from "fs";
import { join } from "path";
import type { WeeklyExecReport } from "@/lib/weekly-report/data";

function money(n: number, compact = false): string {
  if (compact && Math.abs(n) >= 1_000_000) {
    return `$${(n / 1_000_000).toFixed(2)}M`;
  }
  if (compact && Math.abs(n) >= 10_000) {
    return `$${Math.round(n / 1000)}K`;
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

function signedPct(n: number | null): string {
  if (n == null) return "—";
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  return `${sign}${Math.abs(n).toFixed(1)}%`;
}

function signedPoints(n: number): string {
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  return `${sign}${Math.abs(n).toFixed(1)}pts`;
}

function headlineMoney(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return money(n);
}

function formatReportDate(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function formatIsraelTime(iso: string | null): string {
  if (!iso) return "unknown";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jerusalem",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));
}

function formatGeneratedDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Jerusalem",
    month: "short",
    day: "numeric",
  }).format(new Date(iso));
}

function statusColor(status: WeeklyExecReport["status"]): string {
  if (status === "on_pace") return "#4ade80";
  if (status === "slightly_behind") return "#fbbf24";
  return "#f472b6";
}

function logoDataUri(): string {
  try {
    const buf = readFileSync(
      join(process.cwd(), "public", "logo-header-inapp.png"),
    );
    return `data:image/png;base64,${buf.toString("base64")}`;
  } catch {
    return "";
  }
}

function dailyBarsSvg(report: WeeklyExecReport): string {
  const bars = report.dailyBars;
  if (!bars.length) return "";
  const max = Math.max(...bars.map((b) => b.revenue), 1);
  const w = 520;
  const h = 110;
  const gap = 8;
  const barW = (w - gap * (bars.length + 1)) / bars.length;
  const parts: string[] = [];
  bars.forEach((b, i) => {
    const x = gap + i * (barW + gap);
    const bh = (b.revenue / max) * 78;
    const y = 88 - bh;
    parts.push(
      `<rect x="${x}" y="${y}" width="${barW}" height="${bh}" rx="3" fill="url(#gRev)"/>`,
    );
    const ph = (b.profit / max) * 78;
    parts.push(
      `<rect x="${x}" y="${88 - ph}" width="${Math.max(2, barW * 0.35)}" height="${ph}" rx="2" fill="#a3e635" opacity="0.9"/>`,
    );
    parts.push(
      `<text x="${x + barW / 2}" y="104" text-anchor="middle" fill="#71717a" font-size="8">${b.label.split(",")[0]}</text>`,
    );
  });
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="gRev" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#6d8eff"/>
        <stop offset="100%" stop-color="#ff6d8e"/>
      </linearGradient>
    </defs>
    ${parts.join("")}
  </svg>`;
}

function monthlyBarsSvg(report: WeeklyExecReport): string {
  const bars = report.monthlyBars;
  if (!bars.length) return "";
  const max = Math.max(...bars.flatMap((b) => [b.actual, b.goal]), 1);
  const w = 520;
  const h = 120;
  const gap = 10;
  const slot = (w - gap * (bars.length + 1)) / bars.length;
  const parts: string[] = [];
  bars.forEach((b, i) => {
    const x = gap + i * (slot + gap);
    const aw = slot * 0.38;
    const gw = slot * 0.38;
    const ah = (b.actual / max) * 85;
    const gh = (b.goal / max) * 85;
    parts.push(
      `<rect x="${x}" y="${95 - ah}" width="${aw}" height="${ah}" rx="2" fill="url(#gRev2)"/>`,
    );
    parts.push(
      `<rect x="${x + aw + 3}" y="${95 - gh}" width="${gw}" height="${gh}" rx="2" fill="#3f3f46"/>`,
    );
    parts.push(
      `<text x="${x + slot / 2}" y="112" text-anchor="middle" fill="#71717a" font-size="8">${b.label}</text>`,
    );
  });
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="gRev2" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#6d8eff"/>
        <stop offset="100%" stop-color="#ff6d8e"/>
      </linearGradient>
    </defs>
    ${parts.join("")}
  </svg>`;
}

function ytdLineSvg(report: WeeklyExecReport): string {
  const pts = report.ytdCumulative;
  if (pts.length < 2) return "";
  const w = 520;
  const h = 110;
  const pad = 8;
  const max = Math.max(...pts.flatMap((p) => [p.actual, p.target]), 1);
  const xAt = (i: number) => pad + (i / (pts.length - 1)) * (w - pad * 2);
  const yAt = (v: number) => h - pad - (v / max) * (h - pad * 2 - 12);
  const actualPath = pts
    .map((p, i) => `${i === 0 ? "M" : "L"}${xAt(i).toFixed(1)},${yAt(p.actual).toFixed(1)}`)
    .join(" ");
  const targetPath = pts
    .map((p, i) => `${i === 0 ? "M" : "L"}${xAt(i).toFixed(1)},${yAt(p.target).toFixed(1)}`)
    .join(" ");
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" xmlns="http://www.w3.org/2000/svg">
    <path d="${targetPath}" fill="none" stroke="#52525b" stroke-width="1.5" stroke-dasharray="4 3"/>
    <path d="${actualPath}" fill="none" stroke="url(#gLine)" stroke-width="2.2"/>
    <defs>
      <linearGradient id="gLine" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="#6d8eff"/>
        <stop offset="100%" stop-color="#ff6d8e"/>
      </linearGradient>
    </defs>
  </svg>`;
}

export function renderWeeklyReportHtml(report: WeeklyExecReport): string {
  const logo = logoDataUri();
  const accent = statusColor(report.status);
  const weeklyDelta = report.weekTotals.revenue - report.priorWeekTotals.revenue;
  const driverText =
    report.headline.driverDays.length > 0
      ? weeklyDelta < 0
        ? `, mostly ${report.headline.driverDays.join("–")}`
        : `, led by ${report.headline.driverDays.join("–")}`
      : "";
  const headlineLine1 =
    `${report.statusLabel} — this week ${headlineMoney(report.weekTotals.revenue)} ` +
    `vs ${headlineMoney(report.priorWeekTotals.revenue)} last week ` +
    `(${signedPct(report.weekWoW.revenuePct)})${driverText}.`;
  const headlinePath =
    report.status === "on_pace"
      ? `projected ${headlineMoney(report.mtd.pace.revenue.projected)} EOM`
      : `need ${headlineMoney(report.mtd.pace.revenue.requiredDailyRunRate)}/day`;
  const headlineLine2 =
    `Month: ${headlineMoney(report.mtd.revenue)} of ` +
    `${headlineMoney(report.mtd.pace.revenue.targetMtd)} pro-rata target → ${headlinePath}.`;
  const ytdDelta = report.ytd.revenue - report.ytd.revenueGoalYtd;
  const ytdDeltaText = `${headlineMoney(Math.abs(ytdDelta))} ${
    ytdDelta >= 0 ? "above" : "below"
  } pro-rata target`;
  const trustWarnings: string[] = [];
  if (report.trust.daysPresent < report.trust.daysExpected) {
    trustWarnings.push(
      `${report.trust.daysPresent}/${report.trust.daysExpected} days`,
    );
  }
  if (report.trust.xdashSyncStale) {
    trustWarnings.push("XDASH sync stale at generation");
  }
  const trustWarning =
    trustWarnings.length > 0 ? `⚠ ${trustWarnings.join("; ")} · ` : "";
  const completeness =
    report.trust.daysPresent === report.trust.daysExpected
      ? `${report.trust.daysPresent}/${report.trust.daysExpected} days · `
      : "";
  const trustLine =
    `${trustWarning}Data through ${formatReportDate(report.dataThrough)} · ` +
    completeness +
    `synced ${formatIsraelTime(report.trust.syncedAt)} · ` +
    `generated ${formatGeneratedDate(report.generatedAt)}`;
  const contractsBlock =
    report.contracts.length === 0
      ? `<p class="muted">No new contracts signed this week.</p>`
      : `<p class="contract-line">${report.contracts
          .map(
            (c) =>
              `<span><strong>${escapeHtml(c.companyName)}</strong> <em>${formatReportDate(c.date)}</em></span>`,
          )
          .join(" · ")}</p>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>Adtex Weekly Report — ${escapeHtml(report.week.label)}</title>
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  html, body {
    margin: 0; padding: 0;
    background: #000;
    color: #fff;
    font-family: "Segoe UI", system-ui, -apple-system, sans-serif;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  body {
    width: 210mm;
    min-height: 297mm;
    padding: 14mm 14mm 12mm;
    background:
      radial-gradient(ellipse 120% 80% at 50% 0%, #1a1a1a 0%, #0a0a0a 50%, #000 100%);
  }
  .page { display: flex; flex-direction: column; gap: 10px; height: 100%; }
  header {
    display: flex; align-items: center; justify-content: space-between;
    border-bottom: 1px solid rgba(255,255,255,0.08); padding-bottom: 10px;
  }
  .logo { height: 42px; width: auto; }
  .meta { text-align: right; }
  .meta .title { font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; color: #a1a1aa; font-weight: 600; }
  .meta .range { font-size: 15px; font-weight: 700; margin-top: 2px; }
  .status {
    padding: 10px 12px; border-radius: 10px;
    background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08);
  }
  .status-line { font-size: 12px; color: #d4d4d8; line-height: 1.45; }
  .status-line + .status-line { margin-top: 2px; color: #a1a1aa; }
  .verdict { color: ${accent}; font-weight: 750; }
  .grid3 { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
  .card {
    min-width: 0;
    background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08);
    border-radius: 10px; padding: 10px 12px;
  }
  .card h3 {
    margin: 0 0 8px; font-size: 10px; letter-spacing: 0.12em;
    text-transform: uppercase; color: #71717a; font-weight: 600;
  }
  .metric { display: flex; justify-content: space-between; align-items: baseline; margin: 4px 0; }
  .metric .lbl { font-size: 11px; color: #a1a1aa; }
  .metric .val { font-size: 15px; font-weight: 700; font-variant-numeric: tabular-nums; }
  .metric .sub { font-size: 10px; color: #71717a; }
  .primary-pace { display: flex; align-items: baseline; gap: 5px; font-size: 24px; font-weight: 800; line-height: 1.15; }
  .primary-label { font-size: 9px; color: #a1a1aa; white-space: nowrap; }
  .wow { font-size: 7.5px; color: #a1a1aa; white-space: nowrap; }
  .wow.up { color: #4ade80; }
  .wow.down { color: #f472b6; }
  .hl {
    display: inline-block; padding: 1px 6px; border-radius: 4px;
    background: linear-gradient(90deg, #6d8eff, #ff6d8e); color: #fff; font-weight: 700;
  }
  .charts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
  .chart-card h4 {
    margin: 0 0 4px; font-size: 10px; letter-spacing: 0.1em;
    text-transform: uppercase; color: #71717a; font-weight: 600;
  }
  .legend { font-size: 9px; color: #71717a; margin-top: 2px; }
  .dot { display: inline-block; width: 8px; height: 8px; border-radius: 2px; margin-right: 4px; vertical-align: middle; }
  .contract-line { margin: 0; font-size: 12px; color: #f4f4f5; }
  .contract-line em { color: #71717a; font-style: normal; font-size: 10px; }
  .muted { margin: 0; font-size: 12px; color: #71717a; }
  footer {
    margin-top: auto; padding-top: 8px;
    border-top: 1px solid rgba(255,255,255,0.08);
    white-space: nowrap;
    font-size: 9px; color: #52525b;
  }
  .pace-row { font-size: 9.5px; color: #a1a1aa; margin-top: 5px; line-height: 1.35; }
  .pace-row.compact { font-size: 8.5px; white-space: nowrap; }
</style>
</head>
<body>
  <div class="page">
    <header>
      <div>${logo ? `<img class="logo" src="${logo}" alt="Adtex"/>` : `<strong>Adtex</strong>`}</div>
      <div class="meta">
        <div class="title">Weekly Executive Report</div>
        <div class="range">${escapeHtml(report.week.label)}</div>
      </div>
    </header>

    <div class="status">
      <div class="status-line"><span class="verdict">${escapeHtml(report.statusLabel)}</span>${escapeHtml(headlineLine1.slice(report.statusLabel.length))}</div>
      <div class="status-line">${escapeHtml(headlineLine2)}</div>
    </div>

    <div class="grid3">
      <section class="card">
        <h3>This week</h3>
        <div class="metric"><span class="lbl">Revenue</span><span class="val">${money(report.weekTotals.revenue)}</span></div>
        <div class="metric"><span class="lbl">GP</span><span class="val">${money(report.weekTotals.profit)}</span></div>
        <div class="wow ${ (report.weekWoW.revenuePct ?? 0) >= 0 ? "up" : "down"}">
          WoW: Rev ${signedPct(report.weekWoW.revenuePct)} · GP ${signedPct(report.weekWoW.profitPct)} · Margin ${report.weekTotals.marginPct.toFixed(1)}% (${signedPoints(report.weekWoW.marginPoints)})
        </div>
      </section>

      <section class="card">
        <h3>MTD · ${escapeHtml(report.mtd.monthLabel)}</h3>
        <div class="metric"><span class="lbl">Revenue</span><span class="val">${money(report.mtd.revenue)}</span></div>
        <div class="pace-row compact"><strong>${report.mtd.pace.revenue.pacePercent != null ? `${report.mtd.pace.revenue.pacePercent}%` : "—"}</strong> of pro-rata MTD target · GP ${headlineMoney(report.mtd.profit)} (${report.mtd.pace.profit.pacePercent != null ? `${report.mtd.pace.profit.pacePercent}%` : "—"})</div>
        <p class="pace-row compact">
          Target ${headlineMoney(report.mtd.pace.revenue.targetMtd)} · EOM ${headlineMoney(report.mtd.pace.revenue.projected)}${report.status !== "on_pace" ? ` · Need ${headlineMoney(report.mtd.pace.revenue.requiredDailyRunRate)}/day` : ""}
        </p>
      </section>

      <section class="card">
        <h3>YTD ${REPORT_YEAR_LABEL}</h3>
        <div class="primary-pace">${report.ytd.revenuePacePct != null ? `${report.ytd.revenuePacePct}%` : "—"} <span class="primary-label">of pro-rata YTD target</span></div>
        <p class="pace-row">${report.ytd.annualRevenuePacePct != null ? `${report.ytd.annualRevenuePacePct}%` : "—"} of annual goal (${money(report.ytd.annualRevenueGoal, true)})</p>
      </section>
    </div>

    <div class="charts">
      <section class="card chart-card">
        <h4>Daily · this week</h4>
        ${dailyBarsSvg(report)}
        <div class="legend"><span class="dot" style="background:linear-gradient(90deg,#6d8eff,#ff6d8e)"></span>Revenue
          <span class="dot" style="background:#a3e635;margin-left:10px"></span>GP</div>
      </section>
      <section class="card chart-card">
        <h4>Monthly actual vs goal</h4>
        ${monthlyBarsSvg(report)}
        <div class="legend"><span class="dot" style="background:linear-gradient(90deg,#6d8eff,#ff6d8e)"></span>Actual
          <span class="dot" style="background:#3f3f46;margin-left:10px"></span>Goal</div>
      </section>
    </div>

    <section class="card chart-card">
      <h4>YTD cumulative revenue vs target · <span style="color:${ytdDelta >= 0 ? "#4ade80" : "#f472b6"}">${ytdDeltaText}</span></h4>
      ${ytdLineSvg(report)}
      <div class="legend"><span class="dot" style="background:linear-gradient(90deg,#6d8eff,#ff6d8e)"></span>Actual
        <span class="dot" style="background:#52525b;margin-left:10px"></span>Target (pro-rata)</div>
    </section>

    <section class="card">
      <h3>New contracts signed this week · ${report.contracts.length}</h3>
      ${contractsBlock}
    </section>

    <footer>
      ${escapeHtml(trustLine)} · Media (XDASH), SaaS excluded
    </footer>
  </div>
</body>
</html>`;
}

const REPORT_YEAR_LABEL = "2026";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
