// Gentle Shell style usage panel for the MiniMax quota.
//
// The renderer is a pure function: it reads a classified `/remains` snapshot
// and returns the lines of the panel. It never touches the clock, the
// filesystem or the network, so the same snapshot always paints the same
// panel.
//
// The layout mirrors the Gentle Shell usage panel (`gentle-pi/lib/shell-usage.ts`
// and `gentle-pi/lib/shell-gauge.ts`, MIT): a provider row, then one row per
// window with the limit name, a 16 cell meter, the percentage and the reset
// countdown of that window. The implementation is a reimplementation, not an
// import: `gentle-pi` stays an optional dependency of the published package.

import type { ProviderUsage, RemainsState, UsageWindow } from "./parse-remains.ts";
import type { ViewTheme } from "./view-theme.ts";
import { fitVisible, frameLines } from "./view-frame.ts";

const PROVIDER = "minimax";
const TITLE = "✿ MiniMax";
const HINTS = "r refresh   esc close";
const METER_CELLS = 16;
/** The gap between the padded name of a window and its meter. */
const NAME_GAP = " ";
const FILLED_CELL = "▰";
const EMPTY_CELL = "▱";
const WARNING_THRESHOLD = 80;
const ERROR_THRESHOLD = 95;
const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** A window of the panel: the limit name next to the window label. */
interface PanelRow {
  name: string;
  window: UsageWindow;
}

/**
 * Paints the MiniMax usage panel: the provider row, one row per window of
 * every limit, and the note of the state when there is nothing to meter.
 */
export function renderUsagePanel(
  state: RemainsState,
  theme: ViewTheme,
  width: number,
  now: number,
): string[] {
  const content = Math.max(0, width - 4);
  const body = bodyLines(state, theme, now).map((line) => fitVisible(line, content));
  const framed = frameLines(body, theme, width, { title: TITLE, hints: HINTS });
  return framed.map((line) => fitVisible(line, width));
}

/** The rows of the panel, one per state. */
function bodyLines(state: RemainsState, theme: ViewTheme, now: number): string[] {
  switch (state.kind) {
    case "ok":
      return okBody(state.usage, theme, now);
    case "no-plan":
      return [
        providerRow("pay-as-you-go", theme),
        `  ${theme.muted("No M Plan windows on this account (5h / weekly).")}`,
        `  ${theme.muted("Run /minimax:details for the real consumption and cost.")}`,
      ];
    case "missing-credential":
      return [providerRow("no API key", theme)];
    case "invalid-credential":
      return [providerRow("invalid API key", theme)];
    case "unknown":
      return [providerRow("no data", theme)];
  }
}

/** The provider row and the row of every window of every limit. */
function okBody(usage: ProviderUsage, theme: ViewTheme, now: number): string[] {
  const rows: PanelRow[] = usage.limits.flatMap((limit) =>
    limit.windows.map((window) => ({
      name: [limit.name, window.label].filter((part) => part.length > 0).join(" "),
      window,
    })),
  );
  const nameWidth = rows.reduce((widest, row) => Math.max(widest, row.name.length), 0);

  const lines = [providerRow(updatedAgo(usage.fetchedAt, now), theme)];
  for (const row of rows) {
    const percent = `${Math.round(row.window.usedPercent)}%`.padStart(4);
    const reset = formatReset(row.window.resetAt, now);
    const tail = reset.length > 0 ? ` ${theme.separator("·")} ${theme.muted(reset)}` : "";
    lines.push(
      `  ${theme.label(row.name.padEnd(nameWidth))}${NAME_GAP}${meter(row.window.usedPercent, theme)} ${theme.value(percent)}${tail}`,
    );
  }
  return lines;
}

/** The provider row: the provider name and the note of the snapshot. */
function providerRow(note: string, theme: ViewTheme): string {
  return `${theme.provider(PROVIDER)} ${theme.separator("·")} ${theme.muted(note)}`;
}

/**
 * The 16 cell gauge of a window.
 *
 * The filled cells follow the shell gauge tones: accent below 80%, warning
 * from 80% and error from 95%. The empty cells wear the border role.
 *
 * The filled count is the share of the window rounded to the nearest cell,
 * the same rounding the shell gauge uses.
 */
function meter(percent: number, theme: ViewTheme): string {
  const clamped = Math.max(0, Math.min(100, percent));
  const filled = Math.round((clamped / 100) * METER_CELLS);
  const tone =
    clamped >= ERROR_THRESHOLD
      ? theme.error
      : clamped >= WARNING_THRESHOLD
        ? theme.warning
        : theme.accent;
  return `${tone(FILLED_CELL.repeat(filled))}${theme.border(EMPTY_CELL.repeat(METER_CELLS - filled))}`;
}

/** The countdown of a window, in the shape the shell uses. */
function formatReset(resetAt: number | null | undefined, now: number): string {
  if (resetAt === null || resetAt === undefined || !Number.isFinite(resetAt)) return "";
  const seconds = Math.floor((resetAt - now) / 1000);
  if (seconds <= 0) return "resets now";
  if (seconds < HOUR) return `resets in ${Math.max(1, Math.round(seconds / MINUTE))}m`;
  if (seconds < DAY) {
    return `resets in ${Math.floor(seconds / HOUR)}h ${Math.floor((seconds % HOUR) / MINUTE)}m`;
  }
  return `resets in ${Math.floor(seconds / DAY)}d ${Math.floor((seconds % DAY) / HOUR)}h`;
}

/** How old the snapshot is, in the shape the shell uses. */
function updatedAgo(fetchedAt: number, now: number): string {
  const minutes = Math.floor((now - fetchedAt) / 60_000);
  return minutes < 1 ? "updated just now" : `updated ${minutes}m ago`;
}

/**
 * Fits a line into `width` visible characters.
 *
 * Painted lines go through the shared helper of the frame, which keeps the
 * escape sequences and closes them with a reset. A line without escapes, the
 * plain theme for instance, is cut without adding any escape sequence.
 */
