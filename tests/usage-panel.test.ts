import { test } from "node:test";
import assert from "node:assert/strict";

import { renderUsagePanel } from "../lib/usage-panel.ts";
import type { RemainsState } from "../lib/parse-remains.ts";
import { visibleWidth } from "../lib/view-frame.ts";
import { plainTheme, type ViewTheme } from "../lib/view-theme.ts";

const NOW = 1_759_500_000_000;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WIDTH = 72;

const TITLE = "✿ MiniMax";
const HINTS = "r refresh   esc close";
const FILLED_CELL = "▰";
const EMPTY_CELL = "▱";

/** Theme with real ANSI colors, to check which slot painted what. */
const ANSI_THEME: ViewTheme = {
  title: (text) => `\x1b[1m${text}\x1b[0m`,
  provider: (text) => `\x1b[36m${text}\x1b[0m`,
  label: (text) => `\x1b[37m${text}\x1b[0m`,
  value: (text) => `\x1b[0m${text}\x1b[0m`,
  muted: (text) => `\x1b[2m${text}\x1b[0m`,
  separator: (text) => `\x1b[90m${text}\x1b[0m`,
  accent: (text) => `\x1b[32m${text}\x1b[0m`,
  warning: (text) => `\x1b[33m${text}\x1b[0m`,
  error: (text) => `\x1b[31m${text}\x1b[0m`,
  border: (text) => `\x1b[90m${text}\x1b[0m`,
};

interface WindowFixture {
  label: string;
  usedPercent: number;
  resetAt: number;
}

/** An `ok` snapshot with one `general` limit per window, built by hand. */
function okState(windows: WindowFixture[], fetchedAt = NOW): RemainsState {
  return {
    kind: "ok",
    usage: {
      provider: "minimax",
      limits: windows.map((window) => ({
        name: "general",
        limitReached: window.usedPercent >= 100,
        windows: [
          {
            label: window.label,
            usedPercent: window.usedPercent,
            windowSeconds: window.label === "week" ? 604_800 : 18_000,
            resetAt: window.resetAt,
          },
        ],
      })),
      fetchedAt,
    },
  };
}

/** The body rows of the frame: the title, the rows, the hints and the border. */
function bodyOf(lines: string[]): string[] {
  return lines.slice(1, -2);
}

/** The percentage column of a meter row, as painted. */
function percentField(row: string): string {
  const match = /[▰▱]{16} (.*)$/.exec(row);
  assert.ok(match, `no meter in row: ${row}`);
  return (match?.[1] ?? "").slice(0, 4);
}

/** The gauge of a meter row, filled and empty cells together. */
function gaugeOf(row: string): string {
  const match = /([▰▱]{16}) /.exec(row);
  assert.ok(match, `no meter in row: ${row}`);
  return match?.[1] ?? "";
}

test("draws the provider row and one row per window in the ok state", () => {
  const state = okState([
    { label: "5h", usedPercent: 55, resetAt: NOW + 2 * HOUR + 13 * MINUTE },
    { label: "week", usedPercent: 6, resetAt: NOW + 4 * DAY + 3 * HOUR },
  ]);

  const body = bodyOf(renderUsagePanel(state, plainTheme(), WIDTH, NOW));

  assert.equal(body.length, 3);
  assert.ok(body[0]?.includes("minimax · updated just now"), body[0]);
  assert.ok(body[1]?.includes("general 5h"), body[1]);
  assert.ok(body[2]?.includes("general week"), body[2]);
});

test("frames the panel with the title and the hints row", () => {
  const lines = renderUsagePanel(okState([]), plainTheme(), WIDTH, NOW);

  assert.ok(lines[0]?.includes(TITLE), lines[0]);
  assert.ok(
    lines.some((line) => line.includes(HINTS)),
    lines.join("\n"),
  );
  assert.ok(lines.at(-1)?.startsWith("╰"), lines.at(-1));
});

test("pads the window names to the same width", () => {
  const state = okState([
    { label: "5h", usedPercent: 55, resetAt: NOW + HOUR },
    { label: "week", usedPercent: 6, resetAt: NOW + DAY },
  ]);

  const body = bodyOf(renderUsagePanel(state, plainTheme(), WIDTH, NOW));

  assert.ok(body[1]?.includes("general 5h   ▰"), body[1]);
  assert.ok(body[2]?.includes("general week ▰"), body[2]);
});

test("draws a 16 cell meter with the filled cells of the window", () => {
  const state = okState([
    { label: "5h", usedPercent: 55, resetAt: NOW + HOUR },
    { label: "week", usedPercent: 6, resetAt: NOW + DAY },
  ]);

  const body = bodyOf(renderUsagePanel(state, plainTheme(), WIDTH, NOW));

  assert.equal(gaugeOf(body[1] ?? ""), `${FILLED_CELL.repeat(9)}${EMPTY_CELL.repeat(7)}`);
  assert.equal(gaugeOf(body[2] ?? ""), `${FILLED_CELL.repeat(1)}${EMPTY_CELL.repeat(15)}`);
});

test("paints the meter with the accent tone below 80 percent", () => {
  const state = okState([{ label: "5h", usedPercent: 79, resetAt: NOW + HOUR }]);

  const row = bodyOf(renderUsagePanel(state, ANSI_THEME, WIDTH, NOW))[1] ?? "";

  assert.ok(row.includes(`\x1b[32m${FILLED_CELL}`), row);
  assert.equal(row.includes(`\x1b[33m${FILLED_CELL}`), false);
  assert.equal(row.includes(`\x1b[31m${FILLED_CELL}`), false);
});

test("paints the meter with the warning tone from 80 percent", () => {
  const state = okState([{ label: "5h", usedPercent: 80, resetAt: NOW + HOUR }]);

  const row = bodyOf(renderUsagePanel(state, ANSI_THEME, WIDTH, NOW))[1] ?? "";

  assert.ok(row.includes(`\x1b[33m${FILLED_CELL}`), row);
  assert.equal(row.includes(`\x1b[32m${FILLED_CELL}`), false);
});

test("keeps the warning tone below 95 percent", () => {
  const state = okState([{ label: "5h", usedPercent: 94, resetAt: NOW + HOUR }]);

  const row = bodyOf(renderUsagePanel(state, ANSI_THEME, WIDTH, NOW))[1] ?? "";

  assert.ok(row.includes(`\x1b[33m${FILLED_CELL}`), row);
  assert.equal(row.includes(`\x1b[31m${FILLED_CELL}`), false);
});

test("paints the meter with the error tone from 95 percent", () => {
  const state = okState([{ label: "5h", usedPercent: 95, resetAt: NOW + HOUR }]);

  const row = bodyOf(renderUsagePanel(state, ANSI_THEME, WIDTH, NOW))[1] ?? "";

  assert.ok(row.includes(`\x1b[31m${FILLED_CELL}`), row);
  assert.equal(row.includes(`\x1b[33m${FILLED_CELL}`), false);
});

test("pads the percentage to a four column field", () => {
  const state = okState([
    { label: "5h", usedPercent: 55, resetAt: NOW + HOUR },
    { label: "week", usedPercent: 6, resetAt: NOW + DAY },
    { label: "full", usedPercent: 100, resetAt: NOW + HOUR },
  ]);

  const body = bodyOf(renderUsagePanel(state, plainTheme(), WIDTH, NOW));

  assert.equal(percentField(body[1] ?? ""), " 55%");
  assert.equal(percentField(body[2] ?? ""), "  6%");
  assert.equal(percentField(body[3] ?? ""), "100%");
});

test("counts the reset of a window that already closed", () => {
  const state = okState([{ label: "5h", usedPercent: 55, resetAt: NOW - MINUTE }]);

  const row = bodyOf(renderUsagePanel(state, plainTheme(), WIDTH, NOW))[1] ?? "";

  assert.ok(row.includes("· resets now"), row);
});

test("counts the reset of a window that closes within the hour", () => {
  const state = okState([{ label: "5h", usedPercent: 55, resetAt: NOW + 5 * MINUTE }]);

  const row = bodyOf(renderUsagePanel(state, plainTheme(), WIDTH, NOW))[1] ?? "";

  assert.ok(row.includes("· resets in 5m"), row);
});

test("counts the reset of a window that closes within the day", () => {
  const state = okState([{ label: "5h", usedPercent: 55, resetAt: NOW + 2 * HOUR + 13 * MINUTE }]);

  const row = bodyOf(renderUsagePanel(state, plainTheme(), WIDTH, NOW))[1] ?? "";

  assert.ok(row.includes("· resets in 2h 13m"), row);
});

test("counts the reset of a window that closes after the day", () => {
  const state = okState([{ label: "week", usedPercent: 6, resetAt: NOW + 4 * DAY + 3 * HOUR }]);

  const row = bodyOf(renderUsagePanel(state, plainTheme(), WIDTH, NOW))[1] ?? "";

  assert.ok(row.includes("· resets in 4d 3h"), row);
});

test("omits the countdown when the window reports no reset", () => {
  const state = okState([{ label: "5h", usedPercent: 55, resetAt: Number.NaN }]);

  const row = bodyOf(renderUsagePanel(state, plainTheme(), WIDTH, NOW))[1] ?? "";

  assert.equal(row.includes("resets"), false);
  assert.ok(row.includes("55%"), row);
});

test("says the snapshot is fresh while it is under a minute old", () => {
  const state = okState([{ label: "5h", usedPercent: 55, resetAt: NOW + HOUR }], NOW - 30_000);

  const row = bodyOf(renderUsagePanel(state, plainTheme(), WIDTH, NOW))[0] ?? "";

  assert.ok(row.includes("minimax · updated just now"), row);
});

test("says how many minutes old the snapshot is", () => {
  const state = okState([{ label: "5h", usedPercent: 55, resetAt: NOW + HOUR }], NOW - 7 * MINUTE);

  const row = bodyOf(renderUsagePanel(state, plainTheme(), WIDTH, NOW))[0] ?? "";

  assert.ok(row.includes("minimax · updated 7m ago"), row);
});

test("draws no meter and points at the details view without a plan", () => {
  const lines = renderUsagePanel({ kind: "no-plan" }, plainTheme(), WIDTH, NOW);
  const body = bodyOf(lines);

  assert.ok(body[0]?.includes("minimax · pay-as-you-go"), body[0]);
  assert.ok(
    body.some((line) => line.includes("M Plan windows")),
    lines.join("\n"),
  );
  assert.ok(
    body.some((line) => line.includes("5h / weekly")),
    lines.join("\n"),
  );
  assert.ok(
    body.some((line) => line.includes("/minimax:details")),
    lines.join("\n"),
  );
  assert.equal(lines.join("\n").includes(FILLED_CELL), false);
  assert.equal(lines.join("\n").includes(EMPTY_CELL), false);
});

test("draws no meter without an API key", () => {
  const lines = renderUsagePanel({ kind: "missing-credential" }, plainTheme(), WIDTH, NOW);
  const body = bodyOf(lines);

  assert.equal(body.length, 1);
  assert.ok(body[0]?.includes("minimax · no API key"), body[0]);
  assert.equal(lines.join("\n").includes(FILLED_CELL), false);
  assert.equal(lines.join("\n").includes(EMPTY_CELL), false);
});

test("draws no meter with an invalid API key", () => {
  const lines = renderUsagePanel({ kind: "invalid-credential" }, plainTheme(), WIDTH, NOW);
  const body = bodyOf(lines);

  assert.equal(body.length, 1);
  assert.ok(body[0]?.includes("minimax · invalid API key"), body[0]);
  assert.equal(lines.join("\n").includes(FILLED_CELL), false);
  assert.equal(lines.join("\n").includes(EMPTY_CELL), false);
});

test("draws no meter without data", () => {
  const lines = renderUsagePanel({ kind: "unknown" }, plainTheme(), WIDTH, NOW);
  const body = bodyOf(lines);

  assert.equal(body.length, 1);
  assert.ok(body[0]?.includes("minimax · no data"), body[0]);
  assert.equal(lines.join("\n").includes(FILLED_CELL), false);
  assert.equal(lines.join("\n").includes(EMPTY_CELL), false);
});

test("never draws a meter for a window that does not exist", () => {
  const state = okState([{ label: "5h", usedPercent: 55, resetAt: NOW + HOUR }]);

  const body = bodyOf(renderUsagePanel(state, plainTheme(), WIDTH, NOW));

  assert.equal(body.length, 2);
  assert.equal(
    body.some((line) => line.includes("week")),
    false,
  );
  assert.equal(
    body.some((line) => line.includes("0%")),
    false,
  );
});

test("fits every line inside a narrow width", () => {
  const state = okState([
    { label: "5h", usedPercent: 55, resetAt: NOW + 2 * HOUR + 13 * MINUTE },
    { label: "week", usedPercent: 6, resetAt: NOW + 4 * DAY + 3 * HOUR },
  ]);

  for (const width of [12, 24, 40]) {
    const lines = renderUsagePanel(state, ANSI_THEME, width, NOW);
    for (const line of lines) {
      assert.ok(visibleWidth(line) <= width, `${width}: ${JSON.stringify(line)}`);
    }
  }
});

test("renders the same panel for the same input", () => {
  const state = okState([
    { label: "5h", usedPercent: 55, resetAt: NOW + 2 * HOUR + 13 * MINUTE },
    { label: "week", usedPercent: 6, resetAt: NOW + 4 * DAY + 3 * HOUR },
  ]);

  const first = renderUsagePanel(state, plainTheme(), WIDTH, NOW);
  const second = renderUsagePanel(state, plainTheme(), WIDTH, NOW);

  assert.deepStrictEqual(first, second);
});

test("uses the given clock and never the wall clock", () => {
  const state = okState([{ label: "5h", usedPercent: 55, resetAt: NOW + HOUR }], NOW);

  const fresh = renderUsagePanel(state, plainTheme(), WIDTH, NOW);
  const later = renderUsagePanel(state, plainTheme(), WIDTH, NOW + 30 * MINUTE);

  assert.notDeepStrictEqual(fresh, later);
  assert.ok(bodyOf(later)[0]?.includes("updated 30m ago"), bodyOf(later)[0]);
});
