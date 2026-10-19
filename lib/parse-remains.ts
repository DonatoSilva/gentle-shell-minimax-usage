// Pure mapping from the MiniMax Token Plan `/remains` payload to Gentle Shell's
// ProviderUsage shape. No I/O: the caller supplies the decoded body and `now`.

export interface UsageWindow {
  label: string;
  usedPercent: number;
  windowSeconds: number;
  resetAt: number; // absolute epoch ms
}

export interface UsageLimit {
  name: string;
  limitReached: boolean;
  windows: UsageWindow[];
}

export interface ProviderUsage {
  provider: string;
  plan?: string;
  limits: UsageLimit[];
  fetchedAt: number;
}

const PROVIDER = "minimax";
const BUCKET = "general";
const FIVE_HOURS_S = 5 * 60 * 60;
const ONE_WEEK_S = 7 * 24 * 60 * 60;

export function parseRemains(body: unknown, now: number): ProviderUsage | undefined {
  if (!isRecord(body) || !isSuccess(body.base_resp)) return undefined;
  if (!Array.isArray(body.model_remains)) return undefined;

  const bucket = body.model_remains.find((entry) => isRecord(entry) && entry.model_name === BUCKET);
  if (!isRecord(bucket)) return undefined;

  const windows = [
    toWindow(
      "5h",
      FIVE_HOURS_S,
      bucket.current_interval_remaining_percent,
      bucket.remains_time,
      now,
    ),
    toWindow(
      "week",
      ONE_WEEK_S,
      bucket.current_weekly_remaining_percent,
      bucket.weekly_remains_time,
      now,
    ),
  ].filter((w): w is UsageWindow => w !== undefined);

  if (windows.length === 0) return undefined;

  // One limit per window: the shell's footer draws only the first limit (5h),
  // while the Alt+U panel lists every limit's windows.
  return {
    provider: PROVIDER,
    limits: windows.map((w) => ({
      name: BUCKET,
      limitReached: w.usedPercent >= 100,
      windows: [w],
    })),
    fetchedAt: now,
  };
}

function toWindow(
  label: string,
  windowSeconds: number,
  remainingPercent: unknown,
  remainsMs: unknown,
  now: number,
): UsageWindow | undefined {
  if (!isFiniteNumber(remainingPercent) || !isFiniteNumber(remainsMs)) return undefined;
  return {
    label,
    usedPercent: clamp(100 - remainingPercent, 0, 100),
    windowSeconds,
    resetAt: now + Math.max(0, remainsMs),
  };
}

function isSuccess(baseResp: unknown): boolean {
  return isRecord(baseResp) && baseResp.status_code === 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
