// Console-style consumption view for the local MiniMax ledger (S2).
//
// The renderer is a pure function: it reads a `LedgerSummary` and returns the
// lines of the view. It never touches the filesystem, the clock or the
// network, so the same summary always paints the same view.
//
// Scope: the numbers come from the local Pi session ledger, never from the
// MiniMax account. The title says so, and it always will.

import type { LedgerDay, LedgerSummary } from "./session-ledger.ts";
import type { ViewTheme } from "./view-theme.ts";
import { fitVisible, padVisible, visibleWidth } from "./view-frame.ts";

export interface DetailsViewOptions {
  /** Length of the window in days. Defaults to `summary.windowDays`. */
  windowDays?: number;
  /**
   * Epoch the window ends on. Defaults to the last day of the ledger, which
   * keeps the renderer deterministic; the caller passes the current time so
   * the window is the trailing one, the way the console counts it.
   */
  now?: number;
  /**
   * Minutes east of UTC of the calendar day the ledger buckets with. Defaults
   * to the offset the summary was built with.
   */
  tzOffsetMinutes?: number;
}

/** Daily trend ramp, from the lowest to the highest day. */
const TREND_RAMP = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];

/** Heatmap ramp, from the lowest to the highest day. */
const HEAT_RAMP = ["░", "▒", "▓", "█"];

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const DAY_MS = 86_400_000;
const LABEL_WIDTH = 16;
const TITLE = "MiniMax · Pi usage (local)";

/**
 * Paints the MiniMax console shape for the local ledger:
 * the headline numbers, the daily trend, the weekday × week heatmap and the
 * cumulative block.
 */
export function renderDetailsView(
  summary: LedgerSummary,
  theme: ViewTheme,
  width: number,
  options?: DetailsViewOptions,
): string[] {
  const windowDays = normalizeWindowDays(options?.windowDays ?? summary.windowDays);
  // The window ends on the same local day the ledger buckets with: the local
  // day of `now`, not its UTC day. Otherwise a same day entry falls outside
  // the window in the timezones east of UTC.
  const offset = options?.tzOffsetMinutes ?? summary.tzOffsetMinutes ?? 0;
  const anchorDay =
    options?.now !== undefined ? localDayKey(options.now, offset) : lastDayOf(summary.days);
  const days = windowOf(summary.days, windowDays, anchorDay);

  if (days.length === 0) {
    const message = `No local MiniMax usage in the last ${windowDays} days.`;
    return [fitVisible(theme.muted(message), width)];
  }

  // The summary already carries the aggregates of its own window, so they are
  // used as they are. Only a narrowed window has to be summed again.
  const sameWindow = windowDays === summary.windowDays;
  const totals = sameWindow ? summary.totals : sumDays(days);
  const cacheHitRate = sameWindow ? summary.cacheHitRate : hitRate(totals);
  const dailyAverage = sameWindow ? summary.dailyAverage : totals.totalTokens / windowDays;
  const peak = sameWindow ? (summary.peakDay?.totalTokens ?? 0) : peakOf(days);
  const activeDays = sameWindow ? summary.activeDays : days.length;

  const byDay = new Map<string, number>();
  for (const day of days) byDay.set(day.day, day.totalTokens);

  const endMs = dayStart(anchorDay);
  const startMs = endMs - (windowDays - 1) * DAY_MS;
  const values = Array.from({ length: windowDays }, (_, index) => {
    const key = dayKey(startMs + index * DAY_MS);
    return byDay.get(key) ?? 0;
  });
  const busiest = Math.max(0, ...values);

  const lines: string[] = [];

  lines.push(header(theme, windowDays, width));
  lines.push(fitVisible(theme.separator("─".repeat(Math.max(0, width))), width));

  lines.push(metric(theme, "LLM", `${formatTokens(totals.totalTokens)} tokens`));
  lines.push(metric(theme, "Cache hit", `${(cacheHitRate * 100).toFixed(1)}%`));
  lines.push(metric(theme, "Daily avg", formatTokens(dailyAverage)));
  lines.push(metric(theme, "Cost", `$${totals.cost.toFixed(2)}`));

  lines.push("");
  lines.push(section(theme, `Daily trend (${windowDays}d)`));
  lines.push(` ${theme.accent(values.map((value) => trendGlyph(value, busiest)).join(""))}`);
  lines.push(dateRow(theme, startMs, endMs, width));

  lines.push("");
  lines.push(section(theme, "Heatmap (weekday × week)"));
  lines.push(...heatmap(theme, byDay, startMs, endMs, busiest));

  lines.push("");
  lines.push(
    ` ${theme.muted(
      `${formatTokens(totals.totalTokens)} total · ${formatTokens(peak)} peak · ${activeDays} active days`,
    )}`,
  );

  return lines.map((line) => fitVisible(line, width));
}

/**
 * Formats a token count the way the console does: human suffixes with two
 * decimals. Counts below a thousand are printed as they are.
 */
export function formatTokens(value: number): string {
  if (!Number.isFinite(value)) return "0";
  const magnitude = Math.abs(value);
  if (magnitude >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (magnitude >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  if (magnitude >= 1e3) return `${(value / 1e3).toFixed(2)}K`;
  return value.toFixed(0);
}

function header(theme: ViewTheme, windowDays: number, width: number): string {
  const title = theme.title(TITLE);
  const label = theme.muted(`last ${windowDays} days`);
  const gap = Math.max(1, width - 1 - visibleWidth(title) - visibleWidth(label));
  return ` ${padVisible(title, visibleWidth(title) + gap)}${label}`;
}

function metric(theme: ViewTheme, label: string, value: string): string {
  return ` ${theme.label(padVisible(label, LABEL_WIDTH))} ${theme.value(value)}`;
}

function section(theme: ViewTheme, text: string): string {
  return ` ${theme.label(text)}`;
}

function dateRow(theme: ViewTheme, startMs: number, endMs: number, width: number): string {
  const first = theme.muted(monthDay(startMs));
  const last = theme.muted(monthDay(endMs));
  const gap = Math.max(1, width - 1 - visibleWidth(first) - visibleWidth(last));
  return ` ${padVisible(first, visibleWidth(first) + gap)}${last}`;
}

function heatmap(
  theme: ViewTheme,
  byDay: Map<string, number>,
  startMs: number,
  endMs: number,
  busiest: number,
): string[] {
  // The weeks are calendar weeks, from Monday to Sunday, so the first column
  // starts on the Monday on or before the first day of the window.
  const anchor = startMs - weekdayIndex(startMs) * DAY_MS;
  const columns = Math.floor((endMs - anchor) / DAY_MS / 7) + 1;

  return WEEKDAYS.map((weekday, row) => {
    let cells = "";
    for (let column = 0; column < columns; column++) {
      const dayMs = anchor + (column * 7 + row) * DAY_MS;
      const inside = dayMs >= startMs && dayMs <= endMs;
      const value = inside ? (byDay.get(dayKey(dayMs)) ?? 0) : 0;
      cells += heatGlyph(value, busiest);
    }
    return ` ${theme.label(padVisible(weekday, 3))} ${theme.value(cells)}`;
  });
}

function trendGlyph(value: number, busiest: number): string {
  if (value <= 0 || busiest <= 0) return TREND_RAMP[0];
  const level = Math.min(
    TREND_RAMP.length - 1,
    Math.max(1, rampLevel(value, busiest, TREND_RAMP.length)),
  );
  return TREND_RAMP[level];
}

function heatGlyph(value: number, busiest: number): string {
  if (value <= 0 || busiest <= 0) return HEAT_RAMP[0];
  const level = Math.min(
    HEAT_RAMP.length - 1,
    Math.max(1, rampLevel(value, busiest, HEAT_RAMP.length)),
  );
  return HEAT_RAMP[level];
}

/** Level of a value in a ramp of `steps` cells, the busiest day on the top. */
function rampLevel(value: number, busiest: number, steps: number): number {
  return Math.ceil((value / busiest) * steps) - 1;
}

/**
 * The days of the window: the trailing `windowDays` days that end on the
 * anchor day. Days without usage are part of the window too.
 */
function windowOf(days: readonly LedgerDay[], windowDays: number, anchorDay: string): LedgerDay[] {
  if (days.length === 0) return [];
  const endMs = dayStart(anchorDay);
  const startMs = endMs - (windowDays - 1) * DAY_MS;
  return days.filter((day) => {
    const ms = dayStart(day.day);
    return ms >= startMs && ms <= endMs;
  });
}

function lastDayOf(days: readonly LedgerDay[]): string {
  if (days.length === 0) return "";
  return days.reduce((last, day) => (day.day > last ? day.day : last), days[0].day);
}

function sumDays(days: readonly LedgerDay[]): LedgerSummary["totals"] {
  const totals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: 0 };
  for (const day of days) {
    totals.input += day.input;
    totals.output += day.output;
    totals.cacheRead += day.cacheRead;
    totals.cacheWrite += day.cacheWrite;
    totals.totalTokens += day.totalTokens;
    totals.cost += day.cost;
  }
  return totals;
}

/** Cache hit rate: `cacheRead / (input + cacheRead + cacheWrite)`. */
function hitRate(totals: LedgerSummary["totals"]): number {
  const denominator = totals.input + totals.cacheRead + totals.cacheWrite;
  if (denominator === 0) return 0;
  return totals.cacheRead / denominator;
}

function peakOf(days: readonly LedgerDay[]): number {
  return days.reduce((peak, day) => Math.max(peak, day.totalTokens), 0);
}

function normalizeWindowDays(windowDays: number): number {
  if (!Number.isFinite(windowDays) || windowDays < 1) return 30;
  return Math.floor(windowDays);
}

/** Epoch of a `YYYY-MM-DD` day at UTC midnight. */
function dayStart(day: string): number {
  const parsed = Date.parse(`${day}T00:00:00Z`);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/** `YYYY-MM-DD` key of an epoch. */
function dayKey(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10);
}

/** Local calendar day key (`YYYY-MM-DD`) of an epoch. */
function localDayKey(epochMs: number, tzOffsetMinutes: number): string {
  return new Date(epochMs + tzOffsetMinutes * 60_000).toISOString().slice(0, 10);
}

/** `MM-DD` label of an epoch. */
function monthDay(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(5, 10);
}

/** Index of the weekday, Monday first. */
function weekdayIndex(epochMs: number): number {
  return (new Date(epochMs).getUTCDay() + 6) % 7;
}
