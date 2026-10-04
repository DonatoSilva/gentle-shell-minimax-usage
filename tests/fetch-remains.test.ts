import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { fetchRemains, type FetchFn } from "../lib/fetch-remains.ts";
import { parseRemains } from "../lib/parse-remains.ts";

const NOW = 1_759_500_000_000;
const PRIMARY = "https://api.minimax.io/v1/token_plan/remains";
const LEGACY = "https://api.minimax.io/v1/api/openplatform/coding_plan/remains";

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));
}

interface StubReply {
  ok: boolean;
  payload?: unknown;
  jsonThrows?: boolean;
}

interface Call {
  url: string;
  init: RequestInit | undefined;
}

// Records every call and answers per URL; unknown URLs get a 404-like reply.
function stubFetch(replies: Record<string, StubReply>): { fetchFn: FetchFn; calls: Call[] } {
  const calls: Call[] = [];
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const reply = replies[url] ?? { ok: false };
    return {
      ok: reply.ok,
      json: async () => {
        if (reply.jsonThrows) throw new SyntaxError("Unexpected token < in JSON");
        return reply.payload;
      },
    } as Response;
  }) as FetchFn;
  return { fetchFn, calls };
}

test("returns the parsed snapshot from the primary endpoint", async () => {
  const ok = fixture("remains-ok.json");
  const { fetchFn, calls } = stubFetch({ [PRIMARY]: { ok: true, payload: ok } });

  const usage = await fetchRemains("key", fetchFn, NOW);

  assert.deepStrictEqual(usage, parseRemains(ok, NOW));
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, PRIMARY);
  const headers = calls[0]?.init?.headers as Record<string, string>;
  assert.equal(headers.Authorization, "Bearer key");
});

test("falls back to the legacy endpoint when the primary is not ok", async () => {
  const ok = fixture("remains-ok.json");
  const { fetchFn, calls } = stubFetch({
    [PRIMARY]: { ok: false },
    [LEGACY]: { ok: true, payload: ok },
  });

  const usage = await fetchRemains("key", fetchFn, NOW);

  assert.deepStrictEqual(usage, parseRemains(ok, NOW));
  assert.deepStrictEqual(calls.map((c) => c.url), [PRIMARY, LEGACY]);
});

test("tries the legacy endpoint when the primary returns an error status body", async () => {
  const ok = fixture("remains-ok.json");
  const { fetchFn, calls } = stubFetch({
    [PRIMARY]: { ok: true, payload: fixture("remains-error.json") },
    [LEGACY]: { ok: true, payload: ok },
  });

  const usage = await fetchRemains("key", fetchFn, NOW);

  assert.deepStrictEqual(usage, parseRemains(ok, NOW));
  assert.deepStrictEqual(calls.map((c) => c.url), [PRIMARY, LEGACY]);
});

test("returns undefined when both endpoints fail", async () => {
  const { fetchFn, calls } = stubFetch({
    [PRIMARY]: { ok: false },
    [LEGACY]: { ok: true, payload: fixture("remains-error.json") },
  });

  assert.equal(await fetchRemains("key", fetchFn, NOW), undefined);
  assert.equal(calls.length, 2);
});

test("returns undefined instead of rejecting when fetchFn throws", async () => {
  const fetchFn = (async () => {
    throw new TypeError("fetch failed");
  }) as FetchFn;

  assert.equal(await fetchRemains("key", fetchFn, NOW), undefined);
});

test("returns undefined when the body is not JSON", async () => {
  const { fetchFn } = stubFetch({
    [PRIMARY]: { ok: true, jsonThrows: true },
    [LEGACY]: { ok: true, jsonThrows: true },
  });

  assert.equal(await fetchRemains("key", fetchFn, NOW), undefined);
});

test("returns undefined without any request when the key is missing", async () => {
  for (const apiKey of [undefined, ""]) {
    const { fetchFn, calls } = stubFetch({});

    assert.equal(await fetchRemains(apiKey, fetchFn, NOW), undefined);
    assert.equal(calls.length, 0);
  }
});
