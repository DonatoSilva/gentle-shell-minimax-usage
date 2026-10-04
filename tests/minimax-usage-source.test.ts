import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import minimaxUsageSource from "../extensions/minimax-usage-source.ts";
import type { FetchFn } from "../lib/fetch-remains.ts";
import { parseRemains } from "../lib/parse-remains.ts";

const NOW = 1_759_500_000_000;
const CHANNEL = "gentle-pi:usage-source/v1";

interface Emitted {
  channel: string;
  data: Record<string, unknown>;
}

function fakePi() {
  const handlers = new Map<string, Array<() => void>>();
  const emitted: Emitted[] = [];
  const pi = {
    events: {
      emit(channel: string, data: unknown) {
        emitted.push({ channel, data: data as Record<string, unknown> });
      },
    },
    on(event: "session_start", handler: () => void) {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    },
  };
  const fire = (event: string) => {
    for (const handler of handlers.get(event) ?? []) handler();
  };
  return { pi, emitted, fire };
}

test("does not emit at factory time", () => {
  const { pi, emitted } = fakePi();

  minimaxUsageSource(pi);

  assert.equal(emitted.length, 0);
});

test("registers the usage source on session_start", () => {
  const { pi, emitted, fire } = fakePi();
  minimaxUsageSource(pi);

  fire("session_start");

  assert.equal(emitted.length, 1);
  const [{ channel, data }] = emitted as [Emitted];
  assert.equal(channel, CHANNEL);
  assert.equal(data.schema, "gentle-pi.usage-source/v1");
  assert.equal(data.provider, "minimax");
  assert.equal(data.pendingNote, "no usage yet · r to fetch");
  assert.equal(typeof data.fetch, "function");
});

test("the registered fetch returns the parsed snapshot", async () => {
  const ok = JSON.parse(
    readFileSync(new URL("./fixtures/remains-ok.json", import.meta.url), "utf8"),
  ) as unknown;
  const stubFetch = (async () => ({ ok: true, json: async () => ok }) as Response) as FetchFn;
  const { pi, emitted, fire } = fakePi();
  minimaxUsageSource(pi);
  fire("session_start");

  const fetch = emitted[0]?.data.fetch as (
    apiKey: string | undefined,
    fetchFn: FetchFn,
    now: number,
  ) => Promise<unknown>;

  assert.deepStrictEqual(await fetch("key", stubFetch, NOW), parseRemains(ok, NOW));
});

test("re-registers on every session_start", () => {
  const { pi, emitted, fire } = fakePi();
  minimaxUsageSource(pi);

  fire("session_start");
  fire("session_start");

  assert.equal(emitted.length, 2);
  assert.ok(emitted.every((e) => e.channel === CHANNEL));
});
