// HTTP side of the MiniMax Token Plan meter. The caller injects `fetchFn`,
// so tests run without network and the shell keeps control of transport
// (including its own abort timeout).

import { parseRemains, type ProviderUsage } from "./parse-remains.ts";

export type FetchFn = typeof fetch;

const ENDPOINTS = [
  "https://api.minimax.io/v1/token_plan/remains",
  // Legacy Coding Plan path; still answers for Token Plan keys.
  "https://api.minimax.io/v1/api/openplatform/coding_plan/remains",
] as const;

export async function fetchRemains(
  apiKey: string | undefined,
  fetchFn: FetchFn,
  now: number,
): Promise<ProviderUsage | undefined> {
  if (!apiKey) return undefined;

  for (const url of ENDPOINTS) {
    const usage = await tryEndpoint(url, apiKey, fetchFn, now);
    if (usage) return usage;
  }
  return undefined;
}

async function tryEndpoint(
  url: string,
  apiKey: string,
  fetchFn: FetchFn,
  now: number,
): Promise<ProviderUsage | undefined> {
  try {
    const response = await fetchFn(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
    });
    if (!response.ok) return undefined;
    return parseRemains(await response.json(), now);
  } catch {
    // Network error, abort or non-JSON body: no data, never a crash.
    return undefined;
  }
}
