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
}

export interface LedgerSummary {
  provider: string;
  days: LedgerDay[]; // ascending by day, only the days that carry usage
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

  for (const entry of entries) {
    const usage = usageOf(entry, provider);
    if (!usage) continue;

    const day = dayOf(entry, tzOffsetMinutes);
    if (!day || day < firstDay || day > lastDay) continue;

    const bucket = days.get(day) ?? {
      day,
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: 0,
      messages: 0,
    };
    bucket.input += usage.input;
    bucket.output += usage.output;
    bucket.cacheRead += usage.cacheRead;
    bucket.cacheWrite += usage.cacheWrite;
    bucket.cost += usage.cost;
    bucket.totalTokens += usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
    bucket.messages += 1;
    days.set(day, bucket);
  }

  const sortedDays = [...days.values()].sort((a, b) =>
    a.day < b.day ? -1 : a.day > b.day ? 1 : 0,
  );
  const totals = sumTotals(sortedDays);
  const peakDay = pickPeakDay(sortedDays);

  return {
    provider,
    days: sortedDays,
    totals,
    cacheHitRate: cacheHitRate(totals),
    activeDays: sortedDays.length,
    windowDays,
    dailyAverage: totals.totalTokens / windowDays,
    peakDay,
    tzOffsetMinutes,
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
 * Extracts the numeric usage of an assistant message of `provider`.
 * Returns `undefined` for every entry that must not be counted.
 */
function usageOf(
  entry: unknown,
  provider: string,
):
  | { input: number; output: number; cacheRead: number; cacheWrite: number; cost: number }
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

  return {
    input: input ?? 0,
    output: output ?? 0,
    cacheRead: cacheRead ?? 0,
    cacheWrite: cacheWrite ?? 0,
    cost: cost ?? 0,
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
