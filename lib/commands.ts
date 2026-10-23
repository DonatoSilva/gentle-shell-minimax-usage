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

import { formatTokens, renderDetailsView } from "./details-view.ts";
import { fetchRemainsState, type FetchFn } from "./fetch-remains.ts";
import type { RemainsState } from "./parse-remains.ts";
import {
  readSessionEntries,
  resolveSessionsDir,
  summarizeUsage,
  type LedgerSummary,
} from "./session-ledger.ts";
import { resolveApiKey } from "./standalone-status.ts";
import { renderUsagePanel } from "./usage-panel.ts";
import type { ViewTheme } from "./view-theme.ts";

export const USAGE_COMMAND = "minimax:usage";
export const DETAILS_COMMAND = "minimax:details";

export const USAGE_DESCRIPTION =
  "MiniMax quota panel: the 5h and weekly windows of the Token Plan.";
export const DETAILS_DESCRIPTION =
  "MiniMax consumption from the local Pi session history (read-only).";

const PROVIDER = "minimax";
const WINDOW_DAYS = 30;

// The command owns its own abort bound: a stalled request must not keep the
// view from opening. The shell applies the same bound to its own fetch.
const COMMAND_TIMEOUT_MS = 10_000;

/** A terminal component: it paints lines and, optionally, takes input. */
export interface CustomComponent {
  render(width: number): string[];
  invalidate(): void;
  handleInput?(data: string): void;
}

/** The terminal handle of a custom component: it asks for a repaint. */
export interface TuiLike {
  requestRender(): void;
}

/** The active Pi theme: it paints a text with one of its color tokens. */
export interface ThemeLike {
  fg(color: string, text: string): string;
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

  await ui.custom<void>((tui, theme, _keybindings, done) => {
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
  });
}

/**
 * `/minimax:details`: the console shape of the local consumption.
 *
 * The ledger is read before the view opens, `r` reads it again and repaints,
 * `esc` or `q` closes the view. `MINIMAX_DETAILS=off` disables the ledger
 * entirely: nothing is read and nothing is painted.
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

  await ui.custom<void>((tui, theme, _keybindings, done) => {
    let current = summary;
    const view = viewThemeOf(theme);

    return {
      render(width: number): string[] {
        return renderDetailsView(current, view, width, { now: rt.now() });
      },
      invalidate(): void {
        // The view is rebuilt on every render, there is nothing to cache.
      },
      handleInput(data: string): void {
        if (data === "r") {
          current = readLedger(rt);
          tui.requestRender();
          return;
        }
        if (isCloseKey(data)) done(undefined);
      },
    };
  });
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
  };
}

/** `esc` and `q` close the view. */
function isCloseKey(data: string): boolean {
  return data === "q" || isEscape(data);
}

/**
 * The escape key, as Pi delivers it: the raw byte, or the kitty keyboard
 * protocol variant of it.
 */
function isEscape(data: string): boolean {
  if (data === "\x1b") return true;
  // eslint-disable-next-line no-control-regex -- the escape sequence is the pattern
  return /^\x1b\[27(?:;\d+)*u$/.test(data);
}
