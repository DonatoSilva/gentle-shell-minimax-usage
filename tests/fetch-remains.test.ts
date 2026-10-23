import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { fetchRemains, fetchRemainsState, type FetchFn } from "../lib/fetch-remains.ts";
import { parseRemains } from "../lib/parse-remains.ts";

const NOW = 1_759_500_000_000;
const PRIMARY = "https://api.minimax.io/v1/token_plan/remains";
const LEGACY = "https://api.minimax.io/v1/api/openplatform/coding_plan/remains";

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));
}

function bodyWithStatus(statusCode: number, statusMsg = "success"): unknown {
  return { model_remains: [], base_resp: { status_code: statusCode, status_msg: statusMsg } };
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
  assert.deepStrictEqual(
    calls.map((c) => c.url),
    [PRIMARY, LEGACY],
  );
});

test("tries the legacy endpoint when the primary returns an error status body", async () => {
  const ok = fixture("remains-ok.json");
  const { fetchFn, calls } = stubFetch({
    [PRIMARY]: { ok: true, payload: fixture("remains-error.json") },
    [LEGACY]: { ok: true, payload: ok },
  });

  const usage = await fetchRemains("key", fetchFn, NOW);

  assert.deepStrictEqual(usage, parseRemains(ok, NOW));
  assert.deepStrictEqual(
    calls.map((c) => c.url),
    [PRIMARY, LEGACY],
  );
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

test("returns the ok state from the primary endpoint", async () => {
  const ok = fixture("remains-ok.json");
  const { fetchFn, calls } = stubFetch({ [PRIMARY]: { ok: true, payload: ok } });

  const state = await fetchRemainsState("key", fetchFn, NOW);

  assert.deepStrictEqual(state, { kind: "ok", usage: parseRemains(ok, NOW) });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, PRIMARY);
});

test("returns missing-credential without any request when the key is missing", async () => {
  for (const apiKey of [undefined, ""]) {
    const { fetchFn, calls } = stubFetch({});

    assert.deepStrictEqual(await fetchRemainsState(apiKey, fetchFn, NOW), {
      kind: "missing-credential",
    });
    assert.equal(calls.length, 0);
  }
});

test("falls back to the legacy endpoint when the primary answers a non-ok state", async () => {
  const ok = fixture("remains-ok.json");
  const { fetchFn, calls } = stubFetch({
    [PRIMARY]: { ok: true, payload: bodyWithStatus(1004, "no api key supplied") },
    [LEGACY]: { ok: true, payload: ok },
  });

  const state = await fetchRemainsState("key", fetchFn, NOW);

  assert.deepStrictEqual(state, { kind: "ok", usage: parseRemains(ok, NOW) });
  assert.deepStrictEqual(
    calls.map((c) => c.url),
    [PRIMARY, LEGACY],
  );
});

test("keeps the most specific state when no endpoint answers ok", async () => {
  const { fetchFn } = stubFetch({
    [PRIMARY]: { ok: true, payload: bodyWithStatus(2049, "invalid api key") },
    [LEGACY]: { ok: true, payload: bodyWithStatus(1004, "no api key supplied") },
  });

  assert.deepStrictEqual(await fetchRemainsState("key", fetchFn, NOW), {
    kind: "missing-credential",
  });
});

test("keeps a credential error over a no-plan state", async () => {
  const { fetchFn } = stubFetch({
    [PRIMARY]: { ok: true, payload: fixture("remains-no-general.json") },
    [LEGACY]: { ok: true, payload: bodyWithStatus(2049, "invalid api key") },
  });

  assert.deepStrictEqual(await fetchRemainsState("key", fetchFn, NOW), {
    kind: "invalid-credential",
  });
});

test("returns no-plan when the account has no general bucket", async () => {
  const { fetchFn } = stubFetch({
    [PRIMARY]: { ok: true, payload: fixture("remains-no-general.json") },
    [LEGACY]: { ok: true, payload: fixture("remains-no-general.json") },
  });

  assert.deepStrictEqual(await fetchRemainsState("key", fetchFn, NOW), { kind: "no-plan" });
});

test("returns unknown when every endpoint fails", async () => {
  const { fetchFn, calls } = stubFetch({
    [PRIMARY]: { ok: false },
    [LEGACY]: { ok: false },
  });

  assert.deepStrictEqual(await fetchRemainsState("key", fetchFn, NOW), { kind: "unknown" });
  assert.equal(calls.length, 2);
});

test("returns unknown when every endpoint answers an unknown status", async () => {
  const { fetchFn } = stubFetch({
    [PRIMARY]: { ok: true, payload: bodyWithStatus(2013) },
    [LEGACY]: { ok: true, payload: bodyWithStatus(2013) },
  });

  assert.deepStrictEqual(await fetchRemainsState("key", fetchFn, NOW), { kind: "unknown" });
});

test("returns unknown instead of rejecting when fetchFn throws", async () => {
  const fetchFn = (async () => {
    throw new TypeError("fetch failed");
  }) as FetchFn;

  assert.deepStrictEqual(await fetchRemainsState("key", fetchFn, NOW), { kind: "unknown" });
});

test("returns unknown when the body is not JSON", async () => {
  const { fetchFn } = stubFetch({
    [PRIMARY]: { ok: true, jsonThrows: true },
    [LEGACY]: { ok: true, jsonThrows: true },
  });

  assert.deepStrictEqual(await fetchRemainsState("key", fetchFn, NOW), { kind: "unknown" });
});
