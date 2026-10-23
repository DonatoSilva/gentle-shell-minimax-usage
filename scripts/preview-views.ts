// Paints both views as plain text, with no terminal and no TTY.
//
// It is the preview of what `/minimax:usage` and `/minimax:details` show: the
// consumption view is built from the local session history and the quota panel
// comes from the live endpoint, with the state your own key returns.
//
//   node --experimental-strip-types scripts/preview-views.ts [tab] [selectedDay]
//
// The tab is one of `overview`, `trend`, `heatmap` and `models`; the details
// view is painted as the full screen it is in Pi. The selected day is the
// index of the day inside the window, the one the arrows and the clicks move.
// The script is not part of the published package.

import { readFileSync } from "node:fs";
import { homedir } from "node:os";

import { DETAILS_TABS, renderDetailsView, type DetailsTab } from "../lib/details-view.ts";
import { fetchRemainsState } from "../lib/fetch-remains.ts";
import { readSessionEntries, resolveSessionsDir, summarizeUsage } from "../lib/session-ledger.ts";
import { resolveApiKey } from "../lib/standalone-status.ts";
import { renderUsagePanel, usagePanelBodyWidth } from "../lib/usage-panel.ts";
import { plainTheme } from "../lib/view-theme.ts";

/** The width of the painted screen, the one a full screen view gets. */
const WIDTH = 88;

/**
 * The height of the painted screen. The floating view fills the terminal, so
 * the preview does the same when it runs on a TTY. Without one there is no
 * height to fill and the content is painted as it is.
 */
const HEIGHT = process.stdout.rows ?? 0;

const WINDOW_DAYS = 30;

const env = process.env;
const home = homedir();
const now = Date.now();
const theme = plainTheme();

const requested = process.argv[2];
const tab: DetailsTab = DETAILS_TABS.includes(requested as DetailsTab)
  ? (requested as DetailsTab)
  : "overview";

// The selected day of the window: the index the arrows and the clicks move.
const requestedDay = Number(process.argv[3]);
const selectedDay = Number.isInteger(requestedDay) ? requestedDay : undefined;

const dir = resolveSessionsDir(env, home);
const entries = readSessionEntries(dir);
const summary = summarizeUsage(entries, { provider: "minimax", windowDays: WINDOW_DAYS, now });

console.log(`# /minimax:details  (${tab} tab, ledger: ${dir})`);
const details = renderDetailsView(summary, theme, WIDTH, { now, tab, selectedDay });
const padding = Math.max(0, HEIGHT - details.length);
console.log([...details, ...Array.from({ length: padding }, () => "")].join("\n"));
console.log("");

const apiKey = resolveApiKey({ env, home, readFile: (path) => readFileSync(path, "utf8") });
const state = await fetchRemainsState(apiKey, fetch, now);

console.log("# /minimax:usage");
console.log(renderUsagePanel(state, theme, usagePanelBodyWidth(state, now) + 4, now).join("\n"));
