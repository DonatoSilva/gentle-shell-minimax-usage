// The two MiniMax commands of the extension: `/minimax:usage` and
// `/minimax:details`.
//
// The module owns the wiring only: it resolves the API key, fetches the quota
// state, reads the local session ledger and hands the result to the renderers
// of `lib/`. It never imports Pi: the terminal API is declared structurally,
// the way the extension declares its own context, so the published package
// stays dependency free.
//
// Both commands are read-only. The usage command talks to the MiniMax token
// plan endpoint, the details command reads the local session ledger and
// never sends a single byte of it anywhere.

import { DETAILS_TABS, formatTokens, renderDetailsView, type DetailsTab } from "./details-view.ts";
import { fetchRemainsState, type FetchFn } from "./fetch-remains.ts";
import type { RemainsState } from "./parse-remains.ts";
import {
  readSessionEntries,
  resolveSessionsDir,
  summarizeUsage,
  type LedgerSummary,
} from "./session-ledger.ts";
import { resolveApiKey } from "./standalone-status.ts";
import { renderUsagePanel, usagePanelBodyWidth } from "./usage-panel.ts";
import { matchViewKey } from "./view-keys.ts";
import type { ViewTheme } from "./view-theme.ts";

export const USAGE_COMMAND = "minimax:usage";
export const DETAILS_COMMAND = "minimax:details";

export const USAGE_DESCRIPTION =
  "MiniMax quota panel: the 5h and weekly windows of the Token Plan.";
export const DETAILS_DESCRIPTION =
  "MiniMax consumption from the local Pi session history (read-only).";

const PROVIDER = "minimax";
const WINDOW_DAYS = 30;

// The quota panel floats over the transcript: it is as wide as its content.
// The details view floats too, but it takes the whole screen: the overlay was
// never the problem, the height cap of the earlier attempt was.
const OVERLAY_MARGIN = 1;
const OVERLAY_MAX_HEIGHT = "80%";
/** The details view floats at the full size of the terminal. */
const DETAILS_OVERLAY_WIDTH = "100%";
const DETAILS_OVERLAY_MAX_HEIGHT = "100%";
const DETAILS_OVERLAY_MARGIN = 0;
/** Lines of the details view that fit on the screen; the rest is scrolled. */
const VISIBLE_LINES = 30;

// The command owns its own abort bound: a stalled request must not keep the
// view from opening. The shell applies the same bound to its own fetch.
const COMMAND_TIMEOUT_MS = 10_000;

/**
 * The theme tokens the models cycle through: one color per model, the same
 * one everywhere the model appears.
 */
const MODEL_COLORS = [
  "accent",
  "warning",
  "error",
  "success",
  "customMessageLabel",
  "mdLink",
  "mdHeading",
  "toolOutput",
  "thinkingText",
  "borderAccent",
];

/** A terminal component: it paints lines and, optionally, takes input. */
export interface CustomComponent {
  render(width: number): string[];
  invalidate(): void;
  handleInput?(data: string): void;
}

/** The terminal handle of a custom component: it asks for a repaint. */
export interface TuiLike {
  requestRender(): void;
  /**
   * The size of the terminal, when the handle carries it. It is optional:
   * without it the views cannot know how tall the screen is.
   */
  terminal?: { columns: number; rows: number };
}

/** The active Pi theme: it paints a text with one of its color tokens. */
export interface ThemeLike {
  fg(color: string, text: string): string;
  style?(text: string, options: { fg?: string; bold?: boolean }): string;
}

/** The overlay options of a floating view. */
export interface OverlayOptionsLike {
  /** Width in columns, or a percentage of the terminal width. */
  width?: number | string;
  /** Maximum height in rows, or a percentage of the terminal height. */
  maxHeight?: number | string;
  /** Margin from the terminal edges. */
  margin?: number;
}

/** The slice of Pi's UI API the commands use. */
export interface UiLike {
  custom<T>(
    factory: (
      tui: TuiLike,
      theme: ThemeLike,
      keybindings: unknown,
      done: (result: T) => void,
    ) => CustomComponent,
    options?: {
      overlay?: boolean;
      overlayOptions?: OverlayOptionsLike;
    },
  ): Promise<T>;
  notify(message: string, level?: string): void;
}

/** The slice of Pi's command context the commands use. */
export interface CommandCtx {
  mode?: string;
  ui?: UiLike;
}

/** The options of a registered command. */
export interface CommandRegistrationOptions {
  description: string;
  handler: (args: string, ctx: CommandCtx) => void | Promise<void>;
}

/** A registered command, with a handler that always resolves. */
export interface MinimaxCommand extends CommandRegistrationOptions {
  handler: (args: string, ctx: CommandCtx) => Promise<void>;
}

/** The runtime the commands read from: no ambient state, no globals. */
export interface CommandRuntime {
  env: Record<string, string | undefined>;
  home: string;
  readFile: (path: string) => string;
  fetchFn: FetchFn;
  now: () => number;
}

/** The two commands of the extension. */
export interface MinimaxCommands {
  usage: MinimaxCommand;
  details: MinimaxCommand;
}

/** Builds the two commands over the given runtime. */
export function createMinimaxCommands(rt: CommandRuntime): MinimaxCommands {
  return {
    usage: {
      description: USAGE_DESCRIPTION,
      handler: async (_args: string, ctx: CommandCtx): Promise<void> => {
        await runUsage(rt, ctx);
      },
    },
    details: {
      description: DETAILS_DESCRIPTION,
      handler: async (_args: string, ctx: CommandCtx): Promise<void> => {
        await runDetails(rt, ctx);
      },
    },
  };
}

/**
 * `/minimax:usage`: the quota panel of the token plan.
 *
 * The state is fetched before the view opens, so the panel paints real data
 * right away. `r` fetches again and repaints, `esc` or `q` closes the view.
 */
async function runUsage(rt: CommandRuntime, ctx: CommandCtx): Promise<void> {
  const state = await fetchState(rt);

  if (ctx.mode !== "tui") {
    ctx.ui?.notify(usageSummary(state), "info");
    return;
  }

  const ui = ctx.ui;
  if (!ui) return;

  // The panel floats at the size of its content: the frame adds the two
  // columns of padding on each side of the body.
  const width = usagePanelBodyWidth(state, rt.now()) + 4;

  await ui.custom<void>(
    (tui, theme, _keybindings, done) => {
      let current = state;
      const view = viewThemeOf(theme);

      return {
        render(width: number): string[] {
          return renderUsagePanel(current, view, width, rt.now());
        },
        invalidate(): void {
          // The panel is rebuilt on every render, there is nothing to cache.
        },
        handleInput(data: string): void {
          if (data === "r") {
            void fetchState(rt).then((next) => {
              current = next;
              tui.requestRender();
            });
            return;
          }
          if (isCloseKey(data)) done(undefined);
        },
      };
    },
    {
      overlay: true,
      overlayOptions: { width, maxHeight: OVERLAY_MAX_HEIGHT, margin: OVERLAY_MARGIN },
    },
  );
}

/**
 * `/minimax:details`: the console shape of the local consumption.
 *
 * The view FLOATS over the transcript at the full size of the terminal: the
 * overlay takes the whole width and the whole height, and the component pads
 * its lines with blanks until it reaches the bottom of the screen. The
 * transcript stays intact underneath when the view closes.
 *
 * The ledger is read before the view opens, `r` reads it again and repaints,
 * `esc` or `q` closes the view. `MINIMAX_DETAILS=off` disables the ledger
 * entirely: nothing is read and nothing is painted.
 *
 * The tabs move with `Tab`, `Shift+Tab` and the keys `1` to `3`. The view
 * does not pick a day: there is no selected day to move to.
 */
async function runDetails(rt: CommandRuntime, ctx: CommandCtx): Promise<void> {
  if (isLedgerDisabled(rt.env)) {
    ctx.ui?.notify("MiniMax: the local ledger is disabled (MINIMAX_DETAILS=off)", "info");
    return;
  }

  const summary = readLedger(rt);

  if (ctx.mode !== "tui") {
    ctx.ui?.notify(detailsSummary(summary), "info");
    return;
  }

  const ui = ctx.ui;
  if (!ui) return;

  await ui.custom<void>(
    (tui, theme, _keybindings, done) => {
      let current = summary;
      let tab: DetailsTab = "overview";
      let offset = 0;
      const view = viewThemeOf(theme);

      return {
        render(width: number): string[] {
          // The view is taller than the screen when it has to be: the slice is
          // what is painted, and the offset scrolls through the rest of it.
          const lines = renderDetailsView(current, view, width, {
            now: rt.now(),
            tab,
          });
          const rows = tui.terminal?.rows;
          const visible = rows ?? VISIBLE_LINES;
          const maxOffset = Math.max(0, lines.length - visible);
          if (offset > maxOffset) offset = maxOffset;
          const slice = lines.slice(offset, offset + visible);
          // The window fills the height of the screen: the content is padded
          // with blank lines until it reaches the bottom.
          const padding = Math.max(0, (rows ?? 0) - slice.length);
          return [...slice, ...Array.from({ length: padding }, () => "")];
        },
        invalidate(): void {
          // The view is rebuilt on every render, there is nothing to cache.
        },
        handleInput(data: string): void {
          if (data === "r") {
            current = readLedger(rt);
            offset = 0;
            tui.requestRender();
            return;
          }
          // The tabs move with `Tab`, `Shift+Tab` and the keys `1` to `3`.
          const next = nextTab(tab, data);
          if (next !== undefined) {
            tab = next;
            offset = 0;
            tui.requestRender();
            return;
          }
          if (isScrollUp(data)) {
            offset = Math.max(0, offset - 1);
            tui.requestRender();
            return;
          }
          if (isScrollDown(data)) {
            offset += 1;
            tui.requestRender();
            return;
          }
          if (isCloseKey(data)) done(undefined);
        },
      };
    },
    {
      overlay: true,
      overlayOptions: {
        width: DETAILS_OVERLAY_WIDTH,
        maxHeight: DETAILS_OVERLAY_MAX_HEIGHT,
        margin: DETAILS_OVERLAY_MARGIN,
      },
    },
  );
}

/**
 * The tab a key asks for: `Tab` goes to the next one, `Shift+Tab` to the
 * previous one, and the keys `1` to `3` jump straight to a tab. Both ends
 * wrap around.
 *
 * The arrows never change the tab: the view does not pick a day anymore.
 */
function nextTab(tab: DetailsTab, data: string): DetailsTab | undefined {
  const index = DETAILS_TABS.indexOf(tab);
  const key = matchViewKey(data);
  if (key === "tab") {
    return DETAILS_TABS[(index + 1) % DETAILS_TABS.length] as DetailsTab;
  }
  if (key === "shift+tab") {
    return DETAILS_TABS[(index - 1 + DETAILS_TABS.length) % DETAILS_TABS.length] as DetailsTab;
  }
  const digit = Number(data);
  if (Number.isInteger(digit) && digit >= 1 && digit <= DETAILS_TABS.length) {
    return DETAILS_TABS[digit - 1] as DetailsTab;
  }
  return undefined;
}

/**
 * Fetches the state of the token plan.
 *
 * A missing key, a failing request or a malformed payload ends in a state,
 * never in an exception: the panel always paints something.
 */
async function fetchState(rt: CommandRuntime): Promise<RemainsState> {
  try {
    const apiKey = resolveApiKey({ env: rt.env, home: rt.home, readFile: rt.readFile });
    const boundFetch: FetchFn = (url, init) =>
      rt.fetchFn(url, { ...init, signal: AbortSignal.timeout(COMMAND_TIMEOUT_MS) });
    return await fetchRemainsState(apiKey, boundFetch, rt.now());
  } catch {
    return { kind: "unknown" };
  }
}

/**
 * Reads the local ledger and summarizes it.
 *
 * A missing or unreadable sessions directory yields an empty summary, never
 * an exception.
 */
function readLedger(rt: CommandRuntime): LedgerSummary {
  try {
    const dir = resolveSessionsDir(rt.env, rt.home);
    const entries = readSessionEntries(dir);
    return summarizeUsage(entries, { provider: PROVIDER, windowDays: WINDOW_DAYS, now: rt.now() });
  } catch {
    return summarizeUsage([], { provider: PROVIDER, windowDays: WINDOW_DAYS, now: rt.now() });
  }
}

/** `MINIMAX_DETAILS=off` disables the ledger entirely. */
function isLedgerDisabled(env: Record<string, string | undefined>): boolean {
  return env.MINIMAX_DETAILS?.trim().toLowerCase() === "off";
}

/** The one line summary of the quota, for the modes without a terminal. */
function usageSummary(state: RemainsState): string {
  switch (state.kind) {
    case "ok": {
      const parts = state.usage.limits.flatMap((limit) =>
        limit.windows.map((window) => `${window.label} ${Math.round(window.usedPercent)}%`),
      );
      return parts.length > 0 ? `MiniMax ${parts.join(" · ")}` : "MiniMax: no data";
    }
    case "missing-credential":
      return "MiniMax: no API key";
    case "invalid-credential":
      return "MiniMax: invalid API key";
    case "no-plan":
      return "MiniMax: no M Plan · run /minimax:details";
    case "unknown":
      return "MiniMax: no data";
  }
}

/** The one line summary of the local consumption, for the modes without a terminal. */
function detailsSummary(summary: LedgerSummary): string {
  if (summary.activeDays === 0) {
    return `MiniMax local: no usage in the last ${summary.windowDays} days`;
  }
  const tokens = formatTokens(summary.totals.totalTokens);
  const cost = `$${summary.totals.cost.toFixed(2)}`;
  return `MiniMax local: ${tokens} tokens · ${cost} · ${summary.activeDays} active days`;
}

/**
 * Maps the semantic slots of the views onto the color tokens of the active
 * Pi theme. The views never hardcode an ANSI sequence.
 */
function viewThemeOf(theme: ThemeLike): ViewTheme {
  return {
    title: (text) => theme.fg("accent", text),
    provider: (text) => theme.fg("text", text),
    label: (text) => theme.fg("muted", text),
    value: (text) => theme.fg("text", text),
    muted: (text) => theme.fg("muted", text),
    separator: (text) => theme.fg("dim", text),
    accent: (text) => theme.fg("accent", text),
    warning: (text) => theme.fg("warning", text),
    error: (text) => theme.fg("error", text),
    border: (text) => theme.fg("border", text),
    // The active tab of the tab bar is bold on top of its accent color.
    bold: (text) => theme.style?.(text, { bold: true }) ?? text,
    // The heat scale: empty cells fade to the border color and the busiest
    // ones burn in the accent, the way the shell paints its own heatmap.
    heat: (level, text) => {
      if (level <= 0) return theme.fg("border", text);
      if (level === 1) return theme.fg("muted", text);
      if (level === 2) return theme.fg("accent", text);
      return theme.style?.(text, { fg: "accent", bold: true }) ?? theme.fg("accent", text);
    },
    // One color per model: the palette of the theme is cycled by the index
    // of the model in the ranking of the window.
    model: (index, text) => theme.fg(modelColor(index), text),
  };
}

/** The theme token of a model: the palette of the theme is cycled. */
function modelColor(index: number): string {
  const size = MODEL_COLORS.length;
  return MODEL_COLORS[((index % size) + size) % size] ?? "accent";
}

/** `esc` and `q` close the view. */
function isCloseKey(data: string): boolean {
  return data === "q" || matchViewKey(data) === "escape";
}

/** The scroll keys: the arrows, as Pi delivers them, and `j`/`k`. */
function isScrollUp(data: string): boolean {
  return matchViewKey(data) === "up" || data === "k";
}

function isScrollDown(data: string): boolean {
  return matchViewKey(data) === "down" || data === "j";
}
