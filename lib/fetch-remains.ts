// HTTP side of the MiniMax Token Plan meter. The caller injects `fetchFn`,
// so tests run without network and the shell keeps control of transport
// (including its own abort timeout).

import {
  classifyRemains,
  parseRemains,
  type ProviderUsage,
  type RemainsState,
} from "./parse-remains.ts";

export type FetchFn = typeof fetch;

const ENDPOINTS = [
  "https://api.minimax.io/v1/token_plan/remains",
  // Legacy Coding Plan path; still answers for Token Plan keys.
  "https://api.minimax.io/v1/api/openplatform/coding_plan/remains",
] as const;

// How specific each non-ok state is; the most specific one wins when no
// endpoint answers with usable usage.
const SPECIFICITY: Record<NonOkRemainsState["kind"], number> = {
  "missing-credential": 3,
  "invalid-credential": 2,
  "no-plan": 1,
  unknown: 0,
};

type NonOkRemainsState = Exclude<RemainsState, { kind: "ok" }>;

type EndpointReply = { answered: true; body: unknown } | { answered: false };

export async function fetchRemains(
  apiKey: string | undefined,
  fetchFn: FetchFn,
  now: number,
): Promise<ProviderUsage | undefined> {
  if (!apiKey) return undefined;

  for (const url of ENDPOINTS) {
    const reply = await requestBody(url, apiKey, fetchFn);
    if (!reply.answered) continue;

    const usage = parseRemains(reply.body, now);
    if (usage) return usage;
  }
  return undefined;
}

// Same endpoints and order as `fetchRemains`, but it names the state instead of
// collapsing everything into `undefined`.
export async function fetchRemainsState(
  apiKey: string | undefined,
  fetchFn: FetchFn,
  now: number,
): Promise<RemainsState> {
  if (!apiKey) return { kind: "missing-credential" };

  let best: NonOkRemainsState = { kind: "unknown" };
  for (const url of ENDPOINTS) {
    const reply = await requestBody(url, apiKey, fetchFn);
    if (!reply.answered) continue;

    const state = classifyRemains(reply.body, now);
    if (state.kind === "ok") return state;
    if (SPECIFICITY[state.kind] > SPECIFICITY[best.kind]) best = state;
  }
  return best;
}

async function requestBody(url: string, apiKey: string, fetchFn: FetchFn): Promise<EndpointReply> {
  try {
    const response = await fetchFn(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
    });
    if (!response.ok) return { answered: false };
    return { answered: true, body: await response.json() };
  } catch {
    // Network error, abort or non-JSON body: no data, never a crash.
    return { answered: false };
  }
}
