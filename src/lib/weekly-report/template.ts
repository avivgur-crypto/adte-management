/**
 * One-page weekly exec report HTML — Adtex black theme.
 *
 * Layout is tuned for A4 (794×1123 CSS px): generous spacing fills the page,
 * and every chart carries its own value labels (a chart without numbers is
 * decoration, not information). SVG viewBox widths match rendered widths 1:1
 * so font sizes inside charts are true pixels.
 */

import { readFileSync } from "fs";
import { join } from "path";
import type { WeeklyExecReport } from "@/lib/weekly-report/data";

/** Inner width of a full-page chart card (px). */
const FULL_CHART_W = 672;

const AXIS_TEXT = "#a1a1aa";
const VALUE_TEXT = "#f4f4f5";
const GP_COLOR = "#a3e635";
const GOAL_COLOR = "#71717a";

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

/** Short money for chart labels: $33K / $1.71M. */
function chartMoney(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${Math.round(n)}`;
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

/** "Thu 6" — weekday + day of month, readable at small sizes. */
function shortDayLabel(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const weekday = new Date(Date.UTC(y!, m! - 1, d!)).toLocaleDateString(
    "en-US",
    { weekday: "short", timeZone: "UTC" },
  );
  return `${weekday} ${d}`;
}

function dailyBarsSvg(report: WeeklyExecReport): string {
  const bars = report.dailyBars;
  if (!bars.length) return "";
  const max = Math.max(
    ...bars.flatMap((b) => [b.revenue, b.priorRevenue]),
    1,
  );
  const w = FULL_CHART_W;
  const h = 188;
  const labelZone = 36; // stacked value labels above bars
  const axisZone = 20;
  const plotH = h - labelZone - axisZone;
  const baseY = labelZone + plotH;
  const gap = 14;
  const slot = (w - gap * (bars.length + 1)) / bars.length;
  const parts: string[] = [];
  bars.forEach((b, i) => {
    const x = gap + i * (slot + gap);
    const barW = slot * 0.44;
    const revX = x;
    const priorX = x + barW + 5;
    const bh = (b.revenue / max) * plotH;
    const y = baseY - bh;
    // This week: revenue bar with GP overlay.
    parts.push(
      `<rect x="${revX.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${bh.toFixed(1)}" rx="3" fill="url(#gRev)"/>`,
    );
    const ph = (b.profit / max) * plotH;
    parts.push(
      `<rect x="${revX.toFixed(1)}" y="${(baseY - ph).toFixed(1)}" width="${Math.max(4, barW * 0.36).toFixed(1)}" height="${ph.toFixed(1)}" rx="2" fill="${GP_COLOR}" opacity="0.92"/>`,
    );
    // Same weekday last week: gray revenue bar.
    const priorH = (b.priorRevenue / max) * plotH;
    parts.push(
      `<rect x="${priorX.toFixed(1)}" y="${(baseY - priorH).toFixed(1)}" width="${barW.toFixed(1)}" height="${priorH.toFixed(1)}" rx="3" fill="#3f3f46"/>`,
    );
    const revCx = revX + barW / 2;
    const priorCx = priorX + barW / 2;
    parts.push(
      `<text x="${revCx.toFixed(1)}" y="${(y - 18).toFixed(1)}" text-anchor="middle" fill="${VALUE_TEXT}" font-size="10.5" font-weight="700">${chartMoney(b.revenue)}</text>`,
    );
    parts.push(
      `<text x="${revCx.toFixed(1)}" y="${(y - 6).toFixed(1)}" text-anchor="middle" fill="${GP_COLOR}" font-size="9">${chartMoney(b.profit)}</text>`,
    );
    if (b.priorRevenue > 0) {
      parts.push(
        `<text x="${priorCx.toFixed(1)}" y="${(baseY - priorH - 5).toFixed(1)}" text-anchor="middle" fill="${GOAL_COLOR}" font-size="9">${chartMoney(b.priorRevenue)}</text>`,
      );
    }
    parts.push(
      `<text x="${(x + slot / 2).toFixed(1)}" y="${h - 5}" text-anchor="middle" fill="${AXIS_TEXT}" font-size="10">${shortDayLabel(b.date)}</text>`,
    );
  });
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Daily revenue and gross profit this week vs same weekday last week">
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
  const w = FULL_CHART_W;
  const h = 168;
  const labelZone = 34; // actual (white) + goal (gray) stacked above bars
  const axisZone = 20;
  const plotH = h - labelZone - axisZone;
  const baseY = labelZone + plotH;
  const gap = 8;
  const slot = (w - gap * (bars.length + 1)) / bars.length;
  const parts: string[] = [];
  bars.forEach((b, i) => {
    const x = gap + i * (slot + gap);
    const cx = x + slot / 2;
    const barW = slot * 0.42;
    const ah = (b.actual / max) * plotH;
    const gh = (b.goal / max) * plotH;
    const pairTop = baseY - Math.max(ah, gh);
    parts.push(
      `<rect x="${x.toFixed(1)}" y="${(baseY - ah).toFixed(1)}" width="${barW.toFixed(1)}" height="${ah.toFixed(1)}" rx="2" fill="url(#gRev2)"/>`,
    );
    parts.push(
      `<rect x="${(x + barW + 3).toFixed(1)}" y="${(baseY - gh).toFixed(1)}" width="${barW.toFixed(1)}" height="${gh.toFixed(1)}" rx="2" fill="#3f3f46"/>`,
    );
    parts.push(
      `<text x="${cx.toFixed(1)}" y="${(pairTop - 19).toFixed(1)}" text-anchor="middle" fill="${VALUE_TEXT}" font-size="9.5" font-weight="700">${chartMoney(b.actual)}</text>`,
    );
    parts.push(
      `<text x="${cx.toFixed(1)}" y="${(pairTop - 7).toFixed(1)}" text-anchor="middle" fill="${GOAL_COLOR}" font-size="8.5">${chartMoney(b.goal)}</text>`,
    );
    parts.push(
      `<text x="${cx.toFixed(1)}" y="${h - 5}" text-anchor="middle" fill="${AXIS_TEXT}" font-size="9.5">${b.label}</text>`,
    );
  });
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Monthly actual revenue vs goal">
    <defs>
      <linearGradient id="gRev2" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#6d8eff"/>
        <stop offset="100%" stop-color="#ff6d8e"/>
      </linearGradient>
    </defs>
    ${parts.join("")}
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
  const revPace = report.mtd.pace.revenue;
  const headlinePath =
    report.status === "on_pace"
      ? `on track for ${headlineMoney(revPace.projected)} by month-end`
      : `need ${headlineMoney(revPace.requiredDailyRunRate)}/day to hit the ${headlineMoney(revPace.goal)} goal`;
  const headlineLine2 =
    `${escapeHtml(report.mtd.monthLabel.split(" ")[0]!)}, day ${revPace.effectiveDaysPassed} of ${revPace.daysInMonth}: ` +
    `${headlineMoney(report.mtd.revenue)} vs ${headlineMoney(revPace.targetMtd)} expected by now → ${headlinePath}.`;
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
          .join('<span class="sep">·</span>')}</p>`;

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
    height: 297mm;
    padding: 11mm 12mm 9mm;
    background:
      radial-gradient(ellipse 120% 80% at 50% 0%, #1a1a1a 0%, #0a0a0a 50%, #000 100%);
  }
  .page { display: flex; flex-direction: column; gap: 12px; height: 100%; }
  header {
    display: flex; align-items: center; justify-content: space-between;
    border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 12px;
  }
  .logo { height: 52px; width: auto; }
  .meta { text-align: right; }
  .meta .title { font-size: 12px; letter-spacing: 0.16em; text-transform: uppercase; color: #a1a1aa; font-weight: 600; }
  .meta .range { font-size: 19px; font-weight: 800; margin-top: 3px; }
  .status {
    padding: 10px 16px; border-radius: 12px;
    background: rgba(255,255,255,0.045); border: 1px solid rgba(255,255,255,0.1);
    border-left: 3px solid ${accent};
  }
  .status-line { font-size: 14px; color: #e4e4e7; line-height: 1.55; }
  .status-line + .status-line { margin-top: 3px; color: #b9b9c0; }
  .verdict { color: ${accent}; font-weight: 800; }
  .grid2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
  .hero-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
  .hero-item { text-align: center; padding: 2px 0; }
  .hero-item + .hero-item { border-left: 1px solid rgba(255,255,255,0.08); }
  .hero-lbl { font-size: 11.5px; letter-spacing: 0.1em; text-transform: uppercase; color: #9ca3af; }
  .hero-val { font-size: 25px; font-weight: 800; font-variant-numeric: tabular-nums; margin: 4px 0 3px; }
  .hero-sub { font-size: 11.5px; }
  .hero-sub.up { color: #4ade80; }
  .hero-sub.down { color: #f472b6; }
  .card {
    min-width: 0;
    background: rgba(255,255,255,0.045); border: 1px solid rgba(255,255,255,0.1);
    border-radius: 12px; padding: 12px 16px;
  }
  .card h3 {
    margin: 0 0 8px; font-size: 11px; letter-spacing: 0.13em;
    text-transform: uppercase; color: #9ca3af; font-weight: 600;
  }
  .metric { display: flex; justify-content: space-between; align-items: baseline; margin: 6px 0; }
  .metric .lbl { font-size: 12.5px; color: #b9b9c0; }
  .metric .val { font-size: 19px; font-weight: 800; font-variant-numeric: tabular-nums; }
  .primary-pace { display: flex; align-items: baseline; gap: 7px; font-size: 32px; font-weight: 800; line-height: 1.1; margin: 2px 0 6px; }
  .primary-label { font-size: 11px; color: #b9b9c0; white-space: nowrap; }
  .chart-card h4 {
    margin: 0 0 8px; font-size: 11px; letter-spacing: 0.11em;
    text-transform: uppercase; color: #9ca3af; font-weight: 600;
  }
  .legend { font-size: 10.5px; color: #9ca3af; margin-top: 6px; }
  .dot { display: inline-block; width: 9px; height: 9px; border-radius: 2px; margin-right: 5px; vertical-align: middle; }
  .contract-line { margin: 0; font-size: 14px; color: #f4f4f5; }
  .contract-line em { color: #9ca3af; font-style: normal; font-size: 11.5px; }
  .contract-line .sep { color: #52525b; margin: 0 10px; }
  .muted { margin: 0; font-size: 13px; color: #9ca3af; }
  footer {
    margin-top: auto; padding-top: 10px;
    border-top: 1px solid rgba(255,255,255,0.1);
    white-space: nowrap;
    font-size: 10.5px; color: #8b8b94;
  }
  .pace-row { font-size: 11px; color: #b9b9c0; margin-top: 7px; line-height: 1.5; }
  .pace-row strong { color: #f4f4f5; }
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

    <section class="card hero">
      <h3>This week · ${escapeHtml(report.week.label)}</h3>
      <div class="hero-grid">
        <div class="hero-item">
          <div class="hero-lbl">Revenue</div>
          <div class="hero-val">${money(report.weekTotals.revenue)}</div>
          <div class="hero-sub ${(report.weekWoW.revenuePct ?? 0) >= 0 ? "up" : "down"}">${signedPct(report.weekWoW.revenuePct)} vs last week</div>
        </div>
        <div class="hero-item">
          <div class="hero-lbl">Gross profit</div>
          <div class="hero-val">${money(report.weekTotals.profit)}</div>
          <div class="hero-sub ${(report.weekWoW.profitPct ?? 0) >= 0 ? "up" : "down"}">${signedPct(report.weekWoW.profitPct)} vs last week</div>
        </div>
        <div class="hero-item">
          <div class="hero-lbl">Margin</div>
          <div class="hero-val">${report.weekTotals.marginPct.toFixed(1)}%</div>
          <div class="hero-sub ${report.weekWoW.marginPoints >= 0 ? "up" : "down"}">${signedPoints(report.weekWoW.marginPoints)} vs last week</div>
        </div>
      </div>
    </section>

    <div class="status">
      <div class="status-line"><span class="verdict">${escapeHtml(report.statusLabel)}</span>${escapeHtml(headlineLine1.slice(report.statusLabel.length))}</div>
      <div class="status-line">${headlineLine2}</div>
    </div>

    <div class="grid2">
      <section class="card">
        <h3>MTD · ${escapeHtml(report.mtd.monthLabel)} · day ${revPace.effectiveDaysPassed}/${revPace.daysInMonth}</h3>
        <div class="metric"><span class="lbl">Revenue</span><span class="val">${money(report.mtd.revenue)}</span></div>
        <div class="pace-row"><strong>${revPace.pacePercent != null ? `${revPace.pacePercent}%` : "—"}</strong> of the ${headlineMoney(revPace.targetMtd)} expected by day ${revPace.effectiveDaysPassed} · GP ${headlineMoney(report.mtd.profit)} (${report.mtd.pace.profit.pacePercent != null ? `${report.mtd.pace.profit.pacePercent}%` : "—"})</div>
        <p class="pace-row">
          Month goal ${headlineMoney(revPace.goal)} · projected ${headlineMoney(revPace.projected)} by month-end${report.status !== "on_pace" ? ` · need ${headlineMoney(revPace.requiredDailyRunRate)}/day` : ""}
        </p>
      </section>

      <section class="card">
        <h3>YTD ${REPORT_YEAR_LABEL}</h3>
        <div class="primary-pace">${report.ytd.revenuePacePct != null ? `${report.ytd.revenuePacePct}%` : "—"} <span class="primary-label">of pro-rata YTD target</span></div>
        <p class="pace-row">Revenue ${headlineMoney(report.ytd.revenue)} · <span style="color:${ytdDelta >= 0 ? "#4ade80" : "#f472b6"}">${ytdDeltaText}</span></p>
        <p class="pace-row">${report.ytd.annualRevenuePacePct != null ? `${report.ytd.annualRevenuePacePct}%` : "—"} of annual goal (${money(report.ytd.annualRevenueGoal, true)})</p>
      </section>
    </div>

    <section class="card chart-card">
      <h4>Daily pace · this week vs same day last week</h4>
      ${dailyBarsSvg(report)}
      <div class="legend"><span class="dot" style="background:linear-gradient(90deg,#6d8eff,#ff6d8e)"></span>Revenue this week
        <span class="dot" style="background:${GP_COLOR};margin-left:12px"></span>Gross profit this week
        <span class="dot" style="background:#3f3f46;margin-left:12px"></span>Revenue same day last week</div>
    </section>

    <section class="card chart-card">
      <h4>Monthly actual vs goal</h4>
      ${monthlyBarsSvg(report)}
      <div class="legend"><span class="dot" style="background:linear-gradient(90deg,#6d8eff,#ff6d8e)"></span>Actual
        <span class="dot" style="background:#3f3f46;margin-left:12px"></span>Goal</div>
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
