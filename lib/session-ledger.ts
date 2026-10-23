// Local session ledger for the MiniMax console view.
//
// Safety and privacy contract (S4):
//   * Only the numeric usage fields of an assistant message are ever read:
//     `input`, `output`, `cacheRead`, `cacheWrite` and `cost.total`.
//   * The message content is never read, never logged and never rendered.
//   * The module is strictly read-only: it never writes, renames or deletes a
//     file, and it never performs a network call.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export interface LedgerUsageTotals {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  cost: number;
}

export interface LedgerDay extends LedgerUsageTotals {
  day: string; // YYYY-MM-DD, local calendar day
  messages: number;
  /**
   * What the day was spent on, per model, the busiest one first. The trend
   * stacks the column of the day with these.
   */
  models: LedgerDayModel[];
}

/** What a model spent inside a day. */
export interface LedgerDayModel {
  model: string;
  totalTokens: number;
  cost: number;
  messages: number;
}

export interface LedgerModel extends LedgerUsageTotals {
  model: string;
  messages: number;
}

export interface LedgerSummary {
  provider: string;
  days: LedgerDay[]; // ascending by day, only the days that carry usage
  /**
   * Every day of the ledger that carries usage, ascending, the ones outside
   * the window included. The window keeps the aggregates, the history keeps
   * the whole past: the heatmap draws all of it.
   */
  history: LedgerDay[];
  totals: LedgerUsageTotals;
  cacheHitRate: number; // 0..1
  activeDays: number;
  windowDays: number;
  dailyAverage: number; // totals.totalTokens / windowDays
  peakDay?: LedgerDay;
  /**
   * Minutes east of UTC of the calendar day the buckets use. The consumers
   * need it to anchor their own window on the same local day.
   */
  tzOffsetMinutes: number;
  /** What was spent, per model, busiest first. */
  models: LedgerModel[];
}

export interface SummarizeOptions {
  provider?: string;
  windowDays?: number;
  now?: number;
  /** Minutes east of UTC. Defaults to the runtime local offset. */
  tzOffsetMinutes?: number;
}

const DEFAULT_PROVIDER = "minimax";
const DEFAULT_WINDOW_DAYS = 30;
const DAY_MS = 86_400_000;

export function summarizeUsage(
  entries: readonly unknown[],
  options?: SummarizeOptions,
): LedgerSummary {
  const provider = options?.provider ?? DEFAULT_PROVIDER;
  const windowDays = normalizeWindowDays(options?.windowDays);
  const now = options?.now ?? Date.now();
  const tzOffsetMinutes = options?.tzOffsetMinutes ?? -new Date(now).getTimezoneOffset();

  // The window is the trailing `windowDays` local days, the current one
  // included: [now - (windowDays - 1) days, now]. Entries dated before it or
  // after the current local day are out of the window.
  const firstDay = localDayKey(now - (windowDays - 1) * DAY_MS, tzOffsetMinutes);
  const lastDay = localDayKey(now, tzOffsetMinutes);

  const days = new Map<string, LedgerDay>();
  // The days outside the window: the history of the ledger, which the
  // heatmap draws. They never change the aggregates of the window.
  const history = new Map<string, LedgerDay>();
  const models = new Map<string, LedgerModel>();
  // The matrix of the days: the models of every day, with their own totals.
  const dayModels = new Map<string, Map<string, LedgerDayModel>>();

  for (const entry of entries) {
    const found = usageOf(entry, provider);
    if (!found) continue;

    const day = dayOf(entry, tzOffsetMinutes);
    if (!day) continue;

    const usage = found.usage;
    // A day inside the window feeds the window and the models; a day outside
    // it only feeds the history.
    const inside = day >= firstDay && day <= lastDay;
    const buckets = inside ? days : history;
    const bucket = buckets.get(day) ?? {
      day,
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: 0,
      messages: 0,
      models: [],
    };
    bucket.input += usage.input;
    bucket.output += usage.output;
    bucket.cacheRead += usage.cacheRead;
    bucket.cacheWrite += usage.cacheWrite;
    bucket.cost += usage.cost;
    bucket.totalTokens += usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
    bucket.messages += 1;
    buckets.set(day, bucket);

    // The models of the day: the same messages, grouped by their model. The
    // matrix of the day never changes the aggregates of the window.
    const perModel = dayModels.get(day) ?? new Map<string, LedgerDayModel>();
    const dayModel = perModel.get(found.model) ?? {
      model: found.model,
      totalTokens: 0,
      cost: 0,
      messages: 0,
    };
    dayModel.totalTokens += usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
    dayModel.cost += usage.cost;
    dayModel.messages += 1;
    perModel.set(found.model, dayModel);
    dayModels.set(day, perModel);

    // The models are the ones of the window: the totals of the view are the
    // ones the window covers.
    if (!inside) continue;

    const model = models.get(found.model) ?? {
      model: found.model,
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: 0,
      messages: 0,
    };
    model.input += usage.input;
    model.output += usage.output;
    model.cacheRead += usage.cacheRead;
    model.cacheWrite += usage.cacheWrite;
    model.cost += usage.cost;
    model.totalTokens += usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
    model.messages += 1;
    models.set(found.model, model);
  }

  const sortedDays = [...days.values()].sort(compareDays);
  // The history is every day of the ledger, the ones of the window included.
  const allDays = new Map<string, LedgerDay>();
  for (const day of days.values()) allDays.set(day.day, day);
  for (const day of history.values()) allDays.set(day.day, day);
  const sortedHistory = [...allDays.values()].sort(compareDays);
  // Every day carries the matrix of its models, the busiest one first.
  for (const day of allDays.values()) {
    day.models = rankDayModels(dayModels.get(day.day));
  }
  const totals = sumTotals(sortedDays);
  const peakDay = pickPeakDay(sortedDays);
  const ranked = [...models.values()].sort((a, b) => b.totalTokens - a.totalTokens);

  return {
    provider,
    days: sortedDays,
    history: sortedHistory,
    totals,
    cacheHitRate: cacheHitRate(totals),
    activeDays: sortedDays.length,
    windowDays,
    dailyAverage: totals.totalTokens / windowDays,
    peakDay,
    tzOffsetMinutes,
    models: ranked,
  };
}

/**
 * Reads every `*.jsonl` file under `dir` and returns the parsed entries.
 *
 * A missing or unreadable directory yields an empty list instead of throwing,
 * and malformed lines are skipped silently.
 */
export function readSessionEntries(dir: string): unknown[] {
  const entries: unknown[] = [];

  for (const file of listSessionFiles(dir)) {
    let content: string;
    try {
      content = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        entries.push(JSON.parse(trimmed));
      } catch {
        // Malformed line: skip it, the rest of the file is still usable.
      }
    }
  }

  return entries;
}

/**
 * Resolves the sessions directory: `PI_CODING_AGENT_DIR` when it is set to a
 * non-empty string, `home/.pi/agent` otherwise. The `sessions` folder is
 * always appended.
 */
export function resolveSessionsDir(env: Record<string, string | undefined>, home: string): string {
  const configured = env.PI_CODING_AGENT_DIR?.trim();
  const agentDir = configured ? configured : join(home, ".pi", "agent");
  return join(agentDir, "sessions");
}

function listSessionFiles(dir: string): string[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    // Missing or unreadable directory: no local usage, never an exception.
    return [];
  }

  const files: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (isDirectory(path, entry)) {
      files.push(...listSessionFiles(path));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      files.push(path);
    }
  }
  return files;
}

function isDirectory(path: string, entry: { isDirectory: () => boolean }): boolean {
  if (entry.isDirectory()) return true;
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Extracts the numeric usage and the model of an assistant message of
 * `provider`. Returns `undefined` for every entry that must not be counted.
 */
function usageOf(
  entry: unknown,
  provider: string,
):
  | {
      model: string;
      usage: {
        input: number;
        output: number;
        cacheRead: number;
        cacheWrite: number;
        cost: number;
      };
    }
  | undefined {
  if (!isRecord(entry)) return undefined;
  if (entry.type !== "message") return undefined;
  if (!isRecord(entry.message)) return undefined;
  if (entry.message.role !== "assistant") return undefined;
  if (entry.message.provider !== provider) return undefined;

  const usage = entry.message.usage;
  if (!isRecord(usage)) return undefined;

  const input = finiteNumber(usage.input);
  const output = finiteNumber(usage.output);
  const cacheRead = finiteNumber(usage.cacheRead);
  const cacheWrite = finiteNumber(usage.cacheWrite);
  const cost = isRecord(usage.cost) ? finiteNumber(usage.cost.total) : undefined;

  const hasUsage = [input, output, cacheRead, cacheWrite, cost].some(
    (value) => value !== undefined,
  );
  if (!hasUsage) return undefined;

  const model = typeof entry.message.model === "string" ? entry.message.model : "unknown";

  return {
    model,
    usage: {
      input: input ?? 0,
      output: output ?? 0,
      cacheRead: cacheRead ?? 0,
      cacheWrite: cacheWrite ?? 0,
      cost: cost ?? 0,
    },
  };
}

function dayOf(entry: unknown, tzOffsetMinutes: number): string | undefined {
  if (!isRecord(entry)) return undefined;
  const timestamp = entry.timestamp;
  if (typeof timestamp !== "string") return undefined;
  const parsed = Date.parse(timestamp);
  if (Number.isNaN(parsed)) return undefined;
  return localDayKey(parsed, tzOffsetMinutes);
}

/** Local calendar day key (`YYYY-MM-DD`) of an epoch, shifted by the offset. */
function localDayKey(epochMs: number, tzOffsetMinutes: number): string {
  return new Date(epochMs + tzOffsetMinutes * 60_000).toISOString().slice(0, 10);
}

function sumTotals(days: readonly LedgerDay[]): LedgerUsageTotals {
  const totals: LedgerUsageTotals = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: 0,
  };
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

/**
 * Cache hit rate, our own definition and not MiniMax's:
 * `cacheRead / (input + cacheRead + cacheWrite)`, and `0` when the
 * denominator is zero.
 */
function cacheHitRate(totals: LedgerUsageTotals): number {
  const denominator = totals.input + totals.cacheRead + totals.cacheWrite;
  if (denominator === 0) return 0;
  return totals.cacheRead / denominator;
}

function pickPeakDay(days: readonly LedgerDay[]): LedgerDay | undefined {
  let peak: LedgerDay | undefined;
  for (const day of days) {
    if (!peak || day.totalTokens > peak.totalTokens) peak = day;
  }
  return peak;
}

/** Orders two days by their calendar day. */
function compareDays(a: LedgerDay, b: LedgerDay): number {
  return a.day < b.day ? -1 : a.day > b.day ? 1 : 0;
}

/**
 * The models of a day, the busiest one first.
 *
 * The order is stable: two models with the same number of tokens keep the
 * order they were seen in.
 */
function rankDayModels(models: Map<string, LedgerDayModel> | undefined): LedgerDayModel[] {
  if (!models) return [];
  return [...models.values()].sort((a, b) => b.totalTokens - a.totalTokens);
}

function normalizeWindowDays(windowDays: number | undefined): number {
  if (windowDays === undefined || !Number.isFinite(windowDays)) return DEFAULT_WINDOW_DAYS;
  if (windowDays < 1) return DEFAULT_WINDOW_DAYS;
  return Math.floor(windowDays);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
