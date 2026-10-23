// Console-style consumption view for the local MiniMax ledger (S2).
//
// The renderer is a pure function: it reads a `LedgerSummary` and returns the
// lines of the view. It never touches the filesystem, the clock or the
// network, so the same summary always paints the same view.
//
// The view is a full screen tabbed screen: the header and the tab bar are
// always drawn, but only the content of the active tab is painted below
// them. Each tab therefore uses the whole width of the terminal.
//
// The screen itself floats over the transcript: the overlay takes the whole
// width and the whole height of the terminal, and the component pads its
// lines with blanks until it reaches the bottom of the screen.
//
// Scope: the numbers come from the local Pi session ledger, never from the
// MiniMax account. The title says so, and it always will.

import type { LedgerDay, LedgerDayModel, LedgerModel, LedgerSummary } from "./session-ledger.ts";
import type { ViewTheme } from "./view-theme.ts";
import { fitVisible, padVisible, visibleWidth } from "./view-frame.ts";

/** The tabs of the details view, in the order of the tab bar. */
export const DETAILS_TABS = ["overview", "trend", "heatmap", "models"] as const;

/** The tab the details view paints. */
export type DetailsTab = (typeof DETAILS_TABS)[number];

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
  /** The tab to paint. Defaults to `overview`. */
  tab?: DetailsTab;
  /**
   * The day of the window to detail, by index: 0 is the first day of the
   * window. When it is not given the last day of the window is used.
   *
   * The selection is an input of the renderer, never internal state: the
   * same options always paint the same view.
   */
  selectedDay?: number;
  /** Rows of the trend chart. Defaults to `DEFAULT_TREND_ROWS`. */
  trendRows?: number;
}

/** The label of every tab of the tab bar. */
const TAB_LABELS: Record<DetailsTab, string> = {
  overview: "Overview",
  trend: "Trend",
  heatmap: "Heatmap",
  models: "Models",
};

/** Height of the daily trend chart, in rows. */
export const DEFAULT_TREND_ROWS = 8;

/**
 * The line of the view where the content of the tab starts: the header, the
 * separator, the tab bar and a blank line come before it.
 */
export const DETAILS_CONTENT_ROW = 4;

/** Heatmap ramp, from the emptiest cell to the busiest. */
const HEAT_RAMP = ["░", "▒", "▓", "█"];

/** The swatch of the legend of the models: a solid chip, not a chart cell. */
const MODEL_SWATCH = "■";

/** Columns of every cell of the calendar: two, so the grid reads as blocks. */
const HEAT_CELL_WIDTH = 2;

/** The cells the label of a weekday takes in the calendar: " Mon ". */
const HEAT_LABEL_WIDTH = 5;

/** The rows of the calendar: one per weekday. */
export const HEATMAP_ROWS = 7;

/**
 * The weight scale of the heatmap, without a theme: the geometry of the
 * calendar needs its width, and the theme only paints it.
 */
const HEAT_LEGEND_TEXT = " poco ░▒▓█ mucho";

/** The visible width of the weight scale of the heatmap. */
const HEAT_LEGEND_WIDTH = visibleWidth(HEAT_LEGEND_TEXT);

/** The title of the section of the trend tab. */
const TREND_TITLE = "Daily trend";

/** The rows the title of the section of the trend tab takes. */
const TREND_TITLE_ROWS = 1;

/** Cells of the bar of each model, and the width of its name. */
const MODEL_BAR_CELLS = 12;
const MODEL_NAME_WIDTH = 26;

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const DAY_MS = 86_400_000;
const TITLE = "🐙 MiniMax · Pi usage (local)";
const HINTS = "↑↓ scroll · ←→ day · tab cambia · r refresh · esc close";

/**
 * Paints the MiniMax console shape for the local ledger.
 *
 * The returned lines are the whole screen of the active tab: the header, the
 * separator, the tab bar, the content of the tab and the hints.
 */
export function renderDetailsView(
  summary: LedgerSummary,
  theme: ViewTheme,
  width: number,
  options?: DetailsViewOptions,
): string[] {
  const ctx = buildContext(summary, options);
  if (!ctx) {
    const windowDays = normalizeWindowDays(options?.windowDays ?? summary.windowDays);
    const message = `No local MiniMax usage in the last ${windowDays} days.`;
    return [fitVisible(theme.muted(message), width)];
  }

  const tab = options?.tab ?? "overview";
  const lines: string[] = [
    header(theme, ctx.windowDays, width),
    fitVisible(theme.separator("─".repeat(Math.max(0, width))), width),
    tabBar(theme, tab),
    "",
    ...tabContent(tab, theme, width, ctx),
    "",
    ` ${theme.muted(HINTS)}`,
  ];

  return lines.map((line) => fitVisible(line, width));
}

/**
 * Everything the tabs of the view need, computed once.
 *
 * The window of the view, its days with the models that made them, the
 * ranking of the models and the day that is selected. It is the same for
 * every tab: the trend and the heatmap share the selection.
 */
interface ViewContext {
  windowDays: number;
  totals: LedgerSummary["totals"];
  cacheHitRate: number;
  dailyAverage: number;
  peak: number;
  activeDays: number;
  /** Every day of the window, with the models that made it. */
  trendDays: readonly TrendDay[];
  /** The models of the window, busiest first. */
  windowModels: readonly LedgerDayModel[];
  /** The color of every model of the window: its index in the ranking. */
  colors: ReadonlyMap<string, number>;
  /** The day the view details. */
  selected: TrendDay | undefined;
  busiest: number;
  startMs: number;
  endMs: number;
  trendRows: number;
  models: readonly LedgerModel[];
  /** Every day of the ledger, the ones of the window included. */
  history: readonly LedgerDay[];
}

/**
 * Builds the context of the view.
 *
 * It returns `undefined` when the window carries no usage at all: the view
 * says so instead of painting zeros.
 */
function buildContext(
  summary: LedgerSummary,
  options?: DetailsViewOptions,
): ViewContext | undefined {
  const windowDays = normalizeWindowDays(options?.windowDays ?? summary.windowDays);
  // The window ends on the same local day the ledger buckets with: the local
  // day of `now`, not its UTC day. Otherwise a same day entry falls outside
  // the window in the timezones east of UTC.
  const offset = options?.tzOffsetMinutes ?? summary.tzOffsetMinutes ?? 0;
  const anchorDay =
    options?.now !== undefined ? localDayKey(options.now, offset) : lastDayOf(summary.days);
  const days = windowOf(summary.days, windowDays, anchorDay);

  if (days.length === 0) return undefined;

  // The summary already carries the aggregates of its own window, so they are
  // used as they are. Only a narrowed window has to be summed again.
  const sameWindow = windowDays === summary.windowDays;
  const totals = sameWindow ? summary.totals : sumDays(days);
  const cacheHitRate = sameWindow ? summary.cacheHitRate : hitRate(totals);
  const dailyAverage = sameWindow ? summary.dailyAverage : totals.totalTokens / windowDays;
  const peak = sameWindow ? (summary.peakDay?.totalTokens ?? 0) : peakOf(days);
  const activeDays = sameWindow ? summary.activeDays : days.length;

  const byDay = new Map<string, number>();
  const modelsByDay = new Map<string, LedgerDayModel[]>();
  for (const day of days) {
    byDay.set(day.day, day.totalTokens);
    modelsByDay.set(day.day, Array.isArray(day.models) ? day.models : []);
  }

  const endMs = dayStart(anchorDay);
  const startMs = endMs - (windowDays - 1) * DAY_MS;
  // Every day of the window, the empty ones included, with the models that
  // made it: the trend stacks the column of the day with them.
  const trendDays: TrendDay[] = [];
  for (let index = 0; index < windowDays; index++) {
    const key = dayKey(startMs + index * DAY_MS);
    trendDays.push({
      day: key,
      totalTokens: byDay.get(key) ?? 0,
      models: modelsByDay.get(key) ?? [],
    });
  }
  const busiest = Math.max(0, ...trendDays.map((day) => day.totalTokens));
  // The models of the window, busiest first: they own the colors of the
  // chart, of the legend and of the detail.
  const windowModels = rankModels(trendDays);
  const colors = colorIndexes(windowModels);
  const selected = trendDays[clampIndex(options?.selectedDay, trendDays.length)] ?? trendDays[0];

  const trendRows = normalizeTrendRows(options?.trendRows ?? DEFAULT_TREND_ROWS);
  // The heatmap draws the whole history of the ledger. A summary without one
  // falls back to the days of its window.
  const history = summary.history?.length ? summary.history : summary.days;

  return {
    windowDays,
    totals,
    cacheHitRate,
    dailyAverage,
    peak,
    activeDays,
    trendDays,
    windowModels,
    colors,
    selected,
    busiest,
    startMs,
    endMs,
    trendRows,
    models: summary.models,
    history,
  };
}

/** A day of the window, with the models that made it. */
interface TrendDay {
  day: string;
  totalTokens: number;
  models: readonly LedgerDayModel[];
}

/** The content of the active tab. */
function tabContent(tab: DetailsTab, theme: ViewTheme, width: number, ctx: ViewContext): string[] {
  switch (tab) {
    case "trend":
      return trendContent(theme, width, ctx);
    case "heatmap":
      return heatmapContent(theme, width, ctx);
    case "models":
      return modelsContent(theme, ctx);
    case "overview":
      return overviewContent(theme, width, ctx);
  }
}

/**
 * The overview: the headline metrics in four columns (a row of labels and a
 * row of values) and the cumulative footer.
 */
function overviewContent(theme: ViewTheme, width: number, ctx: ViewContext): string[] {
  // The four columns share the width of the view, minus the leading space.
  const columnWidth = Math.max(1, Math.floor((width - 1) / 4));
  const labels = ["LLM", "Cache hit", "Daily avg", "Cost"];
  const values = [
    `${formatTokens(ctx.totals.totalTokens)} tokens`,
    `${(ctx.cacheHitRate * 100).toFixed(1)}%`,
    formatTokens(ctx.dailyAverage),
    `$${ctx.totals.cost.toFixed(2)}`,
  ];

  const labelRow = labels.map((label) => theme.label(padVisible(label, columnWidth))).join("");
  const valueRow = values.map((value) => theme.value(padVisible(value, columnWidth))).join("");

  const footer = `${formatTokens(ctx.totals.totalTokens)} total · ${formatTokens(ctx.peak)} peak · ${ctx.activeDays} active days`;

  return [` ${labelRow}`.trimEnd(), ` ${valueRow}`.trimEnd(), "", ` ${theme.muted(footer)}`];
}

/**
 * The trend: the legend of the models, the daily column chart with the dates
 * under it and the detail of the selected day.
 *
 * The legend comes BEFORE the chart: the eye reads it first and keeps it as
 * the context of the bars that follow.
 */
function trendContent(theme: ViewTheme, width: number, ctx: ViewContext): string[] {
  // The chart takes the whole width of the view: every day gets its own
  // group of cells, and the leftover cells are spread between the days.
  const layout = chartLayout(Math.max(1, width - 1), ctx.trendDays.length);
  const chartWidth = layout.groups.reduce((total, group) => total + group, 0);
  return [
    ` ${theme.label(TREND_TITLE)}`,
    ...modelLegend(theme, ctx.windowModels, ctx.colors, width),
    ...trendChart(theme, ctx.trendDays, ctx.busiest, ctx.trendRows, layout, ctx.colors),
    dateRow(theme, ctx.startMs, ctx.endMs, chartWidth + 1),
    "",
    ...dayDetail(theme, ctx.selected, ctx.colors, width),
  ];
}

/** The cells of the chart: the group of every day and the width of a bar. */
interface ChartLayout {
  /** The cells of every day: its bar and the separator that follows it. */
  groups: number[];
  /** The cells of the bar of a day, the same for every day. */
  bar: number;
}

/**
 * The layout of the daily chart.
 *
 * A day is a bar of cells and the separator that keeps it apart from the
 * next one. The cells left over are spread between the days, so the chart
 * fills the width of the view without a day merging with the next.
 */
function chartLayout(available: number, days: number): ChartLayout {
  if (days <= 0) return { groups: [], bar: 1 };
  const cellsPerDay = Math.max(1, Math.floor(available / days));
  const extra = Math.max(0, available - cellsPerDay * days);
  const groups: number[] = [];
  for (let index = 0; index < days; index++) {
    const wide = Math.floor((index * extra) / days) !== Math.floor(((index + 1) * extra) / days);
    groups.push(cellsPerDay + (wide ? 1 : 0));
  }
  // The bar of a day is the same width for every day: only the separator
  // between two days grows when the view is wider than the window needs.
  const bar = cellsPerDay === 1 ? 1 : cellsPerDay - 1;
  return { groups, bar };
}

/**
 * The heatmap: the weekday × week grid over the whole history, with the
 * weight scale at its right and the detail of the selected day under it.
 */
function heatmapContent(theme: ViewTheme, width: number, ctx: ViewContext): string[] {
  // The grid draws the WHOLE history of the ledger, not only the window:
  // a month of history is five columns wide, too small to read.
  const byDay = new Map<string, number>();
  let startMs = 0;
  let endMs = 0;
  let busiest = 0;
  for (const day of ctx.history) {
    byDay.set(day.day, day.totalTokens);
    const ms = dayStart(day.day);
    if (startMs === 0 || ms < startMs) startMs = ms;
    if (ms > endMs) endMs = ms;
    if (day.totalTokens > busiest) busiest = day.totalTokens;
  }
  if (startMs === 0) return [` ${theme.muted("No local MiniMax usage.")}`];

  const geometry = calendarGeometry(startMs, endMs, width);
  // The day that is selected is the one of the window: the calendar marks
  // it when it is inside of it.
  const selectedMs = ctx.selected ? dayStart(ctx.selected.day) : 0;

  return [
    ...heatmap(theme, byDay, geometry, busiest, selectedMs),
    "",
    ...dayDetail(theme, ctx.selected, ctx.colors, width),
  ];
}

/** The models: what was spent per model, with a bar per model. */
function modelsContent(theme: ViewTheme, ctx: ViewContext): string[] {
  if (ctx.models.length === 0) return [` ${theme.muted("No model usage in the window.")}`];
  return modelRows(theme, ctx.models, ctx.totals.totalTokens);
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

/**
 * The tab bar: the four tabs, the active one in the accent role and in
 * bold, the others muted.
 */
function tabBar(theme: ViewTheme, active: DetailsTab): string {
  const tabs = DETAILS_TABS.map((tab) => {
    // Only the active tab is bracketed: without colors the brackets are what
    // says which tab is open.
    if (tab === active) return theme.bold(theme.accent(`[${TAB_LABELS[tab]}]`));
    return theme.muted(TAB_LABELS[tab]);
  });
  return ` ${tabs.join("  ")}`;
}

function dateRow(theme: ViewTheme, startMs: number, endMs: number, width: number): string {
  const first = theme.muted(monthDay(startMs));
  const last = theme.muted(monthDay(endMs));
  const gap = Math.max(1, width - 1 - visibleWidth(first) - visibleWidth(last));
  return ` ${padVisible(first, visibleWidth(first) + gap)}${last}`;
}

/**
 * The geometry of the calendar of the heatmap.
 *
 * The weeks are calendar weeks, from Monday to Sunday, so the first column
 * starts on the Monday on or before the first day of the history.
 */
interface CalendarGeometry {
  /** The Monday on or before the first day of the history. */
  anchorMs: number;
  /** The first day of the history. */
  startMs: number;
  /** The last day of the history. */
  endMs: number;
  /** The weeks of the calendar, the drawn ones and the ones before them. */
  calendarColumns: number;
  /** The columns of the calendar that are drawn. */
  columns: number;
  /** The first drawn column, inside the calendar. */
  firstColumn: number;
}

/**
 * The geometry of the calendar: the weeks it covers and the ones it draws.
 *
 * The calendar takes the room the weight scale leaves: a long history shows
 * its most recent weeks instead of running past the edge of the view.
 */
function calendarGeometry(startMs: number, endMs: number, width: number): CalendarGeometry {
  const anchorMs = startMs - weekdayIndex(startMs) * DAY_MS;
  const calendarColumns = Math.floor((endMs - anchorMs) / DAY_MS / 7) + 1;
  const room = Math.floor((width - HEAT_LABEL_WIDTH - HEAT_LEGEND_WIDTH - 2) / HEAT_CELL_WIDTH);
  const columns = Math.max(1, Math.min(calendarColumns, room));
  return {
    anchorMs,
    startMs,
    endMs,
    calendarColumns,
    columns,
    firstColumn: calendarColumns - columns,
  };
}

function heatmap(
  theme: ViewTheme,
  byDay: Map<string, number>,
  geometry: CalendarGeometry,
  busiest: number,
  selectedMs: number,
): string[] {
  // The weight scale sits to the right of the calendar, on its middle row.
  const legend = heatLegend(theme);
  const legendRow = Math.floor(WEEKDAYS.length / 2);

  return WEEKDAYS.map((weekday, row) => {
    let cells = "";
    for (let column = 0; column < geometry.columns; column++) {
      const dayMs = geometry.anchorMs + ((geometry.firstColumn + column) * 7 + row) * DAY_MS;
      const inside = dayMs >= geometry.startMs && dayMs <= geometry.endMs;
      // The days outside the window are not cells: painting them would draw
      // a stripe of empty days that reads like a column of usage.
      if (!inside) {
        cells += " ".repeat(HEAT_CELL_WIDTH);
        continue;
      }
      const value = byDay.get(dayKey(dayMs)) ?? 0;
      cells += heatCell(theme, value, busiest, dayMs === selectedMs).repeat(HEAT_CELL_WIDTH);
    }
    const right = row === legendRow ? `  ${legend}` : "";
    return ` ${theme.label(padVisible(weekday, 3))} ${cells}${right}`;
  });
}

/**
 * A heatmap cell: its shape and its color come from the level of the day.
 *
 * The cell of the day that is selected stands out from the scale of the
 * calendar.
 */
function heatCell(theme: ViewTheme, value: number, busiest: number, selected: boolean): string {
  const level = heatLevel(value, busiest);
  const glyph = HEAT_RAMP[level] ?? HEAT_RAMP[0];
  if (selected) return theme.bold(theme.accent(glyph));
  return theme.heat(level, glyph);
}

/** The level of a day in the heat scale: 0 is empty, the last one is the busiest. */
function heatLevel(value: number, busiest: number): number {
  if (value <= 0 || busiest <= 0) return 0;
  return Math.min(
    HEAT_RAMP.length - 1,
    Math.max(1, Math.ceil((value / busiest) * (HEAT_RAMP.length - 1))),
  );
}

/**
 * The daily trend as a column chart: one column per day, `rows` tall.
 * A baseline ramp reads as a squeezed line instead of bars, which is what the
 * shell draws instead.
 *
 * Every column is STACKED BY MODEL: the cells of the column belong to the
 * models of the day, each one painted with the color of its model, so a
 * column shows at a glance how the day was spent.
 */
function trendChart(
  theme: ViewTheme,
  days: readonly TrendDay[],
  busiest: number,
  rows: number,
  layout: ChartLayout,
  colors: ReadonlyMap<string, number>,
): string[] {
  const heights = days.map((day) => barHeight(day.totalTokens, busiest, rows));
  const stacks = days.map((day, index) => stackOf(day, heights[index] ?? 0));
  const chart: string[] = [];
  for (let row = rows - 1; row >= 0; row -= 1) {
    let line = "";
    for (const [index, height] of heights.entries()) {
      const group = layout.groups[index] ?? 1;
      // The last cells of the group are the separator that keeps two days
      // apart: the bars never merge into one blob.
      const separator = Math.max(0, group - layout.bar);
      const stack: readonly string[] | undefined = stacks[index];
      const model = stack?.[row];
      if (row < height && model !== undefined) {
        line +=
          modelPaint(theme, colors.get(model) ?? 0, "▌".repeat(layout.bar)) + " ".repeat(separator);
      } else if (row < height) {
        // A day with usage but without a breakdown keeps the accent color of
        // the chart.
        line += theme.accent("▌".repeat(layout.bar)) + " ".repeat(separator);
      } else {
        line += " ".repeat(group);
      }
    }
    chart.push(` ${line.trimEnd()}`);
  }
  return chart;
}

/**
 * The cells of the column of a day, from the bottom up: one segment per
 * model, in the share of the day of each one.
 *
 * The segments are proportional, and the rounding never loses a model: every
 * model that has usage keeps a cell while the column is tall enough. A
 * column that is too short keeps the cells of the busiest models.
 */
function stackOf(day: TrendDay, height: number): string[] {
  if (height <= 0) return [];
  const models = day.models.filter((model) => model.totalTokens > 0).sort(byTokens);
  if (models.length === 0) return [];
  if (models.length > height) {
    // The column is too short for every model: the busiest ones keep a cell.
    return models.slice(0, height).map((model) => model.model);
  }

  // Every model starts with one cell and the rest is shared with the size of
  // its share of the day.
  const extra = height - models.length;
  const total = models.reduce((sum, model) => sum + model.totalTokens, 0);
  const shares = models.map((model) => (total > 0 ? model.totalTokens / total : 1 / models.length));
  const ideals = shares.map((share) => extra * share);
  // Every model keeps one cell and the share of the extra cells that its
  // size of the day earns.
  const counts = ideals.map((ideal) => 1 + Math.floor(ideal));
  let left = extra - ideals.reduce((sum, ideal) => sum + Math.floor(ideal), 0);
  const order = ideals
    .map((ideal, index) => ({ index, rest: ideal - Math.floor(ideal) }))
    .sort((a, b) => b.rest - a.rest || a.index - b.index);
  for (const entry of order) {
    if (left <= 0) break;
    counts[entry.index] += 1;
    left -= 1;
  }

  const stack: string[] = [];
  for (const [index, model] of models.entries()) {
    for (let cell = 0; cell < counts[index]; cell += 1) stack.push(model.model);
  }
  return stack;
}

/**
 * The models of the window, busiest first: the ranking owns the colors of
 * the chart, of the legend and of the detail.
 */
function rankModels(days: readonly TrendDay[]): LedgerDayModel[] {
  const totals = new Map<string, LedgerDayModel>();
  for (const day of days) {
    for (const model of day.models) {
      const current = totals.get(model.model) ?? {
        model: model.model,
        totalTokens: 0,
        cost: 0,
        messages: 0,
      };
      current.totalTokens += model.totalTokens;
      current.cost += model.cost;
      current.messages += model.messages;
      totals.set(model.model, current);
    }
  }
  return [...totals.values()].sort(byTokens);
}

/** The color of every model: its place in the ranking of the window. */
function colorIndexes(models: readonly LedgerDayModel[]): Map<string, number> {
  const colors = new Map<string, number>();
  models.forEach((model, index) => colors.set(model.model, index));
  return colors;
}

/**
 * The legend of the models: one entry per model of the window, with the
 * swatch of its color, its name and its share of the window.
 *
 * The entries sit HORIZONTALLY, one next to the other and separated by two
 * spaces: the legend is read as a line, before the chart it explains.
 */
function modelLegend(
  theme: ViewTheme,
  models: readonly LedgerDayModel[],
  colors: ReadonlyMap<string, number>,
  width: number,
): string[] {
  if (models.length === 0) return [` ${theme.muted("No model usage in the window.")}`];
  const entries = legendEntries(models);
  return legendGroups(entries, width).map(
    (group) => ` ${group.map((index) => legendEntry(theme, entries[index], colors)).join("  ")}`,
  );
}

/** An entry of the legend: the model, its share and how wide it is. */
interface LegendEntry {
  /** The name of the model. */
  model: string;
  /** The name of the model, padded so the shares line up. */
  label: string;
  /** The share of the window of the model, in percent. */
  share: number;
  /** The visible width of the whole entry. */
  width: number;
}

/**
 * The entries of the legend of the window: the swatch, the name of the model
 * and its share of the window.
 *
 * The names are padded to the width of the longest one, so the shares of the
 * entries line up when they share a line.
 */
function legendEntries(models: readonly LedgerDayModel[]): LegendEntry[] {
  const total = models.reduce((sum, model) => sum + model.totalTokens, 0);
  const nameWidth = models.reduce((max, model) => Math.max(max, visibleWidth(model.model)), 0);
  return models.map((model) => {
    const share = total > 0 ? Math.round((model.totalTokens / total) * 100) : 0;
    const label = padVisible(model.model, nameWidth);
    return {
      model: model.model,
      label,
      share,
      width: visibleWidth(`${MODEL_SWATCH} ${label} ${share}%`),
    };
  });
}

/** The painted text of an entry of the legend. */
function legendEntry(
  theme: ViewTheme,
  entry: LegendEntry,
  colors: ReadonlyMap<string, number>,
): string {
  const swatch = modelPaint(theme, colors.get(entry.model) ?? 0, MODEL_SWATCH);
  return `${swatch} ${theme.label(entry.label)} ${theme.muted(`${entry.share}%`)}`;
}

/**
 * The entries of the legend, grouped by the line they share.
 *
 * The entries sit one next to the other, separated by two spaces, and they
 * wrap to the next line when they do not fit in the width of the view.
 */
function legendGroups(entries: readonly LegendEntry[], width: number): number[][] {
  const groups: number[][] = [];
  let current: number[] = [];
  // The line starts with the space that separates it from the border.
  let used = 1;
  for (const [index, entry] of entries.entries()) {
    const needed = entry.width + (current.length > 0 ? 2 : 0);
    if (current.length > 0 && used + needed > width) {
      groups.push(current);
      current = [index];
      used = 1 + entry.width;
      continue;
    }
    current.push(index);
    used += needed;
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

/**
 * The detail of the selected day: the day, its total and the models that
 * make it up, each one in the color of its model, with its tokens and its
 * share of the day.
 *
 * It is one logical line: it wraps when the view is too narrow for it.
 */
function dayDetail(
  theme: ViewTheme,
  day: TrendDay | undefined,
  colors: ReadonlyMap<string, number>,
  width: number,
): string[] {
  if (!day) return [` ${theme.muted("No day selected.")}`];
  const models = day.models.filter((model) => model.totalTokens > 0).sort(byTokens);
  if (day.totalTokens <= 0 || models.length === 0) {
    return [` ${theme.muted(`${day.day} · no usage`)}`];
  }
  const parts = [
    `${theme.value(day.day)} · ${theme.value(formatTokens(day.totalTokens))} tokens`,
    ...models.map((model) => {
      const share = Math.round((model.totalTokens / day.totalTokens) * 100);
      return `${modelPaint(theme, colors.get(model.model) ?? 0, model.model)} ${formatTokens(
        model.totalTokens,
      )} ${share}%`;
    }),
  ];
  return wrapParts(parts, width);
}

/**
 * Packs the parts of the detail into lines that fit the width: the detail is
 * one line that wraps when it does not fit.
 */
function wrapParts(parts: readonly string[], width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const part of parts) {
    const candidate = line === "" ? ` ${part}` : `${line} · ${part}`;
    if (line !== "" && visibleWidth(candidate) > width) {
      lines.push(line);
      line = ` ${part}`;
      continue;
    }
    line = candidate;
  }
  if (line !== "") lines.push(line);
  return lines;
}

/**
 * The day a click at the column `x` lands on, or `undefined` when the click
 * is not on a column of the chart.
 *
 * The chart starts at the second column of the view and every day owns a
 * group of cells: the bar of the day and the separator that follows it.
 */
export function trendDayAt(x: number, width: number, days: number): number | undefined {
  const layout = chartLayout(Math.max(1, width - 1), days);
  const cell = x - 1;
  if (cell < 0) return undefined;
  let start = 0;
  for (const [index, group] of layout.groups.entries()) {
    if (cell < start + group) {
      // Only the bar of the day is a column: the separator between two days
      // is not.
      return cell - start < layout.bar ? index : undefined;
    }
    start += group;
  }
  return undefined;
}

/**
 * The day the window of the view ends on: the local day of `now`.
 *
 * The caller and the renderer have to agree on it: the index of a day of the
 * window only means something with its anchor.
 */
export function windowAnchorDay(
  summary: LedgerSummary,
  now: number,
  offsetMinutes?: number,
): string {
  return localDayKey(now, offsetMinutes ?? summary.tzOffsetMinutes ?? 0);
}

/**
 * The row of the content of the trend tab where the chart starts: the title
 * of the section and the legend of the models come before it.
 */
export function trendChartTop(
  summary: LedgerSummary,
  width: number,
  options?: DetailsViewOptions,
): number {
  const ctx = buildContext(summary, options);
  if (!ctx) return 0;
  return TREND_TITLE_ROWS + legendGroups(legendEntries(ctx.windowModels), width).length;
}

/**
 * The index of the day of the calendar under the pointer, inside the window
 * of the view.
 *
 * `x` is the column of the cell and `y` its row (0 is Monday). A click
 * outside the calendar, or on a day that is not part of the window, changes
 * nothing: the selection is always an index of the window.
 */
export function heatmapSelectionAt(
  x: number,
  y: number,
  width: number,
  summary: LedgerSummary,
  now: number,
): number | undefined {
  if (y < 0 || y >= WEEKDAYS.length) return undefined;
  const history = summary.history?.length ? summary.history : summary.days;
  if (history.length === 0) return undefined;

  let startMs = 0;
  let endMs = 0;
  for (const day of history) {
    const ms = dayStart(day.day);
    if (startMs === 0 || ms < startMs) startMs = ms;
    if (ms > endMs) endMs = ms;
  }
  const geometry = calendarGeometry(startMs, endMs, width);
  const column = Math.floor((x - HEAT_LABEL_WIDTH) / HEAT_CELL_WIDTH);
  if (column < 0 || column >= geometry.columns) return undefined;

  const dayMs = geometry.anchorMs + ((geometry.firstColumn + column) * 7 + y) * DAY_MS;
  // The days outside the history are not cells of the calendar.
  if (dayMs < startMs || dayMs > endMs) return undefined;

  // The index of the day inside the window of the view.
  const anchor = windowAnchorDay(summary, now);
  const index = Math.round((dayMs - dayStart(anchor)) / DAY_MS) + (summary.windowDays - 1);
  if (index < 0 || index >= summary.windowDays) return undefined;
  return index;
}

/** Orders two models by the tokens they spent, the busiest one first. */
function byTokens(a: { totalTokens: number }, b: { totalTokens: number }): number {
  return b.totalTokens - a.totalTokens;
}

/**
 * Paints a text with the color of a model: a theme that does not paint the
 * models leaves the text unchanged.
 */
function modelPaint(theme: ViewTheme, index: number, text: string): string {
  return theme.model(index, text);
}

/** The height of a bar in rows: the share of the busiest day, at least one. */
function barHeight(value: number, busiest: number, rows: number): number {
  if (value <= 0 || busiest <= 0) return 0;
  return Math.min(rows, Math.max(1, Math.ceil((value / busiest) * rows)));
}

/** The scale of the heatmap: a weight scale with the color scale. */
/**
 * The scale of the heatmap: a weight scale with the color scale.
 *
 * Its plain text is `HEAT_LEGEND_TEXT`: the geometry of the calendar
 * reserves that width, and the theme only paints it.
 */
function heatLegend(theme: ViewTheme): string {
  const ramp = HEAT_RAMP.map((glyph, level) => theme.heat(level, glyph)).join("");
  return ` ${theme.muted("poco")} ${ramp} ${theme.muted("mucho")}`;
}

/**
 * What was spent, per model, with a bar per model.
 *
 * The busiest model fills the bar; the others are drawn against its track.
 */
function modelRows(
  theme: ViewTheme,
  models: readonly LedgerModel[],
  windowTokens: number,
): string[] {
  const busiest = models[0]?.totalTokens ?? 0;
  return models.map((model) => {
    const share = windowTokens > 0 ? model.totalTokens / windowTokens : 0;
    const filled =
      busiest > 0 ? Math.max(1, Math.round((model.totalTokens / busiest) * MODEL_BAR_CELLS)) : 0;
    const bar = `${theme.accent("▰".repeat(filled))}${theme.border("▱".repeat(MODEL_BAR_CELLS - filled))}`;
    const name =
      model.model.length > MODEL_NAME_WIDTH
        ? `${model.model.slice(0, MODEL_NAME_WIDTH - 1)}…`
        : model.model;
    return ` ${theme.label(padVisible(name, MODEL_NAME_WIDTH))} ${bar} ${theme.muted(
      padVisible(`${Math.round(share * 100)}%`, 4),
    )}`;
  });
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

function normalizeTrendRows(rows: number): number {
  if (!Number.isFinite(rows) || rows < 1) return DEFAULT_TREND_ROWS;
  return Math.floor(rows);
}

/**
 * The index of the selected day, clamped to the window: the last day of the
 * window when the selection is not given.
 */
function clampIndex(index: number | undefined, length: number): number {
  if (length <= 0) return 0;
  const wanted = index ?? length - 1;
  if (!Number.isFinite(wanted)) return length - 1;
  return Math.min(length - 1, Math.max(0, Math.floor(wanted)));
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
