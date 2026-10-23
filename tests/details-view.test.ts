import { test } from "node:test";
import assert from "node:assert/strict";

import { formatTokens, renderDetailsView } from "../lib/details-view.ts";
import type { LedgerDay, LedgerSummary } from "../lib/session-ledger.ts";
import { visibleWidth } from "../lib/view-frame.ts";
import { plainTheme } from "../lib/view-theme.ts";

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
  };
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
    totals,
    cacheHitRate: denominator === 0 ? 0 : totals.cacheRead / denominator,
    activeDays: built.length,
    windowDays: 30,
    dailyAverage: 258_370_000,
    peakDay,
    tzOffsetMinutes: 0,
  };
}

const SUMMARY: LedgerSummary = buildSummary(FIXTURE_DAYS);
const EMPTY_SUMMARY: LedgerSummary = {
  provider: "minimax",
  days: [],
  totals: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: 0 },
  cacheHitRate: 0,
  activeDays: 0,
  windowDays: 30,
  dailyAverage: 0,
  peakDay: undefined,
  tzOffsetMinutes: 0,
};

function render(summary: LedgerSummary = SUMMARY, width: number = WIDTH): string[] {
  return renderDetailsView(summary, plainTheme(), width);
}

function lineWith(lines: string[], needle: string): string {
  const line = lines.find((candidate) => candidate.includes(needle));
  assert.ok(line !== undefined, `expected a line containing ${JSON.stringify(needle)}`);
  return line;
}

function lineAfter(lines: string[], needle: string): string {
  const index = lines.findIndex((candidate) => candidate.includes(needle));
  assert.ok(index >= 0, `expected a line containing ${JSON.stringify(needle)}`);
  const line = lines[index + 1];
  assert.ok(line !== undefined, `expected a line after ${JSON.stringify(needle)}`);
  return line;
}

test("renders the headline numbers of the window", () => {
  const lines = render();

  assert.ok(lineWith(lines, "LLM").includes("7.75B tokens"));
  assert.ok(lineWith(lines, "Cache hit").includes("94.1%"));
  assert.ok(lineWith(lines, "Daily avg").includes("258.37M"));
  assert.ok(lineWith(lines, "Cost").includes("$18.42"));
});

test("labels the scope as local and never as the whole account", () => {
  const lines = render();
  const header = lines[0];

  assert.ok(header.includes("MiniMax · Pi usage (local)"));
  assert.ok(!header.includes("account"));
  assert.ok(lines.every((line) => !line.includes("account")));
});

test("shows the window label of the summary", () => {
  assert.ok(render()[0].includes("last 30 days"));
});

test("uses the window length of the options when it is given", () => {
  const lines = renderDetailsView(SUMMARY, plainTheme(), WIDTH, { windowDays: 7 });

  assert.ok(lines[0].includes("last 7 days"));
  assert.ok(!lines[0].includes("last 30 days"));
  // The narrowed window only counts the days it covers.
  assert.ok(lineWith(lines, "LLM").includes("1.51B tokens"));
  assert.ok(lineWith(lines, "active days").includes("4 active days"));
});

test("formats the token counts with human suffixes", () => {
  assert.equal(formatTokens(7_750_000_000), "7.75B");
  assert.equal(formatTokens(258_370_000), "258.37M");
  assert.equal(formatTokens(654_430_000), "654.43M");
  assert.equal(formatTokens(12_340), "12.34K");
  assert.equal(formatTokens(999), "999");
});

test("draws one trend glyph per day of the window, empty days included", () => {
  const glyphs = Array.from(lineAfter(render(), "Daily trend").trim());
  const trend = render();
  const glyphLine = lineAfter(trend, "Daily trend");

  assert.equal(glyphs.length, 30);
  assert.ok(glyphLine.includes("▁"));
  // 2026-09-22 has no usage, 2026-09-25 is the busiest day of the window.
  assert.equal(glyphs[0], "▁");
  assert.equal(glyphs[3], "█");
  // 2026-09-26 sits between two active days and has no usage.
  assert.equal(glyphs[4], "▁");
});

test("prints the first and the last day of the window", () => {
  const lines = render();
  const trendIndex = lines.findIndex((line) => line.includes("Daily trend"));
  assert.ok(trendIndex >= 0);
  const dates = lines[trendIndex + 2];

  assert.ok(dates !== undefined);
  assert.ok(dates.includes("09-22"));
  assert.ok(dates.includes("10-21"));
});

test("draws one row per weekday and one column per week", () => {
  const lines = render();
  const rows: string[] = [];
  const heatmapIndex = lines.findIndex((line) => line.includes("Heatmap"));
  assert.ok(heatmapIndex >= 0);

  for (let row = 0; row < 7; row++) {
    rows.push(lines[heatmapIndex + 1 + row]);
  }

  assert.deepStrictEqual(
    rows.map((row) => row.trim().slice(0, 3)),
    ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
  );
  // 2026-09-22 is a Tuesday, so the window covers five calendar weeks.
  for (const row of rows) {
    assert.equal(Array.from(row.trim().slice(4)).length, 5);
  }
  // The busiest day, 2026-09-25, is a Friday of the first week.
  assert.equal(rows[4].trim().slice(4, 5), "█");
});

test("reports the cumulative block in the footer", () => {
  const footer = render().at(-1) ?? "";

  assert.ok(footer.includes("7.75B total"));
  assert.ok(footer.includes("654.43M peak"));
  assert.ok(footer.includes("15 active days"));
});

test("returns a single explicit line when there is no local usage", () => {
  const lines = render(EMPTY_SUMMARY);

  assert.equal(lines.length, 1);
  assert.ok(lines[0].includes("No local MiniMax usage in the last 30 days."));
  // Never present zeros as usage.
  assert.ok(!lines[0].includes("$0"));
  assert.ok(!/\d\.\d{2}[BMK]/.test(lines[0]));
  assert.ok(!lines[0].includes("0%"));
  assert.ok(!lines[0].includes("active days"));
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
    assert.ok(!line.includes("\x1b"));
  }
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
  };
  const summary: LedgerSummary = {
    ...EMPTY_SUMMARY,
    days: [day],
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

  assert.ok(!lines[0]?.includes("No local MiniMax usage"), lines[0]);
  assert.ok(lineWith(lines, "100 tokens").includes("100 tokens"));
});
