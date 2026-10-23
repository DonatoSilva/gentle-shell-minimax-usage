import { test } from "node:test";
import assert from "node:assert/strict";

import { DETAILS_TABS, formatTokens, renderDetailsView } from "../lib/details-view.ts";
import type { LedgerDay, LedgerDayModel, LedgerSummary } from "../lib/session-ledger.ts";
import { truncateVisible, visibleWidth } from "../lib/view-frame.ts";
import { plainTheme, type ViewTheme } from "../lib/view-theme.ts";

const WIDTH = 80;

interface FixtureDay {
  day: string;
  totalTokens: number;
  cost: number;
}

/**
 * 15 active days inside the trailing 30 days window, ending on 2026-10-21.
 * The empty days around and between them are part of the window too.
 */
const FIXTURE_DAYS: FixtureDay[] = [
  { day: "2026-09-25", totalTokens: 654_430_000, cost: 1.23 },
  { day: "2026-09-27", totalTokens: 612_000_000, cost: 1.23 },
  { day: "2026-09-28", totalTokens: 598_000_000, cost: 1.23 },
  { day: "2026-09-30", totalTokens: 604_000_000, cost: 1.23 },
  { day: "2026-10-02", totalTokens: 551_000_000, cost: 1.23 },
  { day: "2026-10-03", totalTokens: 589_000_000, cost: 1.23 },
  { day: "2026-10-05", totalTokens: 570_000_000, cost: 1.23 },
  { day: "2026-10-07", totalTokens: 543_000_000, cost: 1.23 },
  { day: "2026-10-09", totalTokens: 517_000_000, cost: 1.23 },
  { day: "2026-10-12", totalTokens: 505_000_000, cost: 1.23 },
  { day: "2026-10-14", totalTokens: 496_000_000, cost: 1.23 },
  { day: "2026-10-16", totalTokens: 402_000_000, cost: 1.23 },
  { day: "2026-10-18", totalTokens: 388_000_000, cost: 1.23 },
  { day: "2026-10-19", totalTokens: 421_000_000, cost: 1.23 },
  { day: "2026-10-21", totalTokens: 299_570_000, cost: 1.2 },
];

/**
 * The older days of the ledger: they are outside the 30 day window, so the
 * summary keeps them only in its history. The heatmap draws them.
 */
const HISTORY_DAYS: FixtureDay[] = [
  { day: "2026-05-28", totalTokens: 120_000_000, cost: 0.4 },
  { day: "2026-06-11", totalTokens: 240_000_000, cost: 0.5 },
  { day: "2026-07-09", totalTokens: 330_000_000, cost: 0.6 },
  { day: "2026-08-06", totalTokens: 410_000_000, cost: 0.7 },
  { day: "2026-09-03", totalTokens: 480_000_000, cost: 0.8 },
];

/** 5.9% of the tokens are plain input, the rest are cache reads. */
function buildDay(spec: FixtureDay): LedgerDay {
  const input = (spec.totalTokens * 59) / 1000;
  return {
    day: spec.day,
    input,
    output: 0,
    cacheRead: spec.totalTokens - input,
    cacheWrite: 0,
    totalTokens: spec.totalTokens,
    cost: spec.cost,
    messages: 1,
    models: buildDayModels(spec),
  };
}

/**
 * The models of a day: the flash one carries 82% of the tokens and the other
 * one the 18% that are left.
 */
function buildDayModels(spec: FixtureDay): LedgerDayModel[] {
  return [
    {
      model: "MiniMax-M3.1-Flash-Preview",
      totalTokens: spec.totalTokens * 0.82,
      cost: spec.cost * 0.82,
      messages: 12,
    },
    {
      model: "MiniMax-M3",
      totalTokens: spec.totalTokens * 0.18,
      cost: spec.cost * 0.18,
      messages: 3,
    },
  ];
}

function buildSummary(days: FixtureDay[]): LedgerSummary {
  const built = days.map(buildDay);
  const totals = built.reduce(
    (acc, day) => ({
      input: acc.input + day.input,
      output: acc.output + day.output,
      cacheRead: acc.cacheRead + day.cacheRead,
      cacheWrite: acc.cacheWrite + day.cacheWrite,
      totalTokens: acc.totalTokens + day.totalTokens,
      cost: acc.cost + day.cost,
    }),
    { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: 0 },
  );
  const denominator = totals.input + totals.cacheRead + totals.cacheWrite;
  const peakDay = built.reduce((peak, day) =>
    !peak || day.totalTokens > peak.totalTokens ? day : peak,
  );

  return {
    provider: "minimax",
    days: built,
    // The history keeps every day of the ledger, the ones of the window
    // included: the heatmap draws all of it.
    history: [...HISTORY_DAYS, ...days].map(buildDay).sort((a, b) => (a.day < b.day ? -1 : 1)),
    totals,
    cacheHitRate: denominator === 0 ? 0 : totals.cacheRead / denominator,
    activeDays: built.length,
    windowDays: 30,
    dailyAverage: 258_370_000,
    peakDay,
    tzOffsetMinutes: 0,
    models: buildModels(totals),
  };
}

/** Two models: the flash one carries 82% of the tokens. */
function buildModels(totals: LedgerSummary["totals"]): LedgerSummary["models"] {
  return [
    {
      model: "MiniMax-M3.1-Flash-Preview",
      input: totals.input * 0.82,
      output: 0,
      cacheRead: totals.cacheRead * 0.82,
      cacheWrite: 0,
      totalTokens: totals.totalTokens * 0.82,
      cost: totals.cost * 0.82,
      messages: 12,
    },
    {
      model: "MiniMax-M3",
      input: totals.input * 0.18,
      output: 0,
      cacheRead: totals.cacheRead * 0.18,
      cacheWrite: 0,
      totalTokens: totals.totalTokens * 0.18,
      cost: totals.cost * 0.18,
      messages: 3,
    },
  ];
}

const SUMMARY: LedgerSummary = buildSummary(FIXTURE_DAYS);
const EMPTY_SUMMARY: LedgerSummary = {
  provider: "minimax",
  days: [],
  history: [],
  totals: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: 0 },
  cacheHitRate: 0,
  activeDays: 0,
  windowDays: 30,
  dailyAverage: 0,
  peakDay: undefined,
  tzOffsetMinutes: 0,
  models: [],
};

function render(summary: LedgerSummary = SUMMARY, width: number = WIDTH): string[] {
  return renderDetailsView(summary, plainTheme(), width);
}

function renderTab(
  tab: "overview" | "trend" | "heatmap" | "models",
  options: { width?: number; trendRows?: number; selectedDay?: number } = {},
): string[] {
  return renderDetailsView(SUMMARY, plainTheme(), options.width ?? WIDTH, {
    tab,
    trendRows: options.trendRows,
    selectedDay: options.selectedDay,
  });
}

/**
 * The detail of the selected day: the line that starts with its date and the
 * lines it wraps to, in whichever tab it is.
 */
function detailLines(lines: string[]): string {
  const hints = lines.findIndex((line) => line.includes("esc close"));
  const end = hints === -1 ? lines.length : hints;
  const start = lines.findIndex((line) => /^\s*\d{4}-\d{2}-\d{2}/.test(line));
  if (start === -1) return "";

  const block: string[] = [];
  for (let index = start; index < end; index += 1) {
    const line = lines[index] ?? "";
    if (line.trim() === "") break;
    block.push(line);
  }
  return block.join(" ").trim();
}

function lineWith(lines: string[], needle: string): string {
  const line = lines.find((candidate) => candidate.includes(needle));
  assert.ok(line !== undefined, `expected a line containing ${JSON.stringify(needle)}`);
  return line;
}

/** The weekday a heatmap row belongs to. */
function labelOf(row: string): string {
  const match = /(Mon|Tue|Wed|Thu|Fri|Sat|Sun)/.exec(row);
  return match?.[1] ?? "";
}

/** A theme that marks every slot, to see which one painted what. */
function markedTheme() {
  const accent: string[] = [];
  const bold: string[] = [];
  const muted: string[] = [];
  const theme: ViewTheme = {
    ...plainTheme(),
    accent: (text) => {
      accent.push(text);
      return `<accent>${text}</accent>`;
    },
    bold: (text) => {
      bold.push(text);
      return `<bold>${text}</bold>`;
    },
    muted: (text) => {
      muted.push(text);
      return `<muted>${text}</muted>`;
    },
    // The heat scale paints with ANSI, like the real theme: the width
    // helpers have to be able to measure the painted text.
    heat: (level, text) => `\x1b[9${level}m${text}\x1b[0m`,
  };
  return { theme, accent, bold, muted };
}

/**
 * The cells of a heatmap row: two columns per cell, and the weight scale that
 * sits at the right of the middle row is not a cell.
 */
function cellsOf(row: string): string[] {
  const label = labelOf(row);
  const chars = Array.from(row.slice(row.indexOf(label) + 4).split(/ {3}poco/)[0] ?? "");
  const cells: string[] = [];
  for (let index = 0; index < chars.length; index += 2) cells.push(chars[index] ?? "");
  return cells;
}

test("draws the four tabs in the tab bar", () => {
  const bar = renderTab("overview")[2] ?? "";

  assert.ok(bar.includes("Overview"), bar);
  assert.ok(bar.includes("Trend"), bar);
  assert.ok(bar.includes("Heatmap"), bar);
  assert.ok(bar.includes("Models"), bar);
  // Only the active tab is bracketed, and the tabs are separated by two spaces.
  assert.ok(bar.includes("[Overview]  Trend"), bar);
  assert.equal(bar.includes("[Trend]"), false);
});

test("paints the active tab in the accent role and in bold", () => {
  const { theme, accent, bold, muted } = markedTheme();

  renderDetailsView(SUMMARY, theme, 120, { tab: "trend" });

  assert.ok(accent.includes("[Trend]"), accent.join(","));
  assert.ok(
    bold.some((text) => text.includes("[Trend]")),
    bold.join(","),
  );
  // The inactive tabs are muted, and never accented nor bold.
  assert.ok(muted.includes("Overview"), muted.join(","));
  assert.equal(accent.includes("Overview"), false);
  assert.equal(
    bold.some((text) => text.includes("Overview")),
    false,
  );
  assert.equal(accent.includes("Heatmap"), false);
});

test("paints only the content of the active tab", () => {
  const overview = renderTab("overview").join("\n");
  const trend = renderTab("trend").join("\n");
  const heatmap = renderTab("heatmap").join("\n");
  const models = renderTab("models").join("\n");

  // The overview is the headline numbers, nothing else.
  assert.ok(overview.includes("LLM"));
  assert.equal(overview.includes("▌"), false);
  assert.equal(overview.includes("Mon"), false);
  assert.equal(overview.includes("MiniMax-M3"), false);

  // The trend is the chart alone.
  assert.ok(trend.includes("▌"));
  assert.equal(trend.includes("LLM"), false);
  assert.equal(trend.includes("Mon"), false);

  // The heatmap is the grid alone.
  assert.ok(heatmap.includes("Mon"));
  assert.equal(heatmap.includes("LLM"), false);
  assert.equal(heatmap.includes("▌"), false);

  // The models are the rows of the models alone.
  assert.ok(models.includes("MiniMax-M3.1-Flash-Preview"));
  assert.equal(models.includes("LLM"), false);
  assert.equal(models.includes("▌"), false);
});

test("draws the headline metrics in four columns", () => {
  const lines = renderTab("overview");
  const labels = lineWith(lines, "LLM");
  const values = lineWith(lines, "7.75B tokens");

  // A row of labels and a row of values.
  assert.ok(labels.includes("Cache hit"), labels);
  assert.ok(labels.includes("Daily avg"), labels);
  assert.ok(labels.includes("Cost"), labels);
  assert.ok(values.includes("94.1%"), values);
  assert.ok(values.includes("258.37M"), values);
  assert.ok(values.includes("$18.42"), values);

  // The columns are equally wide: (width - 1) / 4.
  const columnWidth = Math.floor((WIDTH - 1) / 4);
  assert.equal(labels.indexOf("Cache hit") - labels.indexOf("LLM"), columnWidth);
  assert.equal(labels.indexOf("Daily avg") - labels.indexOf("Cache hit"), columnWidth);
  assert.equal(labels.indexOf("Cost") - labels.indexOf("Daily avg"), columnWidth);
  assert.equal(values.indexOf("94.1%") - values.indexOf("7.75B tokens"), columnWidth);
});

test("reports the cumulative block in the footer of the overview", () => {
  const footer = lineWith(renderTab("overview"), "active days");

  assert.ok(footer.includes("7.75B total"), footer);
  assert.ok(footer.includes("654.43M peak"), footer);
  assert.ok(footer.includes("15 active days"), footer);
});

test("draws the trend alone, eight rows tall, with the dates under it", () => {
  const lines = renderTab("trend");
  const chart = lines.filter((line) => line.includes("▌"));

  assert.equal(chart.length, 8, chart.join("\n"));

  // The chart takes the whole width of the view.
  const widest = chart.reduce((longest, row) => (row.length > longest.length ? row : longest), "");
  assert.ok(widest.length >= WIDTH - 3, `the chart spans the width: ${widest.length}`);

  // Two days never merge into one bar.
  for (const row of chart) {
    assert.equal(row.includes("▌▌"), false, row);
  }

  // The first and the last day of the window are under the chart.
  const lastChart = lines.map((line) => line.includes("▌")).lastIndexOf(true);
  const dates = lines[lastChart + 1] ?? "";
  assert.ok(dates.includes("09-22"), dates);
  assert.ok(dates.includes("10-21"), dates);
});

test("honors the trendRows option", () => {
  const lines = renderTab("trend", { trendRows: 4 });

  assert.equal(lines.filter((line) => line.includes("▌")).length, 4);
});

test("stacks the column of a day by model", () => {
  const painted: { index: number; text: string }[] = [];
  const theme: ViewTheme = {
    ...plainTheme(),
    model: (index, text) => {
      painted.push({ index, text });
      return text;
    },
  };

  renderDetailsView(SUMMARY, theme, WIDTH, { tab: "trend" });

  // The cells of the chart belong to a model: every one of them is painted
  // with the color of its model.
  const cells = painted.filter((entry) => entry.text.includes("▌"));
  assert.ok(cells.length > 0, "the chart paints its cells");

  // Every model of the window has its own color.
  assert.ok(
    painted.some((entry) => entry.index === 0),
    painted.map((e) => e.index).join(","),
  );
  assert.ok(
    painted.some((entry) => entry.index === 1),
    painted.map((e) => e.index).join(","),
  );

  // The busiest model takes the biggest share of the cells, the way it takes
  // the biggest share of the tokens.
  const flash = cells.filter((entry) => entry.index === 0).length;
  const other = cells.filter((entry) => entry.index === 1).length;
  assert.ok(other > 0, `the other model keeps a cell: ${other}`);
  assert.ok(
    flash / (flash + other) > 0.7,
    `the flash model takes the biggest share: ${flash}/${other}`,
  );
});

test("gives a cell to every model of a day when the column is tall enough", () => {
  const painted: { index: number; text: string }[] = [];
  const theme: ViewTheme = {
    ...plainTheme(),
    model: (index, text) => {
      painted.push({ index, text });
      return text;
    },
  };

  // Eight rows and a day with two models: both of them keep a cell.
  renderDetailsView(SUMMARY, theme, WIDTH, { tab: "trend", trendRows: 8 });

  const busiest = SUMMARY.days.reduce((peak, day) =>
    !peak || day.totalTokens > peak.totalTokens ? day : peak,
  );
  const busiestModels = busiest?.models ?? [];
  assert.equal(busiestModels.length, 2);
  // The busiest day is a full column: eight cells, one per model at least.
  const cells = painted.filter((entry) => entry.text.includes("▌"));
  const flash = cells.filter((entry) => entry.index === 0).length;
  const other = cells.filter((entry) => entry.index === 1).length;
  assert.ok(flash >= 2, `the busiest model keeps its cells: ${flash}`);
  assert.ok(other >= 2, `the other model keeps a cell: ${other}`);
});

test("draws the legend of the models horizontally, with their share", () => {
  const lines = renderTab("trend");
  const legend = lines.filter((line) => line.includes("■"));

  // The entries sit one next to the other: the legend is one line.
  assert.equal(legend.length, 1, legend.join("\n"));
  assert.ok(legend[0]?.includes("MiniMax-M3.1-Flash-Preview"), legend[0]);
  assert.ok(legend[0]?.includes("82%"), legend[0]);
  assert.ok(legend[0]?.includes("MiniMax-M3 "), legend[0]);
  assert.ok(legend[0]?.includes("18%"), legend[0]);
  // The entries are separated by two spaces.
  assert.ok(legend[0]?.includes("82%  ■"), legend[0]);
});

test("the legend of the models comes before the chart", () => {
  const lines = renderTab("trend");
  const legend = lines.findIndex((line) => line.includes("■"));
  const chart = lines.findIndex((line) => line.includes("▌"));

  assert.ok(legend !== -1, "the legend is drawn");
  assert.ok(chart !== -1, "the chart is drawn");
  assert.ok(legend < chart, `the legend is at ${legend} and the chart at ${chart}`);
});

test("the title of the section comes before the legend", () => {
  const lines = renderTab("trend");
  const title = lines.findIndex((line) => line.includes("Daily trend"));
  const legend = lines.findIndex((line) => line.includes("■"));

  assert.ok(title !== -1, "the section has a title");
  assert.ok(title < legend, `the title is at ${title} and the legend at ${legend}`);
});

test("wraps the legend when its entries do not fit the width", () => {
  const lines = renderTab("trend", { width: 40 });
  const legend = lines.filter((line) => line.includes("■"));

  // The entries do not fit in one line: they wrap to the next one.
  assert.equal(legend.length, 2, legend.join("\n"));
  for (const line of legend) {
    assert.ok(visibleWidth(line) <= 40, `the legend line fits: ${JSON.stringify(line)}`);
  }
  // The legend still comes before the chart.
  const chart = lines.findIndex((line) => line.includes("▌"));
  assert.ok(lines.indexOf(legend[1] ?? "") < chart);
});

test("draws the detail line of the selected day", () => {
  const detail = detailLines(renderTab("trend", { selectedDay: 26 }));

  assert.ok(detail.includes("2026-10-18"), detail);
  assert.ok(detail.includes("388.00M"), detail);
  assert.ok(detail.includes("MiniMax-M3.1-Flash-Preview"), detail);
  assert.ok(detail.includes("318.16M"), detail);
  assert.ok(detail.includes("82%"), detail);
  assert.ok(detail.includes("MiniMax-M3 "), detail);
  assert.ok(detail.includes("69.84M"), detail);
  assert.ok(detail.includes("18%"), detail);
});

test("details the last day of the window when no day is selected", () => {
  const detail = detailLines(renderTab("trend"));

  assert.ok(detail.includes("2026-10-21"), detail);
  assert.ok(detail.includes("299.57M"), detail);
});

test("says so when the selected day has no usage", () => {
  const detail = detailLines(renderTab("trend", { selectedDay: 0 }));

  assert.ok(detail.includes("2026-09-22"), detail);
  assert.ok(detail.includes("no usage"), detail);
});

test("the selection is an input of the renderer, never internal state", () => {
  const first = renderDetailsView(SUMMARY, plainTheme(), WIDTH, {
    tab: "trend",
    selectedDay: 26,
  });
  const second = renderDetailsView(SUMMARY, plainTheme(), WIDTH, {
    tab: "trend",
    selectedDay: 28,
  });

  assert.notDeepStrictEqual(first, second);
  // The same options paint the same view: the renderer keeps nothing.
  assert.deepStrictEqual(
    first,
    renderDetailsView(SUMMARY, plainTheme(), WIDTH, { tab: "trend", selectedDay: 26 }),
  );
});

test("draws the heatmap alone, with its weight scale under it", () => {
  const lines = renderTab("heatmap");
  const rows = lines.filter((line) => /Mon|Tue|Wed|Thu|Fri|Sat|Sun/.test(line));

  assert.deepStrictEqual(
    rows.map((row) => labelOf(row)),
    ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
  );

  const legend = lineWith(lines, "poco");
  assert.ok(legend.includes("mucho"), legend);
  assert.ok(legend.includes("░"), legend);
  assert.ok(legend.includes("▒"), legend);
  assert.ok(legend.includes("▓"), legend);
  assert.ok(legend.includes("█"), legend);
  // The old scale is gone.
  assert.equal(
    lines.some((line) => line.includes("Less")),
    false,
  );
  assert.equal(
    lines.some((line) => line.includes("More")),
    false,
  );
});

test("paints the weight scale with the four levels of the heat scale", () => {
  const { theme } = markedTheme();

  const lines = renderDetailsView(SUMMARY, theme, WIDTH, { tab: "heatmap" });
  const legend = lineWith(lines, "poco");

  assert.ok(legend.includes("\x1b[90m░\x1b[0m"), legend);
  assert.ok(legend.includes("\x1b[91m▒\x1b[0m"), legend);
  assert.ok(legend.includes("\x1b[92m▓\x1b[0m"), legend);
  assert.ok(legend.includes("\x1b[93m█\x1b[0m"), legend);
});

test("mutes the two words of the weight scale", () => {
  const { theme, muted } = markedTheme();

  renderDetailsView(SUMMARY, theme, WIDTH, { tab: "heatmap" });

  assert.ok(muted.includes("poco"), muted.join(","));
  assert.ok(muted.includes("mucho"), muted.join(","));
});

test("the heatmap shows the detail of the selected day", () => {
  const detail = detailLines(renderTab("heatmap", { selectedDay: 26 }));

  assert.ok(detail.includes("2026-10-18"), detail);
  assert.ok(detail.includes("388.00M"), detail);
  assert.ok(detail.includes("MiniMax-M3.1-Flash-Preview"), detail);
  assert.ok(detail.includes("82%"), detail);
  assert.ok(detail.includes("MiniMax-M3 "), detail);
  assert.ok(detail.includes("18%"), detail);
});

test("the heatmap and the trend detail the same day", () => {
  const trend = detailLines(renderTab("trend", { selectedDay: 26 }));
  const heatmap = detailLines(renderTab("heatmap", { selectedDay: 26 }));

  assert.equal(heatmap, trend);
  assert.ok(heatmap.includes("2026-10-18"), heatmap);
});

test("the heatmap marks the selected day", () => {
  const { theme } = markedTheme();

  const lines = renderDetailsView(SUMMARY, theme, WIDTH, {
    tab: "heatmap",
    selectedDay: 26,
  });
  const rows = lines.filter((line) => /Mon|Tue|Wed|Thu|Fri|Sat|Sun/.test(line));
  const marked = rows.filter((line) => line.includes("<accent>"));

  // Only the cell of the selected day is painted with the accent role.
  assert.equal(marked.length, 1, marked.join("\n"));
});

test("the selection is drawn only when the day is inside the calendar", () => {
  const { theme } = markedTheme();

  // The narrow view draws only the last week of the calendar: the first day
  // of the window is not in it.
  const narrow = renderDetailsView(SUMMARY, theme, 24, {
    tab: "heatmap",
    selectedDay: 0,
  });
  const narrowRows = narrow.filter((line) => /Mon|Tue|Wed|Thu|Fri|Sat|Sun/.test(line));
  assert.equal(narrowRows.filter((line) => line.includes("<accent>")).length, 0);

  const wide = renderDetailsView(SUMMARY, theme, WIDTH, {
    tab: "heatmap",
    selectedDay: 26,
  });
  const wideRows = wide.filter((line) => /Mon|Tue|Wed|Thu|Fri|Sat|Sun/.test(line));
  assert.equal(wideRows.filter((line) => line.includes("<accent>")).length, 1);
});

test("draws the heatmap over the whole history of the ledger", () => {
  const rows = renderTab("heatmap").filter((line) => /Mon|Tue|Wed|Thu|Fri|Sat|Sun/.test(line));

  // The calendar covers every week of the history, from 2026-05-28 to
  // 2026-10-21: 22 calendar weeks. The 30 day window alone would be five.
  for (const row of rows) {
    assert.equal(cellsOf(row).length, 22);
  }
  // A day outside the window is still a cell of the calendar.
  assert.equal(cellsOf(rows[3] ?? "")[0], "▒"); // 2026-05-28, 120M
  assert.equal(cellsOf(rows[3] ?? "")[10], "▓"); // 2026-08-06, 410M
  // The busiest day of the history keeps the highest level.
  assert.equal(cellsOf(rows[4] ?? "")[17], "█"); // 2026-09-25, 654.43M
});

test("draws the days outside the calendar as spaces, never as cells", () => {
  const rows = renderTab("heatmap").filter((line) => /Mon|Tue|Wed|Thu|Fri|Sat|Sun/.test(line));

  // The days before the first day of the history are not cells: they would
  // draw a stripe.
  assert.equal(cellsOf(rows[0] ?? "")[0], " ");
  assert.equal(cellsOf(rows[1] ?? "")[0], " ");
  assert.equal(cellsOf(rows[2] ?? "")[0], " ");
  // The days after the last one are not cells either.
  assert.equal(cellsOf(rows[3] ?? "")[21], " ");
  assert.equal(cellsOf(rows[6] ?? "")[21], " ");
});

test("reports what was spent per model, with a bar per model", () => {
  const lines = renderTab("models");
  const flash = lineWith(lines, "MiniMax-M3.1-Flash-Preview");
  const other = lineWith(lines, "MiniMax-M3 ");

  assert.ok(flash.includes("82%"), flash);
  assert.ok(flash.includes("▰"), flash);
  assert.ok(other.includes("18%"), other);
  assert.ok(other.includes("▱"), other);
});

test("draws the hints line at the bottom", () => {
  const hints = renderTab("overview").at(-1) ?? "";

  assert.ok(hints.includes("↑↓ scroll · ←→ day · tab cambia · r refresh · esc close"), hints);
});

test("paints the title of the screen and the label of the window", () => {
  const lines = renderTab("overview");

  assert.ok(lines[0]?.includes("🐙 MiniMax · Pi usage (local)"), lines[0]);
  assert.ok(lines[0]?.includes("last 30 days"), lines[0]);
  // The title and the label fill the width of the screen exactly.
  assert.equal(visibleWidth(lines[0] ?? ""), WIDTH);
  assert.ok(lines[1]?.includes("─"), lines[1]);
  assert.equal(visibleWidth(lines[1] ?? ""), WIDTH);
});

test("labels the scope as local and never as the whole account", () => {
  const lines = render();

  assert.ok(lines[0]?.includes("MiniMax · Pi usage (local)"));
  assert.equal(
    lines.some((line) => line.includes("account")),
    false,
  );
});

test("shows the window label of the summary", () => {
  assert.ok(render()[0]?.includes("last 30 days"));
});

test("uses the window length of the options when it is given", () => {
  const lines = renderDetailsView(SUMMARY, plainTheme(), WIDTH, { windowDays: 7 });

  assert.ok(lines[0]?.includes("last 7 days"));
  assert.equal(lines[0]?.includes("last 30 days"), false);
  // The narrowed window only counts the days it covers.
  assert.ok(lineWith(lines, "1.51B tokens").includes("1.51B tokens"));
  assert.ok(lineWith(lines, "active days").includes("4 active days"));
});

test("formats the token counts with human suffixes", () => {
  assert.equal(formatTokens(7_750_000_000), "7.75B");
  assert.equal(formatTokens(258_370_000), "258.37M");
  assert.equal(formatTokens(654_430_000), "654.43M");
  assert.equal(formatTokens(12_340), "12.34K");
  assert.equal(formatTokens(999), "999");
});

test("returns a single explicit line when there is no local usage", () => {
  const lines = render(EMPTY_SUMMARY);

  assert.equal(lines.length, 1);
  assert.ok(lines[0]?.includes("No local MiniMax usage in the last 30 days."));
  // Never present zeros as usage.
  assert.equal(lines[0]?.includes("$0"), false);
  assert.equal(/\d\.\d{2}[BMK]/.test(lines[0] ?? ""), false);
  assert.equal(lines[0]?.includes("0%"), false);
  assert.equal(lines[0]?.includes("active days"), false);
});

test("truncates every line to the given width", () => {
  for (const width of [80, 40, 24, 12]) {
    for (const line of render(SUMMARY, width)) {
      assert.ok(visibleWidth(line) <= width, `line wider than ${width}: ${JSON.stringify(line)}`);
    }
  }
});

test("keeps every line inside the width with the plain theme", () => {
  const lines = render(SUMMARY, 30);

  for (const line of lines) {
    assert.ok(visibleWidth(line) <= 30);
    assert.equal(line.includes("\x1b"), false);
  }
});

test("paints the heatmap with the scale of the day", () => {
  const levels: number[] = [];
  const theme: ViewTheme = {
    ...plainTheme(),
    heat: (level, text) => {
      levels.push(level);
      return text;
    },
  };

  renderDetailsView(SUMMARY, theme, WIDTH, { tab: "heatmap" });

  assert.ok(levels.includes(0), "the empty days are painted at the lowest level");
  assert.ok(levels.includes(3), "the busiest days are painted at the highest level");
});

test("counts a wide glyph as two cells", () => {
  assert.equal(visibleWidth("🐙"), 2);
  assert.equal(visibleWidth("🐙 MiniMax"), 10);
  // A wide glyph is never cut in half: it is dropped and the ellipsis takes
  // its place.
  assert.equal(truncateVisible("🐙 MiniMax", 2), "…");
  assert.equal(truncateVisible("🐙 MiniMax", 3), "🐙…");
});

test("is deterministic", () => {
  assert.deepStrictEqual(render(), render());
});

test("anchors the window on the local day of the given time", () => {
  // A ledger bucketed at UTC+10: the entry belongs to the local day
  // 2026-10-22, which is still 2026-10-21 in UTC. The window must end on the
  // local day, or a same day entry falls outside of it.
  const day = {
    day: "2026-10-22",
    input: 0,
    output: 0,
    cacheRead: 100,
    cacheWrite: 0,
    totalTokens: 100,
    cost: 0,
    messages: 1,
    models: [{ model: "MiniMax-M3", totalTokens: 100, cost: 0, messages: 1 }],
  };
  const summary: LedgerSummary = {
    ...EMPTY_SUMMARY,
    days: [day],
    history: [day],
    totals: {
      input: 0,
      output: 0,
      cacheRead: 100,
      cacheWrite: 0,
      totalTokens: 100,
      cost: 0,
    },
    cacheHitRate: 1,
    activeDays: 1,
    dailyAverage: 100 / 30,
    peakDay: day,
    tzOffsetMinutes: 600,
  };

  const lines = renderDetailsView(summary, plainTheme(), 80, {
    now: Date.UTC(2026, 9, 21, 15, 0, 0),
  });

  assert.equal(lines[0]?.includes("No local MiniMax usage"), false, lines[0]);
  assert.ok(lineWith(lines, "100 tokens").includes("100 tokens"));
});

test("falls back to the days of the window when there is no history", () => {
  const summary: LedgerSummary = { ...SUMMARY, history: [] };
  const rows = renderDetailsView(summary, plainTheme(), WIDTH, { tab: "heatmap" }).filter((line) =>
    /Mon|Tue|Wed|Thu|Fri|Sat|Sun/.test(line),
  );

  // The window alone is five calendar weeks.
  assert.equal(cellsOf(rows[0] ?? "").length, 5);
});

test("every tab of the bar is reachable by its name", () => {
  assert.deepStrictEqual([...DETAILS_TABS], ["overview", "trend", "heatmap", "models"]);
});
