// Pure standalone status surface: rendering and key resolution.
// No I/O by itself: the caller injects readFile. Never logs or stores the key.

import type { ProviderUsage } from "./parse-remains.ts";

export const STATUS_KEY = "minimax-usage";
export const STATUS_NO_KEY = "MM: sin API key";
export const STATUS_NO_DATA = "MM: sin datos";

export function formatUsageStatus(usage: ProviderUsage | undefined): string | undefined {
  if (!usage) return undefined;
  const parts: string[] = [];
  for (const limit of usage.limits) {
    const window = limit.windows[0];
    if (window) parts.push(`${window.label} ${Math.round(window.usedPercent)}%`);
  }
  if (parts.length === 0) return undefined;
  return `MM ${parts.join(" · ")}`;
}

export interface KeyLookupInput {
  env: Record<string, string | undefined>;
  home: string;
  readFile: (path: string) => string;
}

export function resolveApiKey(input: KeyLookupInput): string | undefined {
  const fromEnv = input.env.MINIMAX_API_KEY?.trim();
  if (fromEnv) return fromEnv;

  try {
    const agentDir = input.env.PI_CODING_AGENT_DIR ?? `${input.home}/.pi/agent`;
    const auth = JSON.parse(input.readFile(`${agentDir}/auth.json`)) as {
      minimax?: { key?: unknown };
    };
    const key = auth?.minimax?.key;
    if (typeof key !== "string") return undefined;
    return key.trim() || undefined;
  } catch {
    return undefined;
  }
}
