import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import minimaxUsageSource, { type UsageRuntime } from "../extensions/minimax-usage-source.ts";
import type { FetchFn } from "../lib/fetch-remains.ts";
import { parseRemains } from "../lib/parse-remains.ts";
import {
  STATUS_KEY,
  STATUS_NO_DATA,
  STATUS_NO_KEY,
  formatUsageStatus,
} from "../lib/standalone-status.ts";

const NOW = 1_759_500_000_000;
const HOME = "/home/tester";
const CHANNEL = "gentle-pi:usage-source/v1";

interface Emitted {
  channel: string;
  data: Record<string, unknown>;
}

type StatusCall = [key: string, text: string | undefined];

interface Ctx {
  mode?: string;
  ui?: { setStatus(key: string, text: string | undefined): void };
}

type Handler = (event: unknown, ctx?: Ctx) => void;

function fakePi() {
  const handlers = new Map<string, Handler[]>();
  const emitted: Emitted[] = [];
  const statusCalls: StatusCall[] = [];
  const ctx: Ctx = {
    ui: {
      setStatus(key, text) {
        statusCalls.push([key, text]);
      },
    },
  };
  const pi = {
    events: {
      emit(channel: string, data: unknown) {
        emitted.push({ channel, data: data as Record<string, unknown> });
      },
    },
    on(event: "session_start" | "agent_settled", handler: Handler) {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    },
  };
  const fire = (event: string, callCtx?: Ctx) => {
    for (const handler of handlers.get(event) ?? []) handler(event, callCtx ?? ctx);
  };
  const flush = async () => {
    for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve));
  };
  return { pi, emitted, fire, flush, statusCalls, ctx };
}

function baseRuntime(overrides: Partial<UsageRuntime> = {}): Partial<UsageRuntime> {
  return { env: {}, home: HOME, exists: () => false, readFile: () => "{}", ...overrides };
}

function okFetch(): FetchFn {
  const ok = JSON.parse(
    readFileSync(new URL("./fixtures/remains-ok.json", import.meta.url), "utf8"),
  ) as unknown;
  return (async () => ({ ok: true, json: async () => ok }) as Response) as FetchFn;
}

function assertRegistration(emitted: Emitted): void {
  assert.equal(emitted.channel, CHANNEL);
  const { data } = emitted;
  assert.equal(data.schema, "gentle-pi.usage-source/v1");
  assert.equal(data.provider, "minimax");
  assert.equal(data.pendingNote, "no usage yet · r to fetch");
  assert.equal(typeof data.fetch, "function");
}

test("registers the usage source at factory time", () => {
  const { pi, emitted } = fakePi();

  minimaxUsageSource(pi, baseRuntime());

  assert.equal(emitted.length, 1);
  assertRegistration(emitted[0] as Emitted);
});

test("registers the usage source on session_start", () => {
  const { pi, emitted, fire } = fakePi();
  minimaxUsageSource(pi, baseRuntime());

  fire("session_start");

  assert.equal(emitted.length, 2);
  assertRegistration(emitted.at(-1) as Emitted);
});

test("the registered fetch returns the parsed snapshot", async () => {
  const stubFetch = okFetch();
  const { pi, emitted, fire } = fakePi();
  minimaxUsageSource(pi, baseRuntime());
  fire("session_start");

  const fetch = emitted.at(-1)?.data.fetch as (
    apiKey: string | undefined,
    fetchFn: FetchFn,
    now: number,
  ) => Promise<unknown>;

  assert.deepStrictEqual(await fetch("key", stubFetch, NOW), parseRemains(JSON.parse(readFileSync(new URL("./fixtures/remains-ok.json", import.meta.url), "utf8")) as unknown, NOW));
});

test("re-registers on every session_start", () => {
  const { pi, emitted, fire } = fakePi();
  minimaxUsageSource(pi, baseRuntime());

  fire("session_start");
  fire("session_start");

  assert.equal(emitted.length, 3);
  assert.ok(emitted.every((e) => e.channel === CHANNEL));
});

test("status mode writes the usage status on session_start and agent_settled", async () => {
  const { pi, fire, flush, statusCalls } = fakePi();
  minimaxUsageSource(
    pi,
    baseRuntime({
      env: { MINIMAX_USAGE_MODE: "status", MINIMAX_API_KEY: "env-key" },
      fetchFn: okFetch(),
      now: () => NOW,
    }),
  );

  fire("session_start");
  await flush();
  fire("agent_settled");
  await flush();

  assert.equal(statusCalls.length, 2);
  assert.ok(statusCalls.every(([key, text]) => key === STATUS_KEY && text === "MM 5h 55% · week 6%"));
});

test("off mode emits nothing and writes nothing", async () => {
  const { pi, emitted, fire, flush, statusCalls } = fakePi();
  minimaxUsageSource(
    pi,
    baseRuntime({
      env: { MINIMAX_USAGE_MODE: "off", MINIMAX_API_KEY: "env-key" },
      fetchFn: okFetch(),
    }),
  );

  fire("session_start");
  fire("agent_settled");
  await flush();

  assert.equal(emitted.length, 0);
  assert.equal(statusCalls.length, 0);
});

test("shell mode emits but never writes the status", async () => {
  const { pi, emitted, fire, flush, statusCalls } = fakePi();
  minimaxUsageSource(
    pi,
    baseRuntime({
      env: { MINIMAX_USAGE_MODE: "shell", MINIMAX_API_KEY: "env-key" },
      exists: () => true,
      fetchFn: okFetch(),
    }),
  );

  fire("session_start");
  fire("agent_settled");
  await flush();

  assert.ok(emitted.length >= 1);
  assert.ok(emitted.every((e) => e.channel === CHANNEL));
  assert.equal(statusCalls.length, 0);
});

test("auto mode writes the status without a shell and stays silent with one", async () => {
  const withoutShell = fakePi();
  minimaxUsageSource(
    withoutShell.pi,
    baseRuntime({ env: { MINIMAX_API_KEY: "env-key" }, fetchFn: okFetch(), now: () => NOW }),
  );
  withoutShell.fire("session_start");
  await withoutShell.flush();

  // Source still registers at factory time and on session_start.
  assert.equal(withoutShell.emitted.length, 2);
  assert.deepStrictEqual(withoutShell.statusCalls, [
    [STATUS_KEY, formatUsageStatus(parseRemains(JSON.parse(readFileSync(new URL("./fixtures/remains-ok.json", import.meta.url), "utf8")) as unknown, NOW))],
  ]);

  const withShell = fakePi();
  minimaxUsageSource(
    withShell.pi,
    baseRuntime({ env: { MINIMAX_API_KEY: "env-key" }, exists: () => true, fetchFn: okFetch() }),
  );
  withShell.fire("session_start");
  withShell.fire("agent_settled");
  await withShell.flush();

  assert.ok(withShell.emitted.length >= 1);
  assert.equal(withShell.statusCalls.length, 0);
});

test("a missing key writes the no-key status without fetching", async () => {
  let fetched = false;
  const { pi, fire, flush, statusCalls } = fakePi();
  minimaxUsageSource(
    pi,
    baseRuntime({
      env: { MINIMAX_USAGE_MODE: "status" },
      fetchFn: (() => {
        fetched = true;
        return Promise.reject(new Error("must not be called"));
      }) as FetchFn,
      readFile: () => {
        throw new Error("no auth.json");
      },
    }),
  );

  fire("session_start");
  await flush();

  assert.equal(fetched, false);
  assert.deepStrictEqual(statusCalls, [[STATUS_KEY, STATUS_NO_KEY]]);
});

test("print mode never writes the status", async () => {
  const { pi, fire, flush, statusCalls } = fakePi();
  minimaxUsageSource(
    pi,
    baseRuntime({
      env: { MINIMAX_USAGE_MODE: "status", MINIMAX_API_KEY: "env-key" },
      fetchFn: okFetch(),
    }),
  );

  fire("session_start", { mode: "print" });
  fire("agent_settled", { mode: "json" });
  await flush();

  assert.equal(statusCalls.length, 0);
});

test("a rejecting fetchFn writes the no-data status and never throws", async () => {
  const { pi, fire, flush, statusCalls } = fakePi();
  minimaxUsageSource(
    pi,
    baseRuntime({
      env: { MINIMAX_USAGE_MODE: "status", MINIMAX_API_KEY: "env-key" },
      fetchFn: (async () => {
        throw new Error("network down");
      }) as FetchFn,
    }),
  );

  fire("session_start");
  await flush();

  assert.deepStrictEqual(statusCalls, [[STATUS_KEY, STATUS_NO_DATA]]);
});
