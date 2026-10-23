// Paints both views as plain text, with no terminal and no TTY.
//
// It is the preview of what `/minimax:usage` and `/minimax:details` show: the
// consumption view is built from the local session history and the quota panel
// comes from the live endpoint, with the state your own key returns.
//
//   node --experimental-strip-types scripts/preview-views.ts
//
// The script is not part of the published package.

import { readFileSync } from "node:fs";
import { homedir } from "node:os";

import { renderDetailsView } from "../lib/details-view.ts";
import { fetchRemainsState } from "../lib/fetch-remains.ts";
import { readSessionEntries, resolveSessionsDir, summarizeUsage } from "../lib/session-ledger.ts";
import { resolveApiKey } from "../lib/standalone-status.ts";
import { renderUsagePanel } from "../lib/usage-panel.ts";
import { plainTheme } from "../lib/view-theme.ts";

const WIDTH = 88;
const WINDOW_DAYS = 30;

const env = process.env;
const home = homedir();
const now = Date.now();
const theme = plainTheme();

const dir = resolveSessionsDir(env, home);
const entries = readSessionEntries(dir);
const summary = summarizeUsage(entries, { provider: "minimax", windowDays: WINDOW_DAYS, now });

console.log(`# /minimax:details  (ledger: ${dir})`);
console.log(renderDetailsView(summary, theme, WIDTH, { now }).join("\n"));
console.log("");

const apiKey = resolveApiKey({ env, home, readFile: (path) => readFileSync(path, "utf8") });
const state = await fetchRemainsState(apiKey, fetch, now);

console.log("# /minimax:usage");
console.log(renderUsagePanel(state, theme, WIDTH, now).join("\n"));
